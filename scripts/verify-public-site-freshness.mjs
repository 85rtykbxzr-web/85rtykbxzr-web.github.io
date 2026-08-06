import { pathToFileURL } from "node:url";
import { fetchWithTransientRetry } from "./http-retry.mjs";

const defaultBaseUrl = "https://85rtykbxzr-web.github.io";
const allowedFutureSkewMs = 5 * 60_000;

function positiveNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireArray(value, label, minimumLength = 1) {
  if (!Array.isArray(value) || value.length < minimumLength) {
    throw new Error(`${label} must contain at least ${minimumLength} item(s)`);
  }
  return value;
}

function timestampMs(value, label) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) throw new Error(`${label} is missing or invalid`);
  return parsed;
}

function assertTimestampAge(value, label, maximumAgeHours, nowMs) {
  const parsed = timestampMs(value, label);
  const ageMs = nowMs - parsed;
  if (ageMs < -allowedFutureSkewMs) {
    throw new Error(`${label} is unexpectedly in the future`);
  }
  const maximumAgeMs = maximumAgeHours * 60 * 60_000;
  if (ageMs > maximumAgeMs) {
    throw new Error(`${label} is ${(ageMs / 3_600_000).toFixed(1)}h old; limit is ${maximumAgeHours}h`);
  }
  return { parsed, ageHours: ageMs / 3_600_000 };
}

function assertSameTimestamp(actual, expected, label) {
  if (String(actual || "") !== String(expected || "")) {
    throw new Error(`${label} timestamps differ`);
  }
}

function endpointUrl(baseUrl, path, cacheBuster) {
  const url = new URL(path, `${baseUrl}/`);
  url.searchParams.set("health_run", cacheBuster);
  return url;
}

