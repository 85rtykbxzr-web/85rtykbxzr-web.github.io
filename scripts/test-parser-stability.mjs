import {
  dtryxVisibleDateRows,
  liveResultFallbackProbeIssue,
  liveResultQualityIssue,
  liveSessionMetrics,
  mergeFallbackResult,
  mergeLiveSessions,
  parseMovielandOfferName,
  refreshMeta,
  sanitizeSourceSnapshot,
  sanitizeScheduleImageUrls,
  seatStatusRefreshIssue,
  sourceSessionMetrics
} from "./update-schedule.mjs";
import { addCalendarDays, addCalendarMonths, calendarDaysBetween } from "../src/calendar-date.mjs";
import { fetchWithTransientRetry } from "./http-retry.mjs";
import {
  createSkippedSourceSnapshotResult,
  isIntentionallySkippedSourceHealth,
  isNonBlockingSourceHealthWarning
} from "./source-health-status.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Real date-calendar shape observed on 2026-09-06: RestYn=Y on a visible
// Sunday with 10 Momo screenings, while HiddenYn=Y suppresses unpublished days.
const visibleDtryxDates = dtryxVisibleDateRows({ Recordset: [
  { PlaySDT: "2026-09-05", HiddenYn: "Y", RestYn: "Y" },
  { PlaySDT: "2026-09-06", HiddenYn: "N", RestYn: "Y" },
  { PlaySDT: "2026-09-07", HiddenYn: "N", RestYn: "N" },
  { PlaySDT: "2026-09-12", HiddenYn: "N", RestYn: "Y" },
  { PlaySDT: "2026-09-15", HiddenYn: "Y", RestYn: "N" }
]}).map((row) => row.PlaySDT);
assert(
  visibleDtryxDates.join(",") === "2026-09-06,2026-09-07,2026-09-12",
  "published weekend screenings must be collected; hidden dates must stay excluded"
);
assert(dtryxVisibleDateRows({}).length === 0, "an empty date calendar should yield no requests");

const snapshotToken = "XMulEo02ExamplePublicSnapshotTokenValue1234567890";
const sanitizedSnapshot = sanitizeSourceSnapshot(
  `<script>window.config={dotAccessToken:"${snapshotToken}","GLOBAL_CSRF_VALUE":"${snapshotToken}",safeLabel:"ordinary public text"};</script>`
);
assert(!sanitizedSnapshot.includes(snapshotToken), "snapshot sanitizer should redact suffix-style token fields");
assert(
  sanitizedSnapshot.includes('dotAccessToken:"[redacted]"'),
  "snapshot sanitizer should preserve the token field while replacing its value"
);
assert(
  sanitizedSnapshot.includes('"GLOBAL_CSRF_VALUE":"[redacted]"'),
  "snapshot sanitizer should redact quoted sensitive field names"
);
assert(sanitizedSnapshot.includes('safeLabel:"ordinary public text"'), "snapshot sanitizer should preserve normal fields");
const harmlessTokenParameter = "sUrl += separator + 'checkoutToken=' + encodeURIComponent(getCookie('session_name'));";
assert(
  sanitizeSourceSnapshot(harmlessTokenParameter) === harmlessTokenParameter,
  "snapshot sanitizer should not rewrite a token-shaped URL parameter name as an assignment"
);
const snapshotJwt = `${"eyJ"}${"a".repeat(24)}.${"b".repeat(24)}.${"c".repeat(16)}`;
assert(!sanitizeSourceSnapshot(`trace.init("public", "${snapshotJwt}")`).includes(snapshotJwt), "snapshot sanitizer should redact JWT values");

assert(addCalendarDays("2026-03-08", 1) === "2026-03-09", "calendar day math should be DST-independent");
assert(addCalendarMonths("2026-10-15", 1) === "2026-11-15", "calendar month math should be timezone-independent");
assert(calendarDaysBetween("2026-03-08", "2026-03-10") === 2, "calendar day differences should use UTC dates");

