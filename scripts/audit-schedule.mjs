import { assertBrowserCollectionContract, isBrowserLiveVenue } from "../src/browser-live-schedule.mjs";
import { readFile } from "node:fs/promises";
import {
  cleanFestivalDisplayTitle,
  isFestivalSession,
  isNamedFestivalLabel,
  resolveFestivalIdentity
} from "../src/festival-labels.mjs";

const schedulePath = "data/schedule.json";
const healthPath = "data/source-health.json";

const expectedVenueIds = new Set([
  "kofa",
  "sac",
  "laika",
  "indiespace",
  "momo",
  "cinecube",
  "emu",
  "forest",
  "arirang",
  "filmforum",
  "sangsangmadang",
  "movieland",
  "artnine",
  "kucine",
  "heyri"
]);

const venueCoverageMinimums = {
  kofa: { sessions: 12, dates: 4 },
  sac: { sessions: 12, dates: 5 },
  laika: { sessions: 20, dates: 3 },
  indiespace: { sessions: 12, dates: 4 },
  momo: { sessions: 20, dates: 3 },
  cinecube: { sessions: 20, dates: 3 },
  emu: { sessions: 10, dates: 2 },
  forest: { sessions: 10, dates: 2 },
  arirang: { sessions: 4, dates: 1 },
  filmforum: { sessions: 10, dates: 2 },
  sangsangmadang: { sessions: 10, dates: 2 },
  movieland: { sessions: 1, dates: 1 },
  artnine: { sessions: 10, dates: 2 },
  kucine: { sessions: 4, dates: 1 },
  heyri: { sessions: 8, dates: 2 }
};

const bookingUrlPatterns = [
  /cinecube\.co\.kr\/cinema\/time-order-table\?/i,
  /arthousemomo\.co\.kr\/pages\/ti\.php\?/i,
  /(?:dtryx\.com|scinema\.org)\/reserve\/movie\.do\?/i,
  /tinyticket\.net\/event\//i,
  /moviee\.co\.kr\/Movie\/Ticket\?/i,
  /movieland\.co\/product\//i
];

const guideUrlPatterns = [/indiespace\.kr\/notice\/5494/i, /\/ticket(?:ing)?(?:\.asp|\/|$)/i];

const detailOnlyPatterns = [
  /bo_table=program/i,
  /\/program\//i,
  /\/event(?:\?|\/|$)/i,
  /indiespace\.kr\/(?:$|category\/|\d{5,})/i,
  /koreafilm\.or\.kr\/cinematheque\/programs/i,
  /arthousemomo\.co\.kr\/pages\/board\.php\?bo_table=special_program/i
];

const validBookingTypes = new Set(["booking", "official", "guide", "detail"]);
const validStatuses = new Set(["confirmed", "needs-check", "soldout"]);
const validKinds = new Set(["program", "talk", "festival", "package", "special"]);

function todayKst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function fail(message, detail = "") {
  return detail ? `${message}: ${detail}` : message;
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(String(value || "")));
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isSafeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("#")) return true;
  const url = parseUrl(raw);
  return Boolean(url && ["http:", "https:"].includes(url.protocol));
}

function isExternalHttpUrl(value) {
  const url = parseUrl(value);
  return Boolean(url && ["http:", "https:"].includes(url.protocol));
}

function isBlockingHealthFailure(row) {
  return row.ok === false && row.blocking !== false;
}

function validateUrlFields(value, errors, path = "schedule") {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => validateUrlFields(item, errors, `${path}[${index}]`));
    return;
  }

  for (const [key, fieldValue] of Object.entries(value)) {
    const fieldPath = `${path}.${key}`;
    if (/url$/i.test(key) && fieldValue && !isSafeUrl(fieldValue)) {
      errors.push(fail("Unsafe URL field", `${fieldPath} ${String(fieldValue).slice(0, 120)}`));
      continue;
    }
    validateUrlFields(fieldValue, errors, fieldPath);
  }
}

function hasParams(url, params) {
  return params.every((param) => String(url.searchParams.get(param) || "").trim());
}