async function fetchJson(baseUrl, path, cacheBuster, requestOptions) {
  const url = endpointUrl(baseUrl, path, cacheBuster);
  const response = await fetchWithTransientRetry(
    url,
    { cache: "no-store", headers: { accept: "application/json" } },
    requestOptions
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${url} did not return valid JSON: ${error.message}`);
  }
}

function validatePayloads({ health, schedule, trends, sourceHealth }, limits, nowMs = Date.now()) {
  requireObject(health, "healthz.json");
  requireObject(schedule, "schedule.json");
  requireObject(schedule.meta, "schedule.json meta");
  requireArray(schedule.sessions, "schedule.json sessions");
  requireArray(schedule.venues, "schedule.json venues");
  requireObject(trends, "community-trends.json");
  requireArray(trends.items, "community-trends.json items", 4);
  requireObject(sourceHealth, "source-health.json");
  const healthRows = requireArray(sourceHealth.health, "source-health.json health rows");

  if (health.ok !== true || health.mode !== "static" || health.indexable !== true) {
    throw new Error("healthz.json is not a valid indexable static-site health payload");
  }
  if (!/^\d+$/.test(String(health.deploymentId || ""))) {
    throw new Error("healthz.json deploymentId must be numeric");
  }
  if (!/^[0-9a-f]{40}$/i.test(String(health.deploymentCommit || ""))) {
    throw new Error("healthz.json deploymentCommit must be a full Git commit SHA");
  }

  const builtAt = timestampMs(health.builtAt, "healthz.json builtAt");
  if (nowMs - builtAt < -allowedFutureSkewMs) throw new Error("healthz.json builtAt is unexpectedly in the future");

  const scheduleAge = assertTimestampAge(
    schedule.meta.generatedAt,
    "schedule.json generatedAt",
    limits.schedule,
    nowMs
  );
  const seatAge = assertTimestampAge(
    schedule.meta.seatStatusVerifiedAt,
    "schedule.json seatStatusVerifiedAt",
    limits.seats,
    nowMs
  );
  const trendsAge = assertTimestampAge(
    trends.generatedAt,
    "community-trends.json generatedAt",
    limits.trends,
    nowMs
  );
  const sourceAge = assertTimestampAge(
    sourceHealth.checkedAt,
    "source-health.json checkedAt",
    limits.source,
    nowMs
  );

  assertSameTimestamp(health.scheduleGeneratedAt, schedule.meta.generatedAt, "health/schedule generatedAt");
  assertSameTimestamp(
    health.seatStatusVerifiedAt,
    schedule.meta.seatStatusVerifiedAt,
    "health/schedule seatStatusVerifiedAt"
  );
  assertSameTimestamp(health.trendsGeneratedAt, trends.generatedAt, "health/trends generatedAt");
  assertSameTimestamp(health.sourceHealthCheckedAt, sourceHealth.checkedAt, "health/source-health checkedAt");

  for (const [index, row] of healthRows.entries()) {
    requireObject(row, `source-health.json health[${index}]`);
    if (!String(row.sourceId || "").trim()) {
      throw new Error(`source-health.json health[${index}] has no sourceId`);
    }
    timestampMs(row.checkedAt, `source-health.json health[${index}].checkedAt`);
  }

  return {
    deploymentId: String(health.deploymentId),
    deploymentCommit: String(health.deploymentCommit),
    builtAt: health.builtAt,
    scheduleGeneratedAt: schedule.meta.generatedAt,
    seatStatusVerifiedAt: schedule.meta.seatStatusVerifiedAt,
    trendsGeneratedAt: trends.generatedAt,
    sourceHealthCheckedAt: sourceHealth.checkedAt,
    agesHours: {
      schedule: Number(scheduleAge.ageHours.toFixed(2)),
      seats: Number(seatAge.ageHours.toFixed(2)),
      trends: Number(trendsAge.ageHours.toFixed(2)),
      sourceHealth: Number(sourceAge.ageHours.toFixed(2))
    },
    sessions: schedule.sessions.length,
    venues: schedule.venues.length,
    recommendations: trends.items.length,
    sourceHealthRows: healthRows.length
  };
}

async function main() {
  const baseUrl = String(process.env.SITE_HEALTH_URL || defaultBaseUrl).replace(/\/+$/, "");
  const parsedBaseUrl = new URL(baseUrl);
  if (parsedBaseUrl.protocol !== "https:") throw new Error("SITE_HEALTH_URL must use HTTPS");

  const limits = {
    schedule: positiveNumberEnv("SITE_MAX_SCHEDULE_AGE_HOURS", 12),
    seats: positiveNumberEnv("SITE_MAX_SEAT_AGE_HOURS", 2),
    trends: positiveNumberEnv("SITE_MAX_TRENDS_AGE_HOURS", 36),
    source: positiveNumberEnv("SITE_MAX_SOURCE_HEALTH_AGE_HOURS", 36)
  };
  const requestOptions = {
    attempts: Math.floor(positiveNumberEnv("SITE_HEALTH_REQUEST_ATTEMPTS", 3)),
    requestTimeoutMs: positiveNumberEnv("SITE_HEALTH_REQUEST_TIMEOUT_MS", 15_000),
    retryDelayMs: positiveNumberEnv("SITE_HEALTH_RETRY_DELAY_MS", 1_000)
  };
  const cacheBuster = String(process.env.GITHUB_RUN_ID || Date.now());
  const [health, schedule, trends, sourceHealth] = await Promise.all([
    fetchJson(baseUrl, "healthz.json", cacheBuster, requestOptions),
    fetchJson(baseUrl, "data/schedule.json", cacheBuster, requestOptions),
    fetchJson(baseUrl, "data/community-trends.json", cacheBuster, requestOptions),
    fetchJson(baseUrl, "data/source-health.json", cacheBuster, requestOptions)
  ]);
  const result = validatePayloads({ health, schedule, trends, sourceHealth }, limits);
  console.log(JSON.stringify({ ok: true, baseUrl, limitsHours: limits, ...result }, null, 2));
}

export { validatePayloads };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}