assert(
  seatStatusRefreshIssue({ expectedSources: 12, successfulSources: 6, fetchedSessions: 40, updatedSessions: 20 }) === "",
  "a majority-backed seat refresh should be accepted"
);
assert(
  seatStatusRefreshIssue({ expectedSources: 12, successfulSources: 5, fetchedSessions: 40, updatedSessions: 20 }).includes(
    "5/12"
  ),
  "a seat refresh with too few usable sources should be rejected"
);
assert(
  seatStatusRefreshIssue({ expectedSources: 12, successfulSources: 12, fetchedSessions: 0, updatedSessions: 0 }).includes(
    "no future sessions"
  ),
  "an empty seat refresh should be rejected"
);
assert(
  seatStatusRefreshIssue({ expectedSources: 12, successfulSources: 12, fetchedSessions: 30, updatedSessions: 0 }).includes(
    "did not match"
  ),
  "a seat refresh that cannot match committed sessions should be rejected"
);

const skippedSnapshot = createSkippedSourceSnapshotResult(
  {
    id: "arirang-program",
    name: "아리랑시네센터 기획전",
    url: "https://example.com/arirang-program",
    skipReason: "자동 갱신에서 제외"
  },
  "2026-08-03T00:00:00.000Z"
);
assert(skippedSnapshot.health.ok === null, "an intentionally skipped source should not be marked healthy");
assert(skippedSnapshot.health.status === null, "an intentionally skipped source should not report a synthetic HTTP status");
assert(skippedSnapshot.health.skipped === true, "an intentionally skipped source should expose its skipped state");
assert(!skippedSnapshot.health.warning, "an intentionally skipped source should not create an operational warning");
assert(
  isIntentionallySkippedSourceHealth(skippedSnapshot.health),
  "the explicit skipped source-health state should be recognized"
);
assert(
  isIntentionallySkippedSourceHealth({
    ok: true,
    blocking: false,
    status: 204,
    warning: "자동 갱신에서 제외"
  }),
  "legacy intentional-skip rows should remain compatible"
);
assert(
  !isNonBlockingSourceHealthWarning({ ok: true, blocking: false, status: 204, warning: "자동 갱신에서 제외" }),
  "legacy intentional-skip rows should not trigger the daily warning"
);
assert(
  isNonBlockingSourceHealthWarning({ ok: false, blocking: false, status: 503, warning: "temporarily unavailable" }),
  "real non-blocking source failures should still trigger warnings"
);

let transientAttempts = 0;
const recoveredResponse = await fetchWithTransientRetry(
  "https://example.com/health",
  {},
  {
    attempts: 3,
    requestTimeoutMs: 100,
    retryDelayMs: 0,
    waitImpl: async () => {},
    fetchImpl: async () => {
      transientAttempts += 1;
      return new Response("", { status: transientAttempts === 1 ? 503 : 200 });
    }
  }
);
assert(recoveredResponse.status === 200, "a transient 503 should recover on retry");
assert(transientAttempts === 2, "a transient 503 should retry only until recovery");

let persistentAttempts = 0;
const persistentResponse = await fetchWithTransientRetry(
  "https://example.com/health",
  {},
  {
    attempts: 3,
    requestTimeoutMs: 100,
    retryDelayMs: 0,
    waitImpl: async () => {},
    fetchImpl: async () => {
      persistentAttempts += 1;
      return new Response("", { status: 503 });
    }
  }
);
assert(persistentResponse.status === 503, "a persistent 503 should still be returned as a failure");
assert(persistentAttempts === 3, "a persistent 503 should stop after the configured attempts");

let notFoundAttempts = 0;
const notFoundResponse = await fetchWithTransientRetry(
  "https://example.com/missing",
  {},
  {
    attempts: 3,
    requestTimeoutMs: 100,
    retryDelayMs: 0,
    waitImpl: async () => {},
    fetchImpl: async () => {
      notFoundAttempts += 1;
      return new Response("", { status: 404 });
    }
  }
);
assert(notFoundResponse.status === 404, "a non-transient HTTP failure should be returned immediately");
assert(notFoundAttempts === 1, "a non-transient HTTP failure should not be retried");

let networkAttempts = 0;
const networkRecoveryResponse = await fetchWithTransientRetry(
  "https://example.com/poster.jpg",
  {},
  {
    attempts: 2,
    requestTimeoutMs: 100,
    retryDelayMs: 0,
    waitImpl: async () => {},
    fetchImpl: async () => {
      networkAttempts += 1;
      if (networkAttempts === 1) throw new Error("temporary network error");
      return new Response("image", { status: 200, headers: { "content-type": "image/jpeg" } });
    }
  }
);
assert(networkRecoveryResponse.status === 200, "a transient network error should recover on retry");
assert(networkAttempts === 2, "a transient network error should use the bounded retry");