function isConcreteBookingUrl(value) {
  const url = parseUrl(value);
  if (!url) return false;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const path = url.pathname.toLowerCase();

  if (host === "cinecube.co.kr" && path === "/cinema/time-order-table") {
    return hasParams(url, ["movieCd", "playSDT", "screenId", "showSeq"]);
  }
  if (host === "arthousemomo.co.kr" && path === "/pages/ti.php") {
    return hasParams(url, ["MovieCd", "PlaySDT", "ScreenCd", "ShowSeq"]);
  }
  if ((host === "dtryx.com" || host === "scinema.org") && path === "/reserve/movie.do") {
    return hasParams(url, ["cgid", "CinemaCd", "MovieCd", "PlaySDT", "ScreenCd", "ShowSeq"]);
  }
  if (host === "moviee.co.kr" && path === "/movie/ticket") {
    return hasParams(url, ["tid", "mId", "playDt", "tsId", "pno"]);
  }
  if (host === "tinyticket.net" && /^\/event\/[A-Za-z0-9_-]+/.test(url.pathname)) {
    return true;
  }
  if (host === "movieland.co" && /^\/product\/[^/]+\/\d+\/?$/.test(url.pathname)) {
    return hasParams(url, ["item_code"]);
  }
  return false;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function confirmedUpstreamCoverage(rows, sessionCount, dateCount) {
  for (const row of rows) {
    const upstreamDateCount = Number(row.upstreamActiveDateCount ?? row.upstreamDateCount);
    const liveDateCount = Number(row.liveDateCount);
    const liveSessionCount = Number(row.liveSessionCount);
    if (
      (row.ok === true || row.lastOk === true) &&
      !row.preservedExisting &&
      upstreamDateCount > 0 &&
      liveDateCount === upstreamDateCount &&
      liveSessionCount > 0 &&
      dateCount >= liveDateCount &&
      sessionCount >= liveSessionCount
    ) {
      return { ...row, confirmedDateCount: upstreamDateCount };
    }
  }
  return null;
}

function validateSessions(schedule, errors) {
  const venueIds = new Set(schedule.venues.map((venue) => venue.id));
  const sourceIds = new Set(schedule.sources.map((source) => source.id));
  const sessionIds = new Map();
  const duplicateNaturalKeys = new Map();

  for (const session of schedule.sessions) {
    sessionIds.set(session.id, (sessionIds.get(session.id) || 0) + 1);
    const naturalKey = `${session.venueId}|${session.date}|${session.time}|${session.title}|${session.screen || ""}`;
    duplicateNaturalKeys.set(naturalKey, (duplicateNaturalKeys.get(naturalKey) || 0) + 1);

    if (!session.id) errors.push(fail("Session is missing id", session.title));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(session.date || "")) errors.push(fail("Session has invalid date", `${session.id} ${session.date}`));
    if (!/^\d{2}:\d{2}$/.test(session.time || "")) errors.push(fail("Session has invalid time", `${session.id} ${session.time}`));
    if (!session.title) errors.push(fail("Session is missing title", session.id));
    if (!venueIds.has(session.venueId)) errors.push(fail("Session references unknown venue", `${session.id} ${session.venueId}`));
    if (session.sourceId && !sourceIds.has(session.sourceId)) errors.push(fail("Session references unknown source", `${session.id} ${session.sourceId}`));
    if (!validBookingTypes.has(session.bookingType)) errors.push(fail("Session has invalid bookingType", `${session.id} ${session.bookingType}`));
    if (!validStatuses.has(session.status)) errors.push(fail("Session has invalid status", `${session.id} ${session.status}`));
    if (!validKinds.has(session.kind)) errors.push(fail("Session has invalid kind", `${session.id} ${session.kind}`));

    const url = session.bookingUrl || session.detailUrl || "";
    if (!isExternalHttpUrl(url)) {
      errors.push(fail("Session is missing an external action URL", `${session.id} ${session.title || ""}`));
    }
    if (session.bookingType === "booking" && !matchesAny(url, bookingUrlPatterns)) {
      errors.push(fail("Booking-labeled session does not use an approved booking URL", `${session.id} ${url}`));
    }
    if (session.bookingType === "booking" && !isConcreteBookingUrl(url)) {
      errors.push(fail("Booking-labeled session is missing concrete booking parameters", `${session.id} ${url}`));
    }
    if (session.bookingType === "booking" && matchesAny(url, detailOnlyPatterns) && !matchesAny(url, bookingUrlPatterns)) {
      errors.push(fail("Detail/program URL is mislabeled as booking", `${session.id} ${url}`));
    }
    if (session.bookingType !== "booking" && session.actionLabel === "예매") {
      errors.push(fail("Non-booking session uses booking action label", `${session.id} ${url}`));
    }
    if (session.bookingType === "guide" && !matchesAny(url, guideUrlPatterns)) {
      errors.push(fail("Guide-labeled session does not use an approved guide URL", `${session.id} ${url}`));
    }
  }

  for (const [id, count] of sessionIds) {
    if (count > 1) errors.push(fail("Duplicate session id", `${id} x${count}`));
  }

  for (const [key, count] of duplicateNaturalKeys) {
    if (count > 1) errors.push(fail("Duplicate natural session key", `${key} x${count}`));
  }
}

