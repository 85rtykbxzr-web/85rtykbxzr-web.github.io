import { assertBrowserCollectionContract, isBrowserLiveVenue } from "../src/browser-live-schedule.mjs";
import { readFile } from "node:fs/promises";
import {
  isIntentionallySkippedSourceHealth,
  isNonBlockingSourceHealthWarning
} from "./source-health-status.mjs";

const scheduleSource = process.env.SEOUL_CINEMA_AUDIT_SCHEDULE_URL || "data/schedule.json";
const healthSource = process.env.SEOUL_CINEMA_AUDIT_SOURCE_HEALTH_URL || "data/source-health.json";
const configuredRequestTimeoutMs = Number(process.env.SEOUL_CINEMA_HEALTH_REQUEST_TIMEOUT_MS);
const requestTimeoutMs = Number.isFinite(configuredRequestTimeoutMs) && configuredRequestTimeoutMs > 0 ? configuredRequestTimeoutMs : 8000;

const expectedVenueOrder = [
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
];

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

const primaryParserProfileBySourceId = {
  "cinecube-time-order": {
    type: "structured-api",
    baseScore: 90,
    risk: "낮음",
    fallback: "기존 데이터 보존",
    strengthen: "날짜 목록이 비면 저장된 최근 회차와 비교하고, API 응답 필드 스키마 변화를 별도로 감지"
  },
  "momo-dtryx-showtimes": {
    type: "dtryx-api",
    baseScore: 88,
    risk: "낮음",
    fallback: "Dtryx public showseq API + 기존 데이터 보존",
    strengthen: "type2 API와 public showseq 결과를 합집합으로 비교해 더 풍부한 결과 채택"
  },
  "laika-dtryx-showtimes": {
    type: "dtryx-api",
    baseScore: 88,
    risk: "낮음",
    fallback: "Dtryx public showseq API + 기존 데이터 보존",
    strengthen: "공식/예매 페이지 HTML에서 날짜 버튼을 보조 추출해 API 날짜 누락 방지"
  },
  "emu-dtryx-showtimes": {
    type: "dtryx-api",
    baseScore: 88,
    risk: "낮음",
    fallback: "Dtryx public showseq API + 기존 데이터 보존",
    strengthen: "public showseq 결과와 type2 결과의 날짜 수 차이를 경고로 저장"
  },
  "forest-schedule": {
    type: "dtryx-api",
    baseScore: 86,
    risk: "보통",
    fallback: "Dtryx public showseq API + 기존 데이터 보존",
    strengthen: "날짜별 회차가 갑자기 줄면 공식 Dtryx 페이지의 날짜 버튼 기준으로 재조회"
  },
  "arirang-dtryx-showtimes": {
    type: "dtryx-api",
    baseScore: 82,
    risk: "보통",
    fallback: "Dtryx public showseq API + 기존 데이터 보존",
    strengthen: "공식 사이트 일정 HTML 파서를 추가해 짧은 날짜 범위를 보완"
  },
  "artnine-dtryx-showtimes": {
    type: "dtryx-api",
    baseScore: 86,
    risk: "보통",
    fallback: "Dtryx public showseq API + 기존 데이터 보존",
    strengthen: "litt.ly 경유보다 실제 Dtryx URL을 우선 기준으로 고정하고 리다이렉트 변화 감지"
  },
  "filmforum-moviee-showtimes": {
    type: "moviee-api",
    baseScore: 84,
    risk: "보통",
    fallback: "기존 데이터 보존",
    strengthen: "공식 시간표 HTML을 실제 2차 파서로 승격해 Moviee API 장애 시 보완"
  },
  "sangsangmadang-cinema": {
    type: "moviee-api",
    baseScore: 84,
    risk: "보통",
    fallback: "기존 데이터 보존",
    strengthen: "상상마당 영화 목록 HTML을 보조 파서로 붙여 Moviee API 장애 감지"
  },
  "kucine-moviee-showtimes": {
    type: "moviee-api",
    baseScore: 80,
    risk: "보통",
    fallback: "기존 데이터 보존",
    strengthen: "공식 예약 페이지 HTML에서 theater id와 날짜 목록을 검증"
  },
  "sac-timetable": {
    type: "official-html-table",
    baseScore: 78,
    risk: "보통",
    fallback: "기존 데이터 보존",
    strengthen: "프로그램 상세 페이지에서 날짜/시간 텍스트를 2차로 긁어 표 구조 변경에 대비"
  },
  "kofa-schedule": {
    type: "official-html-calendar",
    baseScore: 80,
    risk: "보통",
    fallback: "기존 데이터 보존",
    strengthen: "캘린더 상세 블록 외 모바일/예약 id 패턴도 함께 파싱해 구조 변경에 대비"
  },
  "indiespace-official-posts": {
    type: "official-html-prose",
    baseScore: 70,
    risk: "높음",
    fallback: "기존 데이터 보존",
    strengthen: "최신 게시글 후보를 더 넓게 수집하고 날짜/시간 문장 패턴을 계속 추가, 못 읽은 글은 검토 큐로 저장"
  },
  "movieland-cafe24-options": {
    type: "cafe24-option-html",
    baseScore: 72,
    risk: "높음",
    fallback: "기존 데이터 보존",
    strengthen: "옵션명 정규식을 다양화하고 상품 본문 텍스트에서 날짜/시간을 2차 추출"
  },
  "heyri-dtryx-showtimes": {
    type: "dtryx-api",
    baseScore: 86,
    risk: "보통",
    fallback: "Dtryx public showseq API + 기존 데이터 보존",
    strengthen: "scinema.org 예매 도메인을 기준으로 showseq 보조 API까지 같이 검증"
  }
};