function session(sourceId, index, date = "2099-01-01") {
  return {
    id: `${sourceId}-${index}`,
    sourceId,
    venueId: sourceId.split("-")[0],
    date,
    time: `${String(10 + (index % 10)).padStart(2, "0")}:00`,
    timeSort: `${String(10 + (index % 10)).padStart(2, "0")}:00`,
    title: `테스트 ${index}`,
    screen: "테스트관",
    program: "상영시간표",
    kind: "program",
    status: "confirmed",
    bookingType: "official",
    actionLabel: "공식 확인"
  };
}

function sessions(sourceId, count, dateCount) {
  return Array.from({ length: count }, (_, index) => {
    const day = 1 + (index % dateCount);
    return session(sourceId, index, `2099-01-${String(day).padStart(2, "0")}`);
  });
}

const existingSchedule = {
  sessions: [
    ...sessions("sac-timetable", 24, 6),
    ...sessions("cinecube-time-order", 30, 5),
    ...sessions("momo-dtryx-showtimes", 40, 5)
  ]
};
const metrics = sourceSessionMetrics(existingSchedule);

assert(metrics["sac-timetable"].sessions === 24, "source metrics should count future sessions");
assert(metrics["sac-timetable"].dates === 6, "source metrics should count unique future dates");

assert(
  liveResultQualityIssue("sac-timetable", [], metrics).includes("returned 0 sessions"),
  "zero-session live result should be suspicious when existing data is present"
);

assert(
  liveResultQualityIssue("sac-timetable", sessions("sac-timetable", 6, 2), metrics),
  "large session/date drops should be suspicious"
);

assert(
  liveResultQualityIssue("sac-timetable", sessions("sac-timetable", 18, 5), metrics) === "",
  "healthy live result should pass quality checks"
);

const movielandMetrics = sourceSessionMetrics({
  sessions: sessions("movieland-cafe24-options", 2, 1)
});
assert(
  liveResultQualityIssue(
    "movieland-cafe24-options",
    sessions("movieland-cafe24-options", 1, 1),
    movielandMetrics
  ) === "",
  "Movieland may legitimately publish a single future screening"
);

assert(
  liveResultFallbackProbeIssue("momo-dtryx-showtimes", sessions("momo-dtryx-showtimes", 30, 5), metrics),
  "moderate Dtryx drops should trigger a fallback probe"
);

assert(
  liveResultFallbackProbeIssue("momo-dtryx-showtimes", sessions("momo-dtryx-showtimes", 39, 5), metrics),
  "even small Dtryx drops should trigger a bounded fallback probe"
);

assert(
  liveResultFallbackProbeIssue("momo-dtryx-showtimes", sessions("momo-dtryx-showtimes", 40, 5), metrics) === "",
  "unchanged Dtryx coverage should not trigger extra fallback fetches"
);

assert(
  liveResultFallbackProbeIssue("cinecube-time-order", sessions("cinecube-time-order", 20, 5), metrics) === "",
  "sources without a configured fallback should not trigger fallback probes"
);

const mixedDates = [session("sac-timetable", "past", "2000-01-01"), session("sac-timetable", "future", "2099-01-01")];
assert(liveSessionMetrics(mixedDates).sessions === 1, "past sessions should be ignored in live metrics");

const lateEveningNow = new Date("2026-07-31T10:25:00.000Z");
const lateEveningExisting = {
  sessions: [
    { ...session("cinecube-time-order", "past-today", "2026-07-31"), time: "18:00", timeSort: "18:00" },
    { ...session("cinecube-time-order", "future-today", "2026-07-31"), time: "20:00", timeSort: "20:00" },
    ...Array.from({ length: 12 }, (_, index) => ({
      ...session("cinecube-time-order", `tomorrow-${index}`, "2026-08-01"),
      time: `${String(10 + (index % 10)).padStart(2, "0")}:00`,
      timeSort: `${String(10 + (index % 10)).padStart(2, "0")}:00`
    }))
  ]
};
const lateEveningMetrics = sourceSessionMetrics(lateEveningExisting, lateEveningNow);
assert(
  lateEveningMetrics["cinecube-time-order"].sessions === 13,
  "same-day sessions that already started should be ignored in live source comparisons"
);
assert(
  lateEveningMetrics["cinecube-time-order"].dates === 2,
  "late-day live metrics should retain today while an upcoming session remains"
);
assert(
  liveResultQualityIssue(
    "cinecube-time-order",
    lateEveningExisting.sessions.slice(1),
    lateEveningMetrics,
    lateEveningNow
  ) === "",
  "a live result matching the remaining official sessions should not fail fixed all-day floors"
);