function validatePrograms(schedule, errors) {
  for (const program of schedule.programs || []) {
    if (!program.id) errors.push(fail("Program card is missing id", program.title || ""));
    if (!program.title) errors.push(fail("Program card is missing title", program.id || ""));
    if (!isExternalHttpUrl(program.url)) {
      errors.push(fail("Program card is missing an external URL", `${program.id || ""} ${program.title || ""}`));
    }
  }
}

function validateFestivalLabels(schedule, errors) {
  const venueNames = new Map((schedule.venues || []).map((venue) => [venue.id, venue.name]));
  const validConfidences = new Set(["high", "medium", "low"]);

  for (const session of (schedule.sessions || []).filter(isFestivalSession)) {
    const identity = resolveFestivalIdentity({
      session,
      programs: schedule.programs,
      venueName: venueNames.get(session.venueId) || "상영관"
    });
    if (!identity.name || !isNamedFestivalLabel(identity.name)) {
      errors.push(fail("Festival session has no usable display name", `${session.id} ${identity.name || ""}`));
      continue;
    }
    if (/^(?:일반|영화제|페스티벌)$/i.test(cleanFestivalDisplayTitle(identity.name))) {
      errors.push(fail("Festival session resolved to a generic name", `${session.id} ${identity.name}`));
    }
    if (identity.source === "venue-fallback") {
      errors.push(fail("Festival name needs an official program match", `${session.id} ${identity.name}`));
    }

    const storedMetadata = [session.festivalName, session.festivalNameSource, session.festivalNameConfidence];
    if (storedMetadata.some(Boolean) && !storedMetadata.every(Boolean)) {
      errors.push(fail("Festival name metadata is incomplete", session.id));
    }
    if (session.festivalName && cleanFestivalDisplayTitle(session.festivalName) !== identity.name) {
      errors.push(
        fail("Stored festival name disagrees with current source data", `${session.id} ${session.festivalName} -> ${identity.name}`)
      );
    }
    if (session.festivalNameSource && session.festivalNameSource !== identity.source) {
      errors.push(
        fail(
          "Stored festival name source disagrees with current source data",
          `${session.id} ${session.festivalNameSource} -> ${identity.source}`
        )
      );
    }
    if (session.festivalNameConfidence && !validConfidences.has(session.festivalNameConfidence)) {
      errors.push(fail("Festival name has invalid confidence", `${session.id} ${session.festivalNameConfidence}`));
    }
    if (session.festivalProgramId && session.festivalProgramId !== identity.programId) {
      errors.push(
        fail("Stored festival program id disagrees with current source data", `${session.id} ${session.festivalProgramId}`)
      );
    }
  }
}