function todayKst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function readJson(source) {
  if (!/^https?:\/\//i.test(source)) return JSON.parse(await readFile(source, "utf8"));

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`${source} timed out after ${requestTimeoutMs}ms`)),
    requestTimeoutMs
  );
  try {
    const response = await fetch(source, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`${source} returned HTTP ${response.status}`);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`${source} did not return valid JSON: ${error.message}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function uniqueDates(sessions) {
  return [...new Set(sessions.map((session) => session.date).filter(Boolean))].sort();
}

function isBlockingHealthFailure(row) {
  return row.ok === false && row.blocking !== false;
}

function percent(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function grade(score) {
  if (score >= 92) return "S";
  if (score >= 84) return "A";
  if (score >= 72) return "B";
  if (score >= 60) return "C";
  return "D";
}

function profileForSources(sources) {
  const liveSources = sources.filter((source) => String(source.parserStatus || "").startsWith("live"));
  const primary =
    liveSources.find((source) => primaryParserProfileBySourceId[source.id]) ||
    sources.find((source) => primaryParserProfileBySourceId[source.id]) ||
    liveSources[0] ||
    sources[0] ||
    {};
  return {
    primary,
    profile: primaryParserProfileBySourceId[primary.id] || {
      type: primary.parserStatus || "unknown",
      baseScore: 55,
      risk: "높음",
      fallback: "없음",
      strengthen: "상영관별 공식 소스 확인 필요"
    }
  };
}

function scoreVenue({ sessions, sources, healthRows, profile, minimum }) {
  let score = profile.baseScore;
  const dateCount = uniqueDates(sessions).length;
  const upstreamCoverage = confirmedUpstreamCoverage(healthRows, sessions.length, dateCount);
  const bookingCoverage = percent(sessions.filter((session) => session.bookingType === "booking" && session.bookingUrl).length, sessions.length);
  const posterCoverage = percent(sessions.filter((session) => session.posterUrl).length, sessions.length);
  const exactTimeCoverage = percent(sessions.filter((session) => /^\d{2}:\d{2}$/.test(String(session.time || ""))).length, sessions.length);
  const hasConfiguredFallback = /public showseq|기존 데이터 보존/.test(profile.fallback || "");
  const hasManualMonitor = sources.some((source) => ["monitor", "manual", "manual-image-heavy"].includes(source.parserStatus));

  if (bookingCoverage >= 90) score += 4;
  if (posterCoverage >= 70) score += 3;
  if (exactTimeCoverage === 100) score += 3;
  if (hasConfiguredFallback) score += 3;
  if (hasManualMonitor) score += 2;
  if (minimum && sessions.length >= minimum.sessions * 2) score += 2;
  if (minimum && dateCount >= minimum.dates * 2) score += 2;

  if (!sessions.length) score -= 35;
  if (minimum && sessions.length < minimum.sessions && !upstreamCoverage) score -= 25;
  if (minimum && dateCount < minimum.dates && !upstreamCoverage) score -= 20;
  if (!sources.some((source) => String(source.parserStatus || "").startsWith("live"))) score -= 25;
  if (healthRows.some(isBlockingHealthFailure)) score -= 20;
  if (healthRows.some((row) => row.preservedExisting || isNonBlockingSourceHealthWarning(row))) score -= 10;
  if (healthRows.some((row) => row.fallbackMerged)) score += 1;
  if (profile.risk === "높음") score -= 4;
  if (profile.risk === "보통") score -= 1;

  return Math.max(0, Math.min(98, Math.round(score)));
}

function confirmedUpstreamCoverage(healthRows, sessionCount, dateCount) {
  for (const row of healthRows) {
    const upstreamDateCount = Number(row.upstreamActiveDateCount ?? row.upstreamDateCount);
    const liveDateCount = Number(row.liveDateCount);
    const liveSessionCount = Number(row.liveSessionCount);
    if (
      row.ok === true &&
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

function venueIssues({ venue, sessions, sources, healthRows, minimum }) {
  const errors = [];
  const warnings = [];
  const dateCount = uniqueDates(sessions).length;
  if (!sources.length) errors.push(`${venue.name} source missing`);
  if (!sources.some((source) => String(source.parserStatus || "").startsWith("live"))) {
    errors.push(`${venue.name} live parser missing`);
  }
  if (!sessions.length) errors.push(`${venue.name} has no sessions`);
  const coverageBelowFloor = minimum && (sessions.length < minimum.sessions || dateCount < minimum.dates);
  const upstreamCoverage = coverageBelowFloor
    ? confirmedUpstreamCoverage(healthRows, sessions.length, dateCount)
    : null;
  if (upstreamCoverage) {
    warnings.push(
      `${venue.name} coverage below floor ${sessions.length}/${minimum.sessions} sessions, ${dateCount}/${minimum.dates} dates; official source currently publishes ${upstreamCoverage.confirmedDateCount} active date(s)`
    );
  } else {
    if (minimum && sessions.length < minimum.sessions) {
      errors.push(`${venue.name} session count below floor ${sessions.length}/${minimum.sessions}`);
    }
    if (minimum && dateCount < minimum.dates) {
      errors.push(`${venue.name} date count below floor ${dateCount}/${minimum.dates}`);
    }
  }
  for (const row of healthRows) {
    if (isBlockingHealthFailure(row)) errors.push(`${venue.name} source health failed: ${row.sourceId}`);
  }
  return { errors, warnings };
}

const schedule = await readJson(scheduleSource);
const health = await readJson(healthSource);
assertBrowserCollectionContract(schedule, health);
const today = todayKst();
const sessionsByVenue = Object.groupBy(
  (schedule.sessions || []).filter((session) => !session.date || session.date >= today),
  (session) => session.venueId || "unknown"
);
const sourcesByVenue = Object.groupBy(schedule.sources || [], (source) => source.venueId || "unknown");
const healthBySourceId = new Map((health.health || []).map((row) => [row.sourceId, row]));
const venuesById = new Map((schedule.venues || []).map((venue) => [venue.id, venue]));
const errors = [];
const warnings = [];

const rows = expectedVenueOrder.map((venueId) => {
  const venue = venuesById.get(venueId) || { id: venueId, name: venueId };
  if (isBrowserLiveVenue(schedule, venueId)) return { id: venueId, name: venue.name, grade: "BROWSER", score: null, sessions: 0, dates: 0, health: "deferred-to-browser", verification: "Official API is verified per visit, not by this server audit" };
  const sessions = sessionsByVenue[venueId] || [];
  const sources = sourcesByVenue[venueId] || [];
  const healthRows = sources.map((source) => healthBySourceId.get(source.id)).filter(Boolean);
  const dates = uniqueDates(sessions);
  const minimum = venueCoverageMinimums[venueId];
  const { primary, profile } = profileForSources(sources);
  const score = scoreVenue({ sessions, sources, healthRows, profile, minimum });
  const findings = venueIssues({ venue, sessions, sources, healthRows, minimum });
  errors.push(...findings.errors);
  warnings.push(...findings.warnings);

  return {
    id: venueId,
    name: venue.name,
    grade: grade(score),
    score,
    risk: profile.risk,
    parserType: profile.type,
    primarySourceId: primary.id || "",
    sessions: sessions.length,
    dates: dates.length,
    firstDate: dates[0] || "",
    lastDate: dates.at(-1) || "",
    bookingCoverage: `${percent(sessions.filter((session) => session.bookingType === "booking" && session.bookingUrl).length, sessions.length)}%`,
    posterCoverage: `${percent(sessions.filter((session) => session.posterUrl).length, sessions.length)}%`,
    fallbackUsed: healthRows.some((row) => row.fallbackMerged),
    fallbackDetail: healthRows
      .filter((row) => row.fallbackMerged)
      .map((row) => `${row.sourceId}: +${row.fallbackSessionCount || 0} fallback sessions`)
      .join(" | "),
    health: healthRows
      .map((row) => {
        const status = isIntentionallySkippedSourceHealth(row)
          ? "skipped"
          : isBlockingHealthFailure(row)
          ? "fail"
          : isNonBlockingSourceHealthWarning(row)
            ? "warn"
            : row.fallbackMerged
              ? "fallback"
              : "ok";
        return `${row.sourceId}:${status}:${row.liveSessionCount ?? "-"}`;
      })
      .join(" | "),
    fallback: profile.fallback,
    strengthen: profile.strengthen
  };
});

const counts = countBy(rows, (row) => row.grade);
const highRiskRows = rows.filter((row) => row.risk === "높음" || row.grade === "C" || row.grade === "D");

if (errors.length) {
  console.error(`Parser quality audit failed with ${errors.length} issue(s):`);
  for (const error of errors.slice(0, 60)) console.error(`- ${error}`);
  if (errors.length > 60) console.error(`- ...and ${errors.length - 60} more`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checkedAt: health.checkedAt || "",
      warnings,
      grades: counts,
      highRiskVenues: highRiskRows.map((row) => row.name),
      rows
    },
    null,
    2
  )
);