const fallbackMerged = mergeFallbackResult(
  { sourceId: "momo-dtryx-showtimes", sessions: sessions("momo-dtryx-showtimes", 3, 1) },
  { sourceId: "momo-dtryx-showtimes", sessions: sessions("momo-dtryx-showtimes", 5, 1) },
  "test fallback merge"
);
assert(fallbackMerged.sessions.length === 5, "fallback merge should keep unique extra sessions");
assert(fallbackMerged.fallbackMerged === true, "fallback merge should mark merged results");

assert(
  parseMovielandOfferName("유레카 7.12 (SUN)-14:30-A1")?.time === "14:30",
  "Movieland parser should keep the original Cafe24 option format"
);

assert(
  parseMovielandOfferName("유레카 7.12 (일) - 14:30 - A1")?.date.endsWith("-07-12"),
  "Movieland parser should accept Korean weekday labels and flexible spacing"
);

assert(
  parseMovielandOfferName("유레카 7월 12일 14:30 A1")?.time === "14:30",
  "Movieland parser should accept Korean month/day option labels"
);

const merged = mergeLiveSessions(
  existingSchedule,
  sessions("cinecube-time-order", 12, 3),
  new Set(["cinecube-time-order"])
);
const mergedMetrics = sourceSessionMetrics(merged);
assert(mergedMetrics["sac-timetable"].sessions === 24, "unrefreshed source should be preserved during merge");
assert(mergedMetrics["cinecube-time-order"].sessions === 12, "refreshed source should be replaced during merge");

const fullCheckedAt = "2099-01-01T00:00:00.000Z";
const seatCheckedAt = "2099-01-01T00:05:00.000Z";
const failedCheckedAt = "2099-01-01T00:10:00.000Z";
const fullRefresh = refreshMeta({ sessions: [session("sac-timetable", 1)] }, fullCheckedAt);
const seatRefresh = refreshMeta(fullRefresh, seatCheckedAt, { seatStatusOnly: true });
const failedRefresh = refreshMeta(fullRefresh, failedCheckedAt, { verificationIncomplete: true });
assert(fullRefresh.meta.generatedAt === fullCheckedAt, "full refresh should stamp generatedAt");
assert(fullRefresh.meta.lastVerifiedAt === fullCheckedAt, "full refresh should stamp lastVerifiedAt");
assert(fullRefresh.meta.rangeLabel === "2099.01.01 - 01.01", "range label should not depend on the host timezone");
assert(seatRefresh.meta.generatedAt === fullCheckedAt, "seat refresh should preserve generatedAt");
assert(seatRefresh.meta.lastVerifiedAt === fullCheckedAt, "seat refresh should preserve lastVerifiedAt");
assert(seatRefresh.meta.seatStatusVerifiedAt === seatCheckedAt, "seat refresh should stamp only seat freshness");
assert(failedRefresh.meta.generatedAt === fullCheckedAt, "incomplete refresh should preserve generatedAt");
assert(failedRefresh.meta.lastVerifiedAt === fullCheckedAt, "incomplete refresh should preserve lastVerifiedAt");
assert(failedRefresh.meta.lastRefreshAttemptAt === failedCheckedAt, "incomplete refresh should record its attempt time");

const sanitizedImages = sanitizeScheduleImageUrls(
  {
    sessions: [{ posterUrl: "https://moviee.co.kr/DisplayImage?key=broken.jpg" }],
    programs: [{ imageUrl: "http://www.emuartspace.com/poster.jpg" }],
    festivals: [],
    majorFestivals: [{ logoUrl: "assets/festival-marks/bifan.png" }]
  },
  { quiet: true }
);
assert(sanitizedImages.sessions[0].posterUrl === "", "unreliable Moviee image endpoints should be removed");
assert(sanitizedImages.programs[0].imageUrl.startsWith("https://"), "external image URLs should be upgraded to HTTPS");
assert(sanitizedImages.majorFestivals[0].logoUrl === "assets/festival-marks/bifan.png", "local image assets should be preserved");

console.log(JSON.stringify({ ok: true }, null, 2));