function validateCoverage(schedule, health, errors, warnings) {
  const venueIds = new Set(schedule.venues.map((venue) => venue.id));
  const sourceIds = new Set(schedule.sources.map((source) => source.id));
  const sessionsByVenue = countBy(schedule.sessions, (session) => session.venueId);
  const datesByVenue = (schedule.sessions || []).reduce((acc, session) => {
    if (!session.venueId || !session.date) return acc;
    acc[session.venueId] ||= new Set();
    acc[session.venueId].add(session.date);
    return acc;
  }, {});
  const sourcesByVenue = schedule.sources.reduce((acc, source) => {
    acc[source.venueId] ||= [];
    acc[source.venueId].push(source);
    return acc;
  }, {});
  const healthBySourceId = new Map((health.health || []).map((row) => [row.sourceId, row]));

  for (const expectedVenueId of expectedVenueIds) {
    if (!venueIds.has(expectedVenueId)) errors.push(fail("Expected venue is missing", expectedVenueId));
  }

  assertBrowserCollectionContract(schedule, health);
  for (const venue of schedule.venues) {
    if (isBrowserLiveVenue(schedule, venue.id)) continue;
    if (!expectedVenueIds.has(venue.id)) errors.push(fail("Unexpected venue needs scope review", venue.id));
    if (!sessionsByVenue[venue.id]) errors.push(fail("Venue has no sessions", venue.id));
    const minimum = venueCoverageMinimums[venue.id];
    if (minimum) {
      const sessionCount = sessionsByVenue[venue.id] || 0;
      const dateCount = datesByVenue[venue.id]?.size || 0;
      const venueSources = sourcesByVenue[venue.id] || [];
      const healthRows = venueSources.map((source) => healthBySourceId.get(source.id)).filter(Boolean);
      const coverageBelowFloor = sessionCount < minimum.sessions || dateCount < minimum.dates;
      const upstreamCoverage = coverageBelowFloor
        ? confirmedUpstreamCoverage([...venueSources, ...healthRows], sessionCount, dateCount)
        : null;
      if (upstreamCoverage) {
        warnings.push(
          `Venue coverage matches shorter official publication window: ${venue.id} ${sessionCount}/${minimum.sessions} sessions, ${dateCount}/${minimum.dates} dates, upstream ${upstreamCoverage.confirmedDateCount} active date(s)`
        );
      } else {
        if (sessionCount < minimum.sessions) {
          errors.push(fail("Venue session count dropped below parser safety floor", `${venue.id} ${sessionCount}/${minimum.sessions}`));
        }
        if (dateCount < minimum.dates) {
          errors.push(fail("Venue active date count dropped below parser safety floor", `${venue.id} ${dateCount}/${minimum.dates}`));
        }
      }
    }
    if (!sourcesByVenue[venue.id]?.length) errors.push(fail("Venue has no source", venue.id));
    if (!sourcesByVenue[venue.id]?.some((source) => String(source.parserStatus || "").startsWith("live"))) {
      errors.push(fail("Venue has no live parser source", venue.id));
    }
  }

  for (const source of schedule.sources) {
    if (source.venueId && !venueIds.has(source.venueId)) errors.push(fail("Source references unknown venue", `${source.id} ${source.venueId}`));
  }

  for (const row of health.health || []) {
    if (!sourceIds.has(row.sourceId)) errors.push(fail("Health row references unknown source", row.sourceId));
    if (isBlockingHealthFailure(row)) errors.push(fail("Source health failed", `${row.sourceId} ${row.status || ""}`));
    if (String(row.parserStatus || "").startsWith("live") && Number(row.liveSessionCount || 0) <= 0) {
      errors.push(fail("Live source returned no sessions", row.sourceId));
    }
  }
}

function validateNoPastDates(schedule, errors) {
  const today = todayKst();
  const datedCollections = [
    ["schedule.sessions", schedule.sessions || []],
    ["schedule.festivals", schedule.festivals || []]
  ];

  for (const [label, items] of datedCollections) {
    const past = items.filter((item) => item?.date && item.date < today);
    if (past.length) {
      const sample = past
        .slice(0, 5)
        .map((item) => `${item.date} ${item.title || item.name || item.id || ""}`.trim())
        .join(", ");
      errors.push(fail(`${label} contains past dates before ${today}`, `${past.length} item(s); ${sample}`));
    }
  }
}

