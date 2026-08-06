import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { writeFileAtomic } from "./write-file-atomic.mjs";

const defaultSchedulePath = "data/schedule.json";
const defaultPublicUrl = "https://seoulcinemaschedule.com/data/schedule.json";
const defaultMaxSeatAgeMs = 2 * 60 * 60 * 1000;
const allowedFutureSkewMs = 5 * 60 * 1000;
const mutableSessionFields = new Set([
  "actionLabel",
  "bookingType",
  "bookingUrl",
  "detailUrl",
  "posterUrl",
  "seatStatusCheckedAt",
  "status",
  "summary",
  "tags"
]);
const mutableSourceFields = new Set([
  "lastSeatCheckedAt",
  "lastSeatError",
  "lastSeatOk",
  "liveSeatSessionCount"
]);

function withoutFields(value, fields) {
  return Object.fromEntries(Object.entries(value || {}).filter(([key]) => !fields.has(key)));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function formatKstDate(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function formatRangeLabel(start, end) {
  if (!start || !end) return "";
  const [, endMonth = "", endDay = ""] = end.split("-");
  return `${start.replace(/-/g, ".")} - ${endMonth}.${endDay}`;
}

function normalizeSeatWindow(schedule, nowMs) {
  const today = formatKstDate(new Date(nowMs));
  const sessions = (schedule?.sessions || []).filter((session) => !session.date || session.date >= today);
  const festivals = (schedule?.festivals || []).filter((festival) => !festival.date || festival.date >= today);
  const dates = [...new Set(sessions.map((session) => session.date).filter(Boolean))].sort();
  const rangeStart = dates[0] || schedule?.meta?.rangeStart || today;
  const rangeEnd = dates[dates.length - 1] || schedule?.meta?.rangeEnd || rangeStart;
  return {
    ...schedule,
    meta: {
      ...(schedule?.meta || {}),
      rangeStart,
      rangeEnd,
      rangeLabel: formatRangeLabel(rangeStart, rangeEnd)
    },
    sessions,
    festivals
  };
}

function scheduleIdentity(schedule, nowMs = Date.now()) {
  const normalized = normalizeSeatWindow(schedule, nowMs);
  const comparable = {
    ...normalized,
    meta: withoutFields(normalized.meta, new Set(["seatStatusVerifiedAt"])),
    sessions: normalized.sessions.map((session) => withoutFields(session, mutableSessionFields)),
    sources: (normalized.sources || []).map((source) => withoutFields(source, mutableSourceFields))
  };
  return canonicalJson(comparable);
}

function requireScheduleShape(schedule, label) {
  if (!schedule || typeof schedule !== "object") throw new Error(`${label} schedule is not an object.`);
  if (!schedule.meta || typeof schedule.meta !== "object") throw new Error(`${label} schedule has no meta object.`);
  if (!Array.isArray(schedule.sessions) || schedule.sessions.length < 1) {
    throw new Error(`${label} schedule has no sessions.`);
  }
  if (!Array.isArray(schedule.venues) || schedule.venues.length < 1) {
    throw new Error(`${label} schedule has no venues.`);
  }
}

function timestampMs(value, label) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) throw new Error(`${label} is missing or invalid.`);
  return parsed;
}

function assertFreshSeatTimestamp(schedule, label, nowMs, maxSeatAgeMs) {
  const checkedAt = timestampMs(schedule?.meta?.seatStatusVerifiedAt, `${label} seatStatusVerifiedAt`);
  const ageMs = nowMs - checkedAt;
  if (ageMs < -allowedFutureSkewMs) throw new Error(`${label} seatStatusVerifiedAt is unexpectedly in the future.`);
  if (ageMs > maxSeatAgeMs) {
    throw new Error(`${label} seat snapshot is ${Math.round(ageMs / 60_000)} minutes old; limit is ${Math.round(maxSeatAgeMs / 60_000)} minutes.`);
  }
  return checkedAt;
}

function chooseSeatSnapshot({ localSchedule, publicSchedule, nowMs = Date.now(), maxSeatAgeMs = defaultMaxSeatAgeMs }) {
  requireScheduleShape(localSchedule, "Committed");
  const normalizedLocal = normalizeSeatWindow(localSchedule, nowMs);
  const localSeatMs = timestampMs(normalizedLocal.meta.seatStatusVerifiedAt, "Committed seatStatusVerifiedAt");
  let publicIssue = "public schedule was unavailable";

  if (publicSchedule) {
    try {
      requireScheduleShape(publicSchedule, "Public");
      const normalizedPublic = normalizeSeatWindow(publicSchedule, nowMs);
      if (normalizedPublic.meta.generatedAt !== normalizedLocal.meta.generatedAt) {
        throw new Error("public generatedAt does not match the committed schedule");
      }
      if (scheduleIdentity(normalizedPublic, nowMs) !== scheduleIdentity(normalizedLocal, nowMs)) {
        throw new Error("public schedule identity does not match the committed schedule");
      }
      const publicSeatMs = timestampMs(normalizedPublic.meta.seatStatusVerifiedAt, "Public seatStatusVerifiedAt");
      if (publicSeatMs > localSeatMs) {
        assertFreshSeatTimestamp(normalizedPublic, "Public", nowMs, maxSeatAgeMs);
        return { schedule: normalizedPublic, source: "public", changed: true, reason: "newer public seat snapshot" };
      }
      publicIssue = "public seat snapshot is not newer";
    } catch (error) {
      publicIssue = error.message;
    }
  }

  assertFreshSeatTimestamp(normalizedLocal, "Committed", nowMs, maxSeatAgeMs);
  return {
    schedule: normalizedLocal,
    source: "committed",
    changed: canonicalJson(normalizedLocal) !== canonicalJson(localSchedule),
    reason: publicIssue
  };
}

async function fetchPublicSchedule(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`public schedule returned HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const schedulePath = process.env.SEOUL_CINEMA_SCHEDULE_PATH || defaultSchedulePath;
  const maxSeatAgeMinutes = Number(process.env.SEOUL_CINEMA_MAX_SEAT_AGE_MINUTES || 120);
  const maxSeatAgeMs = Number.isFinite(maxSeatAgeMinutes) && maxSeatAgeMinutes > 0
    ? maxSeatAgeMinutes * 60_000
    : defaultMaxSeatAgeMs;
  const requestUrl = new URL(process.env.SEOUL_CINEMA_PUBLIC_SCHEDULE_URL || defaultPublicUrl);
  if (requestUrl.protocol !== "https:") throw new Error("Public schedule URL must use HTTPS.");
  requestUrl.searchParams.set("deployment_snapshot", process.env.CI_PIPELINE_ID || String(Date.now()));

  const localSchedule = JSON.parse(await readFile(schedulePath, "utf8"));
  let publicSchedule = null;
  try {
    publicSchedule = await fetchPublicSchedule(requestUrl);
  } catch (error) {
    console.warn(`Public seat snapshot unavailable: ${error.message}`);
  }

  const decision = chooseSeatSnapshot({ localSchedule, publicSchedule, maxSeatAgeMs });
  if (decision.changed) {
    await writeFileAtomic(schedulePath, `${JSON.stringify(decision.schedule, null, 2)}\n`, "utf8");
  }
  console.log(`Seat snapshot source: ${decision.source} (${decision.reason}).`);
  console.log(`seatStatusVerifiedAt: ${decision.schedule.meta.seatStatusVerifiedAt}`);
}

export { chooseSeatSnapshot, scheduleIdentity };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