function validateSecureImageUrls(schedule, errors) {
  const imageFields = ["posterUrl", "thumbnailUrl", "imageUrl", "logoUrl"];
  for (const collectionName of ["sessions", "programs", "festivals", "majorFestivals"]) {
    for (const [index, item] of (schedule[collectionName] || []).entries()) {
      for (const field of imageFields) {
        const value = String(item?.[field] || "").trim();
        if (!value) continue;
        if (/^http:\/\//i.test(value)) {
          errors.push(fail("Insecure image URL", `${collectionName}[${index}].${field} ${value.slice(0, 120)}`));
        }
        if (/^https?:\/\/moviee\.co\.kr\/DisplayImage\?/i.test(value)) {
          errors.push(fail("Unreliable Moviee image URL", `${collectionName}[${index}].${field}`));
        }
      }
    }
  }
}

function validateCoverageScope(schedule, errors) {
  const scope = schedule.coverageScope;
  if (!scope || typeof scope !== "object") {
    errors.push("No coverageScope found");
    return;
  }

  const included = new Set(scope.includedVenueIds || []);
  for (const venue of schedule.venues || []) {
    if (!included.has(venue.id)) errors.push(fail("coverageScope is missing included venue", venue.id));
  }

  const candidates = scope.reviewedCandidates || [];
  if (!Array.isArray(candidates) || candidates.length < 3) {
    errors.push("coverageScope reviewedCandidates is missing or too small");
  }

  for (const candidate of candidates) {
    if (!candidate.id || !candidate.name) errors.push(fail("coverage candidate is missing id/name", JSON.stringify(candidate)));
    if (!["deferred", "excluded"].includes(candidate.status)) {
      errors.push(fail("coverage candidate has invalid status", `${candidate.id} ${candidate.status}`));
    }
    if (!candidate.reason) errors.push(fail("coverage candidate is missing reason", candidate.id));
  }
}

const schedule = await readJson(schedulePath);
const health = await readJson(healthPath);
const errors = [];
const warnings = [];

if (!Array.isArray(schedule.venues) || !schedule.venues.length) errors.push("No venues found");
if (!Array.isArray(schedule.sources) || !schedule.sources.length) errors.push("No sources found");
if (!Array.isArray(schedule.sessions) || !schedule.sessions.length) errors.push("No sessions found");
if (!schedule.sessions.some(isFestivalSession)) errors.push("No festival sessions found");
if (!Array.isArray(schedule.programs) || !schedule.programs.length) errors.push("No program cards found");

validateSessions(schedule, errors);
validatePrograms(schedule, errors);
validateFestivalLabels(schedule, errors);
validateCoverage(schedule, health, errors, warnings);
validateCoverageScope(schedule, errors);
validateUrlFields(schedule, errors);
validateSecureImageUrls(schedule, errors);
validateNoPastDates(schedule, errors);

if (errors.length) {
  console.error(`Schedule audit failed with ${errors.length} issue(s):`);
  for (const error of errors.slice(0, 80)) console.error(`- ${error}`);
  if (errors.length > 80) console.error(`- ...and ${errors.length - 80} more`);
  process.exit(1);
}

const liveSources = schedule.sources.filter((source) => String(source.parserStatus || "").startsWith("live")).length;
const bookingCount = schedule.sessions.filter((session) => session.bookingType === "booking").length;
const festivalCount = schedule.sessions.filter(isFestivalSession).length;
const festivalLabelSources = countBy(schedule.sessions.filter(isFestivalSession), (session) =>
  resolveFestivalIdentity({
    session,
    programs: schedule.programs,
    venueName: schedule.venues.find((venue) => venue.id === session.venueId)?.name || "상영관"
  }).source
);
const counts = countBy(schedule.sessions, (session) => session.venueId);

console.log(
  JSON.stringify(
    {
      ok: true,
      warnings,
      venues: schedule.venues.length,
      sources: schedule.sources.length,
      liveSources,
      sessions: schedule.sessions.length,
      bookingSessions: bookingCount,
      festivalSessions: festivalCount,
      festivalLabelSources,
      range: schedule.meta?.rangeLabel || "",
      counts
    },
    null,
    2
  )
);
