import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { isFestivalSession, normalizeFestivalSessions } from "../src/festival-labels.mjs";
import { createSkippedSourceSnapshotResult } from "./source-health-status.mjs";
import { writeFileAtomic } from "./write-file-atomic.mjs";
import { readCafe24Challenge } from "./cafe24-challenge.mjs";
import { browserLiveSourceIds, prepareBrowserLiveSchedule, deferredBrowserHealth } from "../src/browser-live-schedule.mjs";
const collectInBrowser = process.env.SCHEDULE_COLLECTION_MODE === "browser-live";

const schedulePath = "data/schedule.json";
const snapshotDir = "data/source-snapshots";
const healthPath = "data/source-health.json";
const candidatesPath = "data/incoming-candidates.json";
const livePath = "data/live-sessions.json";
const seatStatusMode = process.argv.includes("--seat-status");
const configuredFetchTimeoutMs = Number(process.env.SCHEDULE_FETCH_TIMEOUT_MS || 15000);
const defaultFetchTimeoutMs =
  Number.isFinite(configuredFetchTimeoutMs) && configuredFetchTimeoutMs > 0 ? configuredFetchTimeoutMs : 15000;
const configuredFetchRetries = Number(process.env.SCHEDULE_FETCH_RETRIES ?? 2);
const defaultFetchRetries =
  Number.isFinite(configuredFetchRetries) && configuredFetchRetries > 0 ? Math.floor(configuredFetchRetries) : 0;
const sourceSafetyFloors = {
  "kofa-schedule": { sessions: 12, dates: 4 },
  "sac-timetable": { sessions: 12, dates: 5 },
  "laika-dtryx-showtimes": { sessions: 20, dates: 3 },
  "indiespace-official-posts": { sessions: 12, dates: 4 },
  "momo-dtryx-showtimes": { sessions: 20, dates: 3 },
  "cinecube-time-order": { sessions: 20, dates: 3 },
  "emu-dtryx-showtimes": { sessions: 10, dates: 2 },
  "forest-schedule": { sessions: 10, dates: 2 },
  "arirang-dtryx-showtimes": { sessions: 4, dates: 1 },
  "filmforum-moviee-showtimes": { sessions: 10, dates: 2 },
  "sangsangmadang-cinema": { sessions: 10, dates: 2 },
  "movieland-cafe24-options": { sessions: 1, dates: 1 },
  "artnine-dtryx-showtimes": { sessions: 10, dates: 2 },
  "kucine-moviee-showtimes": { sessions: 4, dates: 1 },
  "heyri-dtryx-showtimes": { sessions: 8, dates: 2 }
};
const suspiciousDropSessionRatio = 0.45;
const suspiciousDropDateRatio = 0.5;
const fallbackProbeSessionRatio = 1;
const fallbackProbeDateRatio = 1;

const userAgent = "Mozilla/5.0 (compatible; CineSeoulScheduleBot/0.1; +local curator)";
const defaultRequestHeaders = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.5",
  "user-agent": userAgent
};
const liveSourceIds = new Set([
  "cinecube-time-order",
  "momo-dtryx-showtimes",
  "emu-dtryx-showtimes",
  "arirang-dtryx-showtimes",
  "artnine-dtryx-showtimes",
  "laika-dtryx-showtimes",
  "forest-schedule",
  "kucine-moviee-showtimes",
  "filmforum-moviee-showtimes",
  "sangsangmadang-cinema",
  "movieland-cafe24-options",
  "indiespace-official-posts",
  "sac-timetable",
  "kofa-schedule",
  "heyri-dtryx-showtimes"
]);
const supersededManualSourceIdsByLiveSourceId = new Map([
  ["sac-timetable", ["sac-program"]],
  ["kofa-schedule", ["kofa-program"]],
  ["laika-dtryx-showtimes", ["laika-program"]],
  ["indiespace-official-posts", ["indiespace-program"]]
]);
const bookingUrlPatterns = [
  /cinecube\.co\.kr\/cinema\/time-order-table\?/i,
  /arthousemomo\.co\.kr\/pages\/ti\.php\?/i,
  /(?:dtryx\.com|scinema\.org)\/reserve\/movie\.do\?/i,
  /tinyticket\.net\/event\//i,
  /moviee\.co\.kr\/Movie\/Ticket\?/i,
  /movieland\.co\/product\//i
];
const bookingGuidePatterns = [/indiespace\.kr\/notice\/5494/i, /\/ticket(?:ing)?(?:\.asp|\/|$)/i];
const detailOnlyPatterns = [
  /bo_table=program/i,
  /\/program\//i,
  /\/event(?:\?|\/|$)/i,
  /indiespace\.kr\/(?:$|category\/|\d{5,})/i,
  /koreafilm\.or\.kr\/cinematheque\/programs/i,
  /arthousemomo\.co\.kr\/pages\/board\.php\?bo_table=special_program/i
];
const emuProgramBoardSource = {
  id: "emu-program-board",
  name: "에무시네마 기획전 게시판",
  venueId: "emu",
  url: "http://www.emuartspace.com/bbs/m/all_data_list.php?type=mcb&ep=ep205032292582d223ceaa81&gp=all&menu=hm18722239235a0ea04f620a1",
  parserStatus: "live-html"
};
const programBoardSources = [
  {
    id: "kofa-program",
    name: "시네마테크KOFA 현재 기획전",
    venueId: "kofa",
    url: "https://www.koreafilm.or.kr/cinematheque/screenings",
    parserStatus: "live-html",
    programParser: "kofa"
  },
  {
    id: "sac-program",
    name: "서울아트시네마 프로그램",
    venueId: "sac",
    url: "https://www.cinematheque.seoul.kr/bbs/board.php?sfl=wr_30&bo_table=program&stx=1",
    urls: [
      "https://www.cinematheque.seoul.kr/bbs/board.php?sfl=wr_30&bo_table=program&stx=1",
      "https://www.cinematheque.seoul.kr/bbs/board.php?sfl=wr_29&bo_table=program&stx=1"
    ],
    parserStatus: "live-html",
    programParser: "sac"
  },
  {
    id: "laika-program",
    name: "라이카시네마 기획전/행사",
    venueId: "laika",
    url: "https://laikacinema.com/program/",
    parserStatus: "live-html",
    programParser: "laika"
  },
  {
    id: "indiespace-program",
    name: "인디스페이스 기획전",
    venueId: "indiespace",
    url: "https://indiespace.kr/",
    parserStatus: "live-html",
    programParser: "indiespace"
  },
  {
    id: "momo-program",
    name: "아트하우스 모모 영화제/기획전",
    venueId: "momo",
    url: "https://www.arthousemomo.co.kr/pages/board.php?bo_table=special_program",
    parserStatus: "live-html",
    programParser: "momo"
  },
  {
    id: "cinecube-event",
    name: "씨네큐브 이벤트/기획전",
    venueId: "cinecube",
    url: "https://www.cinecube.co.kr/event",
    parserStatus: "live-html",
    programParser: "strict-event"
  },
  {
    id: "arirang-program",
    name: "아리랑시네센터 기획전",
    venueId: "arirang",
    url: "https://cine.arirang.go.kr:8443/arirang/event/plan.do",
    parserStatus: "live-html",
    programParser: "arirang",
    skipSnapshot: true,
    skipProgramRefresh: true,
    skipReason: "아리랑 행사 페이지는 CI에서 8443 포트 연결 타임아웃이 간헐적으로 발생해 자동 갱신에서 제외하고, 상영시간표는 Dtryx API로 갱신합니다."
  },
  {
    id: "filmforum-program",
    name: "필름포럼 뉴스/기획전",
    venueId: "filmforum",
    url: "http://www.filmforum.kr/community/news/list.asp",
    parserStatus: "watch-html",
    programParser: "strict-event"
  },
  {
    id: "kucine-program",
    name: "KU시네마테크 기획전/GV",
    venueId: "kucine",
    url: "https://kucinema.net/make/",
    parserStatus: "watch-html",
    programParser: "strict-event"
  },
  {
    id: "artnine-program",
    name: "아트나인 프로그램 링크",
    venueId: "artnine",
    url: "https://litt.ly/artnine",
    parserStatus: "watch-html",
    programParser: "strict-event"
  },
  {
    id: "movieland-program",
    name: "무비랜드 프로그램",
    venueId: "movieland",
    url: "https://movieland.co/",
    parserStatus: "watch-html",
    programParser: "strict-event"
  },
  emuProgramBoardSource
];

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#034;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html) {
  return decodeEntities(
    String(html ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function decodeEntitiesPreservingBreaks(value) {
  return String(value ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#034;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function toAbsoluteUrl(baseUrl, href) {
  try {
    return new URL(decodeEntities(href), baseUrl).toString();
  } catch {
    return href;
  }
}

function shortHash(value) {
  return createHash("sha1").update(String(value ?? "")).digest("hex").slice(0, 10);
}

function uniqBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeDate(value) {
  const raw = String(value ?? "").trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return raw;
}

function compactDate(value) {
  return normalizeDate(value).replaceAll("-", "");
}

function formatKstDate(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function todayKst(value = new Date()) {
  return formatKstDate(value);
}

function currentKstTime(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })
    .formatToParts(value)
    .reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  return `${parts.hour}:${parts.minute}`;
}

function upcomingKstDates(days = 14) {
  const start = new Date(`${todayKst()}T00:00:00+09:00`);
  return Array.from({ length: days }, (_, index) => formatKstDate(new Date(start.getTime() + index * 24 * 60 * 60 * 1000)));
}

function normalizeTime(value) {
  const match = String(value ?? "").match(/(\d{1,2}):(\d{2})/);
  if (!match) return "시간 확인";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function detectDates(text) {
  return [...new Set(String(text).match(/(?:20\d{2}[.\-/년]\s*)?\d{1,2}[.\-/월]\s*\d{1,2}(?:\s*\([월화수목금토일]\))?/g) || [])].slice(0, 12);
}

function detectEventWords(text) {
  return [...new Set(String(text).match(/(?:GV|관객과의 대화|씨네토크|기획전|영화제|특별상영|패키지|회고전|강연|이벤트)/g) || [])].slice(0, 12);
}

function fetchTimeoutMs(options) {
  if (options.timeoutMs !== undefined) {
    const value = Number(options.timeoutMs);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  return defaultFetchTimeoutMs;
}

function fetchRetryCount(options) {
  if (options.retries !== undefined) {
    const value = Number(options.retries);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  return defaultFetchRetries;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt) {
  return Math.min(1500, 300 * 2 ** attempt);
}

function shouldRetryStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function describeFetchError(error) {
  const details = [
    error?.name,
    error?.message,
    error?.cause?.code,
    error?.cause?.message
  ].filter(Boolean);
  return details.join(" - ") || "unknown error";
}

function safeSnapshotFilename(sourceId) {
  return String(sourceId || "source").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "source";
}

function sanitizeSourceSnapshot(html) {
  return String(html ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(
      /(<[^>]*\b(?:name|id|data-[\w-]+)=["'][^"']*(?:csrf|token|secret|api[_-]?key|authorization)[^"']*["'][^>]*\b(?:value|content)=)(["'])([^"']*)\2/gi,
      "$1$2[redacted]$2"
    )
    .replace(
      /(<[^>]*\b(?:value|content)=)(["'])([^"']*)(\2[^>]*\b(?:name|id|data-[\w-]+)=["'][^"']*(?:csrf|token|secret|api[_-]?key|authorization)[^"']*["'][^>]*>)/gi,
      "$1$2[redacted]$4"
    )
    .replace(
      /((?:(?<!["'\w$.-])[A-Za-z_$][\w$.-]*(?:csrf|token|secret|api[_-]?key|authorization)[\w$.-]*|(["'])[A-Za-z_$][\w$.-]*(?:csrf|token|secret|api[_-]?key|authorization)[\w$.-]*\2)\s*[:=]\s*)(["'])([^"']{8,})\3/gi,
      (match, prefix, keyQuote, valueQuote) => `${prefix}${valueQuote}[redacted]${valueQuote}`
    )
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{10,})?/g, "[redacted-jwt]")
    .replace(/[ \t]+$/gm, "");
}

async function fetchText(url, options = {}) {
  const { timeoutMs, retries, headers, allowChallenge = true, ...fetchOptions } = options;
  const requestTimeoutMs = fetchTimeoutMs({ timeoutMs });
  const retryCount = fetchRetryCount({ retries });
  let lastError = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = requestTimeoutMs ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(new Error(`fetch timeout after ${requestTimeoutMs}ms`)), requestTimeoutMs)
      : null;
    timeout?.unref?.();

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller?.signal || fetchOptions.signal,
        headers: {
          ...defaultRequestHeaders,
          ...(headers || {})
        }
      });
      const text = await response.text();
      const challenge = allowChallenge ? readCafe24Challenge(text, String(url)) : null;
      if (challenge) {
        return await fetchText(challenge.url, {
          ...options, allowChallenge: false,
          headers: { ...headers, cookie: challenge.cookie }
        });
      }
      if (shouldRetryStatus(response.status) && attempt < retryCount) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      return { response, text };
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount) {
        throw new Error(`fetch failed for ${url}: ${describeFetchError(error)}`, { cause: error });
      }
      await sleep(retryDelayMs(attempt));
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  throw lastError;
}

async function fetchJson(url, options = {}) {
  const { response, text } = await fetchText(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON from ${url}: ${error.message}; ${text.slice(0, 160)}`, { cause: error });
  }
}

const imageUrlFields = ["posterUrl", "thumbnailUrl", "imageUrl", "logoUrl"];

function sanitizeScheduleImageUrls(schedule, options = {}) {
  let removed = 0;
  let upgraded = 0;

  const sanitizeRecords = (records) => (records || []).map((record) => {
    const next = { ...record };
    for (const field of imageUrlFields) {
      const raw = String(next[field] || "").trim();
      if (!/^https?:\/\//i.test(raw)) continue;
      if (/^https?:\/\/moviee\.co\.kr\/DisplayImage\?/i.test(raw)) {
        next[field] = "";
        removed += 1;
        continue;
      }
      if (/^http:\/\//i.test(raw)) {
        next[field] = raw.replace(/^http:\/\//i, "https://");
        upgraded += 1;
      }
    }
    return next;
  });

  const sanitized = {
    ...schedule,
    sessions: sanitizeRecords(schedule.sessions),
    programs: sanitizeRecords(schedule.programs),
    festivals: sanitizeRecords(schedule.festivals),
    majorFestivals: sanitizeRecords(schedule.majorFestivals)
  };
  if (!options.quiet && removed) console.log(`Removed ${removed} unreliable Moviee image URL(s).`);
  if (!options.quiet && upgraded) console.log(`Upgraded ${upgraded} image URL(s) to HTTPS.`);
  return sanitized;
}

function genericPageCandidate(source, html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || source.name;
  const text = stripHtml(html);
  return {
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl: source.url,
    pageTitle: decodeEntities(title),
    detectedDates: detectDates(text),
    detectedEventWords: detectEventWords(text),
    textSample: text.slice(0, 700)
  };
}

function extractBoardLikeItems(source, html) {
  const items = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html))) {
    const href = decodeEntities(match[1]);
    const text = stripHtml(match[2]);
    if (text.length < 4) continue;
    const looksUseful =
      /wr_id=\d+|bmode=view&idx=\d+|\/\d{5,}|time-table|showtimes|schedule|program|event/i.test(href) ||
      /상영시간표|기획전|영화제|GV|씨네토크|상영회|패키지/.test(text);
    if (!looksUseful) continue;

    items.push({
      title: text.slice(0, 140),
      url: toAbsoluteUrl(source.url, href),
      detectedDates: detectDates(text),
      detectedEventWords: detectEventWords(text)
    });
  }
  return uniqBy(items, (item) => `${item.url}::${item.title}`).slice(0, 40);
}

function stripHtmlKeepingKoreanAngles(html) {
  return decodeEntities(
    String(html ?? "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<([가-힣][^<>\n]{0,60})>/g, "〈$1〉")
      .replace(/<[^>]+>/g, " ")
      .replace(/〈/g, "<")
      .replace(/〉/g, ">")
  );
}

function extractIndiespaceListingItems(source, html) {
  const items = [];
  const itemPattern = /<li\b[^>]*>\s*<a\b[^>]*href=["'](\/\d{5,})["'][^>]*>([\s\S]*?)<\/a>\s*<\/li>/gi;
  let match;

  while ((match = itemPattern.exec(html))) {
    const body = match[2];
    const titleHtml = body.match(/<span\b[^>]*class=["']title["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || body;
    const title = stripHtmlKeepingKoreanAngles(titleHtml);
    if (!/상영시간표|상영일정|영화예매|영화제|GV|인디토크|쇼케이스|특별상영|인디돌잔치|썸머/.test(title)) continue;

    items.push({
      title: title.slice(0, 140),
      url: toAbsoluteUrl(source.url, match[1]),
      detectedDates: detectDates(title),
      detectedEventWords: detectEventWords(title)
    });
  }

  return uniqBy(items, (item) => `${item.url}::${item.title}`).slice(0, 40);
}

function extractIndiespaceItems(source, html) {
  const jsonMatch = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/i);
  const listingItems = extractIndiespaceListingItems(source, html);
  if (!jsonMatch) return listingItems;
  try {
    const json = JSON.parse(jsonMatch[1]);
    const jsonItems = (json.itemListElement || [])
      .map((entry) => ({
        title: entry.item?.name,
        url: entry.item?.["@id"],
        detectedDates: detectDates(entry.item?.name || ""),
        detectedEventWords: ["상영시간표"]
      }))
      .filter((item) => item.title && item.url);
    return uniqBy([...listingItems, ...jsonItems], (item) => `${item.url}::${item.title}`).slice(0, 40);
  } catch {
    return listingItems;
  }
}

function sourceCandidate(source, html) {
  const base = genericPageCandidate(source, html);
  const items = source.id === "indiespace-program"
    ? extractIndiespaceItems(source, html)
    : extractBoardLikeItems(source, html);
  return { ...base, items };
}

function programDateKey(year, month, day) {
  const date = new Date(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return "";
  if (date.getFullYear() !== Number(year)) return "";
  if (date.getMonth() + 1 !== Number(month)) return "";
  if (date.getDate() !== Number(day)) return "";
  return formatKstDate(date);
}

function programRangeFromParts(startYear, startMonth, startDay, endYear, endMonth, endDay) {
  const start = programDateKey(startYear, startMonth, startDay);
  let resolvedEndYear = Number(endYear || startYear);
  const resolvedEndMonth = Number(endMonth || startMonth);
  const resolvedEndDay = Number(endDay || startDay);
  if (!endYear && resolvedEndMonth < Number(startMonth)) resolvedEndYear += 1;
  const end = programDateKey(resolvedEndYear, resolvedEndMonth, resolvedEndDay);
  if (!start || !end) return null;
  return { start, end };
}

function normalizeProgramDateText(text) {
  return decodeEntities(text)
    .replace(/\([^)]*[월화수목금토일][^)]*\)/g, " ")
    .replace(/[.\-/]\s*[월화수목금토일](?=\s|$|[.~–—-])/g, " ")
    .replace(/[년월]/g, ".")
    .replace(/일/g, "")
    .replace(/[：:]\s*\d{1,2}\s*분?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseProgramDateRange(text) {
  const normalized = normalizeProgramDateText(text);
  const match = normalized.match(
    /(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*(?:[-~–—]|부터|to)\s*(?:(20\d{2})\s*[.\-/]\s*)?(?:(\d{1,2})\s*[.\-/]\s*)?(\d{1,2})/i
  );
  if (match) {
    return programRangeFromParts(match[1], match[2], match[3], match[4], match[5] || match[2], match[6]);
  }

  const single = normalized.match(/(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  if (single) return programRangeFromParts(single[1], single[2], single[3], single[1], single[2], single[3]);

  const bracket = normalized.match(/\[(\d{1,2})\s*[.\-/]\s*(\d{1,2})\]/);
  if (bracket) {
    const today = new Date(`${todayKst()}T00:00:00+09:00`);
    const year = today.getFullYear() + (Number(bracket[1]) < today.getMonth() + 1 ? 1 : 0);
    return programRangeFromParts(year, bracket[1], bracket[2], year, bracket[1], bracket[2]);
  }

  return null;
}

function programStatusFromRange(range) {
  const today = todayKst();
  if (range.end < today) return "종료";
  if (range.start > today) return "예정";
  return "진행 중";
}

function cleanMovieListTitle(value) {
  return stripHtmlKeepingKoreanAngles(value)
    .replace(/\((?:확장판|감독판|디지털|자막|영문자막|무삭제판|리마스터링|4K|2D|3D|더빙)[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function programDedupCoreTitle(value) {
  const title = cleanProgramBoardTitle(value)
    .replace(/[“”‘’"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const bracket = title.match(/[<〈]([^>〉]*(?:영화제|페스티벌|기획전|특별전|감독전|회고전|추모전|프로젝트)[^>〉]*)[>〉]/i);
  if (bracket?.[1]) return cleanProgramBoardTitle(bracket[1]);
  const programName = title.match(/([가-힣A-Za-z0-9·\s]+(?:영화제|페스티벌|기획전|특별전|감독전|회고전|추모전|프로젝트))/i);
  if (programName?.[1]) return cleanProgramBoardTitle(programName[1]);
  return title;
}

function programRecordRange(program) {
  const dates = Array.isArray(program.dates) ? program.dates.filter(Boolean).sort() : [];
  if (dates.length) return { start: dates[0], end: dates[dates.length - 1] };
  return parseProgramDateRange(program.period || "");
}

function programRangesOverlap(a, b) {
  if (!a?.start || !a?.end || !b?.start || !b?.end) return true;
  return a.start <= b.end && b.start <= a.end;
}

function sameProgramRecord(a, b) {
  if (!a?.venueId || a.venueId !== b?.venueId) return false;
  if (!programRangesOverlap(programRecordRange(a), programRecordRange(b))) return false;
  const aCore = programDedupCoreTitle(a.title);
  const bCore = programDedupCoreTitle(b.title);
  if (!aCore || !bCore) return false;
  return aCore === bCore || aCore.includes(bCore) || bCore.includes(aCore);
}

function preferredProgramRecord(a, b) {
  const score = (program) => {
    const core = programDedupCoreTitle(program.title);
    let value = 0;
    if (!program.sourceId) value += 30;
    if (program.posterUrl) value += 4;
    if (/영화제|페스티벌|기획전|특별전|감독전|회고전|추모전|프로젝트/i.test(core)) value += 8;
    if (/[<〈>〉]/.test(program.title || "")) value -= 6;
    value -= Math.min(String(program.title || "").length, 80) / 10;
    return value;
  };
  return score(a) >= score(b) ? a : b;
}

function mergeProgramRecord(a, b) {
  const preferred = preferredProgramRecord(a, b);
  const fallback = preferred === a ? b : a;
  const dates = Array.from(new Set([...(a.dates || []), ...(b.dates || [])].filter(Boolean))).sort();
  const movies = Array.from(new Set([...(a.movies || []), ...(b.movies || [])].map(cleanMovieListTitle).filter(Boolean)));
  const { summary: _summary, ...preferredWithoutSummary } = preferred;
  return {
    ...preferredWithoutSummary,
    dates: dates.length ? dates : preferred.dates,
    url: preferred.url || fallback.url || "",
    posterUrl: preferred.posterUrl || fallback.posterUrl || "",
    movies: movies.length ? movies : preferred.movies
  };
}

function stripProgramSummary(program) {
  const { summary: _summary, ...rest } = program;
  return rest;
}

function programRecordMatchesSession(program, session) {
  if (program.venueId && session.venueId !== program.venueId) return false;
  const range = programRecordRange(program);
  if (range?.start && range?.end && (session.date < range.start || session.date > range.end)) return false;
  const programText = `${program.title || ""} ${program.kind || ""} ${program.summary || ""}`;
  const sessionText = `${session.title || ""} ${session.program || ""} ${session.summary || ""} ${(session.tags || []).join(" ")}`;
  const core = programDedupCoreTitle(program.title);
  const tokens = Array.from(
    new Set(
      core
        .split(/[\s:·,.'‘’"()[\]<>〈〉-]+/)
        .filter((token) => token.length >= 2 && !/영화|기획전|특별|상영|프로그램|프로젝트|감독전|회고전|the|and/i.test(token))
    )
  );
  if (tokens.some((token) => sessionText.includes(token))) return true;
  if (/영화제|페스티벌|기획전|특별전|감독전|회고전|추모전|프로젝트/i.test(programText)) {
    return /영화제|페스티벌|기획전|특별|감독전|회고전|추모전/i.test(sessionText);
  }
  return false;
}

function enrichProgramRecords(schedule) {
  const merged = [];
  for (const program of schedule.programs || []) {
    const existingIndex = merged.findIndex((item) => sameProgramRecord(item, program));
    if (existingIndex >= 0) merged[existingIndex] = mergeProgramRecord(merged[existingIndex], program);
    else merged.push(program);
  }
  const sessions = schedule.sessions || [];
  return {
    ...schedule,
    programs: merged.map((program) => {
      const inferred = sessions
        .filter((session) => programRecordMatchesSession(program, session))
        .map((session) => cleanMovieListTitle(session.title))
        .filter(Boolean);
      const movies = Array.from(new Set([...(program.movies || []), ...inferred])).slice(0, 10);
      return stripProgramSummary(movies.length ? { ...program, movies } : program);
    })
  };
}

const broadProgramPattern = /영화제|페스티벌|기획전|특별전|감독전|회고전|추모전|프로젝트|프로그래머|초이스|순회|갈라|프라이드시네마|인디웨이브|아키시네마|굿애프터눈|시네마테크/i;
const strictProgramPattern = /영화제|페스티벌|기획전|특별전|감독전|회고전|프로젝트|순회/i;
const blockedProgramPattern = /굿즈|패키지|증정|현장\s*이벤트|포스터|티셔츠|뱃지|배지|스티커|전시|대관|예매권|할인/i;
const talkProgramPattern = /GV|관객과의\s*대화|씨네토크|인디토크|토크|강연|무대인사|라이브러리톡/i;
const singleEventPattern = /프리미어\s*상영회|싱어롱|쇼케이스|인디돌잔치/i;

function normalizeProgramImageUrl(baseUrl, value) {
  const url = decodeEntities(value || "");
  if (!url) return "";
  if (/placeholder_image/i.test(url)) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return toAbsoluteUrl(baseUrl, url);
}

function cleanProgramBoardTitle(title) {
  let cleaned = stripHtmlKeepingKoreanAngles(title)
    .replace(/^공지\s*/, "")
    .replace(/^\[([^\]]+)\]\s*/, "$1 ")
    .replace(/^(?:기획전|영화제|특별전|감독전|회고전|굿즈패키지|GV)\s*/i, "")
    .replace(/\s+20\d{2}\s*[.\-/년]\s*\d{1,2}[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  cleaned = cleaned
    .replace(/^\d{1,2}\s*월\s*\d{1,2}\s*일?\s*/i, "")
    .replace(/^\d{1,2}\s*월\s*/, "")
    .replace(/^\d{1,2}\s*[.\-/]\s*\d{1,2}(?:\s*[월화수목금토일])?\s*/i, "")
    .replace(/^\d+\s*회\s+(?=.{0,40}(?:영화제|페스티벌))/i, "")
    .replace(/\s*[|｜]\s*[^|｜]+$/g, "")
    .replace(/^(.*?(?:영화제|페스티벌))\s*['"‘’“”]([^'"‘’“”]+)['"‘’“”]\s*$/i, "$1: $2")
    .replace(/(.+[가-힣].*?)\s+(?=[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff々〆〤ヶー・0-9A-Za-z\s]*[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff々〆〤ヶー・])[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff々〆〤ヶー・0-9A-Za-z\s]+$/u, "$1")
    .replace(/\s+/g, " ")
    .replace(/\s+([:：])/g, "$1")
    .trim();
  return cleaned;
}

function programBoardKind(title, category = "") {
  const text = `${category} ${title}`;
  if (/영화제|페스티벌|갈라/i.test(text)) return "영화제";
  if (/감독전/i.test(text)) return "감독전";
  if (/회고전/i.test(text)) return "회고전";
  if (/추모전/i.test(text)) return "추모전";
  if (/특별전|특별\s*상영/i.test(text)) return "특별전";
  if (/프로그래머|초이스|상설전/i.test(text)) return "기획전";
  return "기획전";
}

function programBoardEligible(source, raw) {
  const titleText = `${raw.category || ""} ${raw.title || ""}`;
  const fullText = `${titleText} ${raw.summary || ""}`;
  if (!raw.title) return false;
  if (blockedProgramPattern.test(titleText)) return false;
  if (talkProgramPattern.test(titleText)) return false;
  if (singleEventPattern.test(titleText) && !/영화제|페스티벌/.test(titleText)) return false;
  if (source.programParser === "strict-event") return strictProgramPattern.test(fullText);
  if (source.id === "indiespace-program") {
    return /영화제|페스티벌|기획전|프라이드시네마/i.test(fullText) && !singleEventPattern.test(titleText);
  }
  if (source.id === "laika-program") {
    return strictProgramPattern.test(fullText) && !/프리미어|상영회|GV/i.test(titleText);
  }
  if (source.id === "momo-program") {
    return /영화제|페스티벌|기획전|특별전|감독전|회고전|특별상영|의 영화/i.test(fullText);
  }
  return broadProgramPattern.test(fullText);
}

function programBoardId(source, url, title) {
  try {
    const parsed = new URL(url);
    const key =
      parsed.searchParams.get("wr_id") ||
      parsed.searchParams.get("idx") ||
      parsed.searchParams.get("item") ||
      parsed.pathname.split("/").filter(Boolean).pop() ||
      shortHash(url);
    return `p-${source.venueId}-${source.id.replace(/-(?:program|event|board)$/i, "")}-${String(key).replace(/[^A-Za-z0-9_-]/g, "")}`;
  } catch {
    return `p-${source.venueId}-${source.id.replace(/-(?:program|event|board)$/i, "")}-${shortHash(`${url} ${title}`)}`;
  }
}

function buildProgramBoardRecord(source, raw) {
  const title = cleanProgramBoardTitle(raw.title);
  const summaryText = stripHtmlKeepingKoreanAngles(raw.summary || raw.text || "");
  const range = parseProgramDateRange(`${raw.dateText || ""} ${raw.title || ""} ${summaryText}`);
  if (!range) return null;
  const status = programStatusFromRange(range);
  if (status === "종료") return null;
  const candidate = { ...raw, title, summary: summaryText };
  if (!programBoardEligible(source, candidate)) return null;
  const url = raw.url || source.url;
  return {
    id: programBoardId(source, url, title),
    title,
    venueId: source.venueId,
    period: formatRangeLabel(range.start, range.end),
    dates: [range.start, range.end],
    kind: programBoardKind(title, raw.category),
    status,
    url,
    sourceId: source.id,
    posterUrl: raw.posterUrl || ""
  };
}

function extractKofaProgramBoardPrograms(source, html, pageUrl) {
  const programs = [];
  const itemPattern = /<li\b[^>]*style=["'][^"']*background-image\s*:\s*url\((['"]?)([^'")]+)\1\)[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = itemPattern.exec(html))) {
    const block = match[3];
    const programId = block.match(/data-program-id=["']([^"']+)["']/i)?.[1] || "";
    const raw = {
      category: stripHtml(block.match(/<p\b[^>]*class=["']txt-1["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || ""),
      title: stripHtmlKeepingKoreanAngles(
        (block.match(/<p\b[^>]*class=["']txt-2["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || "").replace(/<span\b[^>]*class=["'][^"']*icon-screen[^"']*["'][\s\S]*?<\/span>/gi, " ")
      ),
      dateText: stripHtml(block.match(/<p\b[^>]*class=["']txt-3["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || ""),
      summary: stripHtmlKeepingKoreanAngles(block.match(/<p\b[^>]*class=["']txt-4["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || ""),
      url: toAbsoluteUrl(pageUrl, `/cinematheque/programs/${programId}`),
      posterUrl: normalizeProgramImageUrl(pageUrl, match[2])
    };
    const program = buildProgramBoardRecord(source, raw);
    if (program) programs.push(program);
  }
  return programs;
}

function extractSacProgramBoardPrograms(source, html, pageUrl) {
  return String(html)
    .split(/<div\b[^>]*class=["'][^"']*product-item[^"']*["'][^>]*>/i)
    .slice(1)
    .map((block) => {
      const href = block.match(/<a\b[^>]*href=["']([^"']*bo_table=program[^"']+)["']/i)?.[1] || "";
      return buildProgramBoardRecord(source, {
        title: block.match(/<h4\b[^>]*>\s*<a\b[^>]*>[\s\S]*?([\s\S]*?)<\/a>\s*<\/h4>/i)?.[1] || "",
        dateText: stripHtml(block.match(/<h6\b[^>]*>([\s\S]*?)<\/h6>/i)?.[1] || ""),
        summary: stripHtmlKeepingKoreanAngles(block.match(/<p\b[^>]*class=["'][^"']*product-cont[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || ""),
        url: href ? toAbsoluteUrl(pageUrl, href) : pageUrl,
        posterUrl: normalizeProgramImageUrl(pageUrl, block.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1] || "")
      });
    })
    .filter(Boolean);
}

function extractMomoProgramBoardPrograms(source, html, pageUrl) {
  return String(html)
    .split(/<article\b[^>]*class=["'][^"']*entry-item[^"']*["'][^>]*>/i)
    .slice(1)
    .map((block) => {
      const href = block.match(/<h4\b[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["']/i)?.[1] ||
        block.match(/<a\b[^>]*href=["']([^"']*bo_table=special_program[^"']+)["']/i)?.[1] ||
        "";
      return buildProgramBoardRecord(source, {
        title: block.match(/<h4\b[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] || "",
        summary: stripHtmlKeepingKoreanAngles(block.match(/<p\b[^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>\s*<\/p>/i)?.[1] || ""),
        url: href ? toAbsoluteUrl(pageUrl, href) : pageUrl,
        posterUrl: normalizeProgramImageUrl(pageUrl, block.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1] || "")
      });
    })
    .filter(Boolean);
}

function extractIndiespaceProgramBoardPrograms(source, html, pageUrl) {
  return String(html)
    .split(/<li\b[^>]*>/i)
    .map((block) => {
      const title = block.match(/<span\b[^>]*class=["']title["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "";
      if (!title) return null;
      const href = block.match(/<a\b[^>]*href=["'](\/\d{5,})["']/i)?.[1] || "";
      return buildProgramBoardRecord(source, {
        title,
        dateText: title,
        summary: "인디스페이스 공식 기획 프로그램",
        url: href ? toAbsoluteUrl(pageUrl, href) : pageUrl,
        posterUrl: normalizeProgramImageUrl(pageUrl, block.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1] || "")
      });
    })
    .filter(Boolean);
}

function extractLaikaProgramEntries(source, html, pageUrl) {
  return String(html)
    .split(/<div\b[^>]*class=['"][^'"]*list-style-card[^'"]*['"][^>]*>/i)
    .slice(1)
    .map((block) => {
      const onclick = block.match(/onclick=["']location\.href=["']?([^"']+)["']?/i)?.[1] || "";
      const titleBlock = block.match(/<div\b[^>]*class=["'][^"']*title[^"']*title-block[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
      const category = stripHtml(titleBlock.match(/<em\b[^>]*>([\s\S]*?)<\/em>/i)?.[1] || "");
      const title = cleanProgramBoardTitle(titleBlock);
      if (!title) return null;
      return {
        title,
        category,
        url: onclick ? toAbsoluteUrl(pageUrl, onclick) : pageUrl,
        posterUrl: normalizeProgramImageUrl(pageUrl, block.match(/<img\b[^>]*(?:data-original|src)=["']([^"']+)["']/i)?.[1] || "")
      };
    })
    .filter((entry) => programBoardEligible(source, entry))
    .slice(0, 8);
}

function extractStrictEventProgramBoardPrograms(source, html, pageUrl) {
  const items = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html))) {
    const title = stripHtmlKeepingKoreanAngles(match[2]);
    if (!title || title.length < 4) continue;
    const textWindow = stripHtmlKeepingKoreanAngles(html.slice(Math.max(0, match.index - 500), Math.min(html.length, match.index + 900)));
    const raw = {
      title,
      dateText: textWindow,
      summary: textWindow,
      url: toAbsoluteUrl(pageUrl, match[1])
    };
    const program = buildProgramBoardRecord(source, raw);
    if (program) items.push(program);
  }
  return items;
}

function extractProgramBoardPrograms(source, html, pageUrl) {
  if (source.programParser === "kofa") return extractKofaProgramBoardPrograms(source, html, pageUrl);
  if (source.programParser === "sac") return extractSacProgramBoardPrograms(source, html, pageUrl);
  if (source.programParser === "momo") return extractMomoProgramBoardPrograms(source, html, pageUrl);
  if (source.programParser === "indiespace") return extractIndiespaceProgramBoardPrograms(source, html, pageUrl);
  if (source.programParser === "strict-event" || source.programParser === "arirang") {
    return extractStrictEventProgramBoardPrograms(source, html, pageUrl);
  }
  if (source.id === emuProgramBoardSource.id) return extractEmuProgramBoardPrograms(html);
  return [];
}

function trimProgramSummary(title, text) {
  const withoutDateRange = decodeEntities(text)
    .replace(title, " ")
    .replace(
      /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?\s*(?:[-~–—]|부터|to)\s*(?:(20\d{2})\s*[.\-/년]\s*)?(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/gi,
      " "
    )
    .replace(/[“"']\s*[”"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const summary = withoutDateRange || "에무시네마 공식 기획전";
  return summary.length > 120 ? `${summary.slice(0, 117)}...` : summary;
}

function emuProgramKind(title, summary) {
  const text = `${title} ${summary}`;
  if (/영화제|페스티벌|갈라/i.test(text)) return "영화제";
  if (/감독전/i.test(text)) return "감독전";
  if (/회고전/i.test(text)) return "회고전";
  if (/특별\s*상영|특별전|상영회/i.test(text)) return "특별상영";
  return "기획전";
}

function extractEmuProgramBoardPrograms(html) {
  const programs = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']*mcb_data_view\.php[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html))) {
    const body = match[2];
    const title = stripHtml(body.match(/<h4\b[^>]*class=["'][^"']*media-heading[^"']*["'][^>]*>([\s\S]*?)<\/h4>/i)?.[1] || "");
    if (!title || !/기획|특별|영화제|갈라|감독전|회고전|상영/i.test(title)) continue;

    const rawUrl = match[1];
    const url = toAbsoluteUrl(emuProgramBoardSource.url, rawUrl);
    const rawImageUrl = body.match(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/i)?.[1] || "";
    const imageUrl = rawImageUrl ? toAbsoluteUrl(emuProgramBoardSource.url, rawImageUrl) : "";
    const snippet = stripHtml(body.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || body);
    const range = parseProgramDateRange(`${title} ${snippet}`);
    if (!range) continue;

    const status = programStatusFromRange(range);
    if (status === "종료") continue;

    let itemId = "";
    try {
      itemId = new URL(url).searchParams.get("item") || "";
    } catch {
      itemId = "";
    }
    itemId ||= shortHash(url);
    const summary = trimProgramSummary(title, snippet);
    programs.push({
      id: `p-emu-${itemId}`,
      title,
      venueId: "emu",
      period: formatRangeLabel(range.start, range.end),
      dates: [range.start, range.end],
      kind: emuProgramKind(title, summary),
      status,
      url,
      sourceId: emuProgramBoardSource.id,
      posterUrl: imageUrl
    });
  }

  return uniqBy(programs, (program) => program.id).slice(0, 8);
}

async function fetchEmuProgramBoardPrograms() {
  const { response, text } = await fetchText(emuProgramBoardSource.url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return extractEmuProgramBoardPrograms(text);
}

async function fetchLaikaProgramBoardPrograms(source, html, pageUrl) {
  const entries = extractLaikaProgramEntries(source, html, pageUrl);
  const programs = [];
  for (const entry of entries) {
    try {
      const { response, text } = await fetchText(entry.url, { retries: 0, timeoutMs: 8000 });
      if (!response.ok) continue;
      const detailText = stripHtmlKeepingKoreanAngles(text);
      const program = buildProgramBoardRecord(source, {
        ...entry,
        dateText: detailText,
        summary: `${source.name} 공식 프로그램`
      });
      if (program) programs.push(program);
    } catch {
      const program = buildProgramBoardRecord(source, entry);
      if (program) programs.push(program);
    }
  }
  return programs;
}

async function fetchProgramBoardSourcePrograms(source) {
  if (source.id === emuProgramBoardSource.id) return fetchEmuProgramBoardPrograms();

  const urls = source.urls?.length ? source.urls : [source.url];
  const programs = [];
  for (const url of urls) {
    const { response, text } = await fetchText(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    if (source.programParser === "laika") {
      programs.push(...(await fetchLaikaProgramBoardPrograms(source, text, url)));
    } else {
      programs.push(...extractProgramBoardPrograms(source, text, url));
    }
  }
  return uniqBy(programs, (program) => program.id).slice(0, 12);
}

async function refreshProgramBoardRecords(schedule) {
  let next = schedule;
  for (const source of programBoardSources) {
    if (source.skipProgramRefresh) {
      console.warn(`[program-board] ${source.name} 갱신 생략: ${source.skipReason || "자동 갱신 제외"}`);
      continue;
    }
    try {
      const programs = await fetchProgramBoardSourcePrograms(source);
      if (!programs.length) {
        console.warn(`[program-board] ${source.name}에서 활성 프로그램을 찾지 못해 기존 데이터를 보존합니다.`);
        continue;
      }
      const preserved = (next.programs || []).filter((program) => program.sourceId !== source.id);
      next = { ...next, programs: [...preserved, ...programs] };
    } catch (error) {
      console.warn(`[program-board] ${source.name} 갱신 실패: ${error.message}`);
    }
  }
  return next;
}

function posterUrl(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("/")) return `https://www.cinecube.co.kr${url}`;
  return url;
}

function statusFromSeats(availableSeats) {
  return Number(availableSeats) === 0 ? "soldout" : "confirmed";
}

function cinecubeBookingUrl(movieCd, selectedDate, screenId, showSeq) {
  const params = new URLSearchParams({
    date: selectedDate || "",
    movieCd: movieCd || "",
    playSDT: selectedDate || "",
    screenId: screenId || "",
    showSeq: showSeq || ""
  });
  return `https://www.cinecube.co.kr/cinema/time-order-table?${params.toString()}`;
}

function momoBookingUrl(movieCd, playSDT, screenCd, showSeq) {
  const params = new URLSearchParams({
    MovieCd: movieCd || "",
    PlaySDT: playSDT || "",
    ScreenCd: screenCd || "",
    ShowSeq: showSeq || ""
  });
  return `https://arthousemomo.co.kr/pages/ti.php?${params.toString()}`;
}

function dtryxReserveUrl({ cgid, brandCd, cinemaCd, movieCd, playSDT, screenCd, showSeq, reserveBaseUrl }) {
  const params = new URLSearchParams({
    cgid: cgid || "",
    ...(brandCd ? { BrandCd: brandCd } : {}),
    CinemaCd: cinemaCd || "",
    MovieCd: movieCd || "",
    PlaySDT: normalizeDate(playSDT)
  });
  if (screenCd) params.set("ScreenCd", screenCd);
  if (showSeq) params.set("ShowSeq", showSeq);
  const baseUrl = String(reserveBaseUrl || "https://www.dtryx.com").replace(/\/$/, "");
  return `${baseUrl}/reserve/movie.do?${params.toString()}`;
}

function normalizeCompactTime(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "시간 확인";
  const raw = digits.padStart(4, "0");
  return `${raw.slice(-4, -2)}:${raw.slice(-2)}`;
}

function minutesFromTime(value) {
  const time = normalizeCompactTime(value);
  if (time === "시간 확인") return null;
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function runtimeFromCompactTimes(start, end) {
  const startMinutes = minutesFromTime(start);
  const endMinutes = minutesFromTime(end);
  if (startMinutes === null || endMinutes === null) return "";
  const diff = endMinutes >= startMinutes ? endMinutes - startMinutes : endMinutes + 24 * 60 - startMinutes;
  return diff > 0 ? `${diff}분` : "";
}

function isFutureKstDateTime(value) {
  if (!value) return true;
  const date = new Date(`${String(value).trim().replace(" ", "T")}+09:00`);
  if (Number.isNaN(date.getTime())) return true;
  return date.getTime() > Date.now();
}

function movieeGradeLabel(grade) {
  const value = String(grade ?? "").trim();
  if (value === "00" || value.toUpperCase() === "ALL") return "전체관람가";
  if (value === "12") return "12세이상관람가";
  if (value === "15") return "15세이상관람가";
  if (value === "18" || value === "19") return "청소년관람불가";
  return value;
}

function movieeTicketUrl({ theaterId, movieId, playDate, screenId, playNo }) {
  const params = new URLSearchParams({ tid: theaterId || "" });
  if (movieId) params.set("mId", movieId);
  if (playDate) params.set("playDt", compactDate(playDate));
  if (screenId) params.set("tsId", screenId);
  if (playNo !== undefined && playNo !== null && playNo !== "") params.set("pno", String(playNo));
  return `https://moviee.co.kr/Movie/Ticket?${params.toString()}`;
}

function movieePosterUrl(file) {
  return file ? `https://moviee.co.kr/DisplayImage?key=${encodeURIComponent(file)}` : "";
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
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
    return hasParams(url, ["date"]) || hasParams(url, ["movieCd", "playSDT", "screenId", "showSeq"]);
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

function classifyActionUrl(url) {
  if (!url) return "official";
  if (bookingUrlPatterns.some((pattern) => pattern.test(url)) && isConcreteBookingUrl(url)) return "booking";
  if (bookingGuidePatterns.some((pattern) => pattern.test(url))) return "guide";
  if (detailOnlyPatterns.some((pattern) => pattern.test(url))) return "detail";
  return "official";
}

function defaultActionLabel(type) {
  if (type === "booking") return "예매";
  if (type === "guide") return "예매 안내";
  if (type === "detail") return "상세";
  if (type === "official") return "공식 확인";
  return "확인";
}

function normalizeSessionLinks(session) {
  const next = { ...session };
  const declaredType = next.bookingType || "";
  const classifiedType = classifyActionUrl(next.bookingUrl || next.detailUrl);
  let type = declaredType || classifiedType;

  if (declaredType === "booking" && classifiedType !== "booking") {
    type = classifiedType;
  }

  const shouldResetLabel = declaredType !== type || (type !== "booking" && next.actionLabel === "예매");

  if (type === "booking") {
    next.bookingType = "booking";
    if (shouldResetLabel || !next.actionLabel) next.actionLabel = defaultActionLabel(type);
    return next;
  }

  if (type === "guide") {
    next.bookingType = "guide";
    if (shouldResetLabel || !next.actionLabel) next.actionLabel = defaultActionLabel(type);
    return next;
  }

  if (type === "detail") {
    if (next.bookingUrl && !next.detailUrl) next.detailUrl = next.bookingUrl;
    next.bookingUrl = next.detailUrl || next.bookingUrl;
    next.bookingType = "detail";
    if (shouldResetLabel || !next.actionLabel) next.actionLabel = defaultActionLabel(type);
    return next;
  }

  next.bookingType = type;
  if (shouldResetLabel || !next.actionLabel) next.actionLabel = defaultActionLabel(type);
  return next;
}

function normalizeScheduleLinks(schedule) {
  return {
    ...schedule,
    sessions: (schedule.sessions || []).map(normalizeSessionLinks),
    festivals: (schedule.festivals || []).map(normalizeSessionLinks)
  };
}

function refreshCuratedRecords(schedule) {
  const liveFestivalSessions = (schedule.sessions || []).filter(isFestivalSession);

  const programs = (schedule.programs || []).map((program) => {
    if (program.id === "p-indie-pride") {
      return stripProgramSummary({
        ...program,
        status: "진행 중",
        url: "https://indiespace.kr/491478"
      });
    }
    return stripProgramSummary(program);
  });

  const festivals = (schedule.festivals || []).filter((festival) => {
    const placeholder = /확인 필요|시간표 확인|needs-check|시간 확인/i.test(
      `${festival.status || ""} ${festival.title || ""} ${festival.time || ""}`
    );
    if (!placeholder) return true;
    return !liveFestivalSessions.some((session) => {
      if (session.venueId !== festival.venueId) return false;
      const liveText = `${session.program || ""} ${session.title || ""}`;
      const festivalText = `${festival.name || ""} ${festival.section || ""} ${festival.title || ""}`;
      return (
        Boolean(festival.name && liveText.includes(festival.name)) ||
        Boolean(session.program && festivalText.includes(session.program))
      );
    });
  });

  return { ...schedule, programs, festivals };
}

function formatRangeLabel(start, end) {
  if (!start || !end) return "";
  const startText = start.replace(/-/g, ".");
  const [, endMonth = "", endDay = ""] = end.split("-");
  const endText = `${endMonth}.${endDay}`;
  return `${startText} - ${endText}`;
}

function refreshMeta(schedule, checkedAt, options = {}) {
  const dates = [...new Set((schedule.sessions || []).map((session) => session.date).filter(Boolean))].sort();
  const rangeStart = dates[0] || schedule.meta?.rangeStart || todayKst();
  const rangeEnd = dates[dates.length - 1] || schedule.meta?.rangeEnd || rangeStart;
  const verificationMeta = options.seatStatusOnly
    ? { seatStatusVerifiedAt: checkedAt }
    : options.verificationIncomplete
      ? { lastRefreshAttemptAt: checkedAt }
      : {
          generatedAt: checkedAt,
          lastVerifiedAt: checkedAt,
          seatStatusVerifiedAt: checkedAt,
          lastRefreshAttemptAt: checkedAt
        };
  return {
    ...schedule,
    meta: {
      ...(schedule.meta || {}),
      rangeStart,
      rangeEnd,
      rangeLabel: formatRangeLabel(rangeStart, rangeEnd),
      ...verificationMeta
    }
  };
}

async function fetchCinecubeSessions() {
  const pageUrl = "https://www.cinecube.co.kr/cinema/time-order-table";
  const { response, text } = await fetchText(pageUrl);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] || "";
  const csrf = text.match(/<meta name="_csrf" content="([^"]+)"/)?.[1] || "";
  const csrfHeader = text.match(/<meta name="_csrf_header" content="([^"]+)"/)?.[1] || "X-XSRF-TOKEN";
  const dates = uniqBy(
    [...text.matchAll(/data-date=["'](\d{4}-\d{2}-\d{2})["']/g)].map((match) => match[1]),
    (date) => date
  )
    .filter((date) => date >= todayKst())
    .slice(0, 14);

  const sessions = [];
  for (const date of dates) {
    const body = new URLSearchParams({ selectedDate: date });
    const data = await fetchJson("https://www.cinecube.co.kr/cinema/api/time-order-table", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        [csrfHeader]: csrf,
        cookie
      },
      body
    });

    for (const item of data.schedules || []) {
      const time = normalizeTime(item.startTime);
      sessions.push({
        id: `live-cinecube-${date}-${item.movieCd}-${item.screenId}-${item.showSeq}`,
        date,
        time,
        timeSort: time,
        title: item.movieTitle,
        venueId: "cinecube",
        screen: item.screenName || "씨네큐브 광화문",
        program: "날짜별 시간표",
        kind: "program",
        status: statusFromSeats(item.availableSeats),
        tags: [`${item.runningTime || ""}분`.trim(), `${item.viewingAge || "ALL"}세`].filter(Boolean),
        summary: `${item.screenName || "상영관"} · 잔여 ${item.availableSeats ?? "?"}/${item.totalSeats ?? "?"}석`,
        bookingUrl: cinecubeBookingUrl(item.movieCd, date, item.screenId, item.showSeq),
        bookingType: "booking",
        actionLabel: "예매",
        sourceId: "cinecube-time-order",
        posterUrl: posterUrl(item.posterUrl || item.dtryxPosterUrl)
      });
    }
  }

  return {
    sourceId: "cinecube-time-order",
    url: pageUrl,
    sessions,
    upstreamDateCount: dates.length,
    upstreamActiveDateCount: new Set(sessions.map((session) => session.date).filter(Boolean)).size
  };
}

function dtryxVisibleDateRows(payload) {
  // RestYn marks rest/holiday calendar dates, not the absence of screenings.
  // For example, visible Sundays can contain a full published timetable.
  // Only HiddenYn hides a date; let the timetable endpoint decide its sessions.
  return (payload.Recordset || []).filter((row) => row.HiddenYn !== "Y").slice(0, 14);
}

async function fetchMomoSessions() {
  const dateUrl = "https://api.dtryx.com:30443/dtryx/cms/thirdparty/movie/third-party-type2-timetable-play-date-list?BrandCd=indieart&CinemaCd=000067&MovieCd=&ChannelCd=homepage&WorkGuID=324A2914-AB19-42A3-BDFE-58A08B2DC35D&EngVerYn=N";
  const listBase = "https://api.dtryx.com:30443/dtryx/cms/thirdparty/movie/third-party-type2-timetable-list";
  const dates = await fetchJson(dateUrl);
  const sessions = [];

  for (const dateRow of dtryxVisibleDateRows(dates)) {
    const date = normalizeDate(dateRow.PlaySDT);
    const params = new URLSearchParams({
      BrandCd: "indieart",
      CinemaCd: "000067",
      PlaySDT: date,
      ImgSize: "small",
      ChannelCd: "homepage",
      WorkGuID: "37E0BA0F-DA5F-4376-9BA4-B5D27286AB87",
      EngVerYn: "N"
    });
    const data = await fetchJson(`${listBase}?${params.toString()}`);

    for (const item of data.Recordset || []) {
      const time = normalizeTime(item.StartTime);
      sessions.push({
        id: `live-momo-${compactDate(date)}-${item.MovieCd}-${item.ScreenCd}-${item.ShowSeq}`,
        date,
        time,
        timeSort: time,
        title: item.MovieNm,
        venueId: "momo",
        screen: item.ScreenNm || "아트하우스 모모",
        program: "상영시간표",
        kind: "program",
        status: statusFromSeats(item.SeatRemainCnt ?? item.RemainSeatCnt),
        tags: [item.RatingNm, item.RunningTime ? `${item.RunningTime}분` : ""].filter(Boolean),
        summary: `${item.ScreenNm || "상영관"} · ${item.RatingNm || "등급 정보"} · ${item.RunningTime || "?"}분`,
        bookingUrl: momoBookingUrl(item.MovieCd, item.PlaySDT || date, item.ScreenCd, item.ShowSeq),
        bookingType: "booking",
        actionLabel: "예매",
        sourceId: "momo-dtryx-showtimes",
        posterUrl: item.PosterUrl || item.ImgUrl || ""
      });
    }
  }

  return { sourceId: "momo-dtryx-showtimes", url: dateUrl, sessions };
}

async function fetchEmuSessions() {
  const config = {
    sourceId: "emu-dtryx-showtimes",
    venueId: "emu",
    cinemaCd: "000069",
    brandCd: "indieart",
    workGuid: "37E0BA0F-DA5F-4376-9BA4-B5D27286AB87",
    cgid: "FE8EF4D2-F22D-4802-A39A-D58F23A29C1E",
    pageUrl: "http://www.emuartspace.com/main/emuartspace/"
  };
  const dateUrl = `https://api.dtryx.com:30443/dtryx/cms/thirdparty/movie/third-party-type2-timetable-play-date-list?BrandCd=${config.brandCd}&CinemaCd=${config.cinemaCd}&MovieCd=&ChannelCd=homepage&WorkGuID=${config.workGuid}&EngVerYn=N`;
  const listBase = "https://api.dtryx.com:30443/dtryx/cms/thirdparty/movie/third-party-type2-timetable-list";
  const dates = await fetchJson(dateUrl);
  const sessions = [];

  for (const dateRow of dtryxVisibleDateRows(dates)) {
    const date = normalizeDate(dateRow.PlaySDT);
    const params = new URLSearchParams({
      BrandCd: config.brandCd,
      CinemaCd: config.cinemaCd,
      PlaySDT: date,
      ImgSize: "small",
      ChannelCd: "homepage",
      WorkGuID: config.workGuid,
      EngVerYn: "N"
    });
    const data = await fetchJson(`${listBase}?${params.toString()}`);

    for (const item of data.Recordset || []) {
      const time = normalizeTime(item.StartTime);
      sessions.push({
        id: `live-emu-${compactDate(date)}-${item.MovieCd}-${item.ScreenCd}-${item.ShowSeq}`,
        date,
        time,
        timeSort: time,
        title: item.MovieNm,
        venueId: config.venueId,
        screen: item.ScreenNm || "에무시네마",
        program: item.ScreeningInfo || item.PlayTimeTypeNm || "상영시간표",
        kind: /GV|관객과의 대화|톡|토크|시네토크|강연/.test(`${item.ScreeningInfo || ""} ${item.PlayTimeTypeNm || ""}`) ? "talk" : "program",
        status: statusFromSeats(item.SeatRemainCnt ?? item.RemainSeatCnt),
        tags: [item.RatingNm, item.RunningTime ? `${item.RunningTime}분` : "", item.ScreeningInfo].filter(Boolean),
        summary: `${item.ScreenNm || "상영관"} · 잔여 ${item.RemainSeatCnt ?? item.SeatRemainCnt ?? "?"}/${item.TotalSeatCnt ?? "?"}석`,
        bookingUrl: dtryxReserveUrl({
          cgid: config.cgid,
          brandCd: config.brandCd,
          cinemaCd: config.cinemaCd,
          movieCd: item.MovieCd,
          playSDT: item.PlaySDT || date,
          screenCd: item.ScreenCd,
          showSeq: item.ShowSeq,
          reserveBaseUrl: config.reserveBaseUrl
        }),
        bookingType: "booking",
        actionLabel: "예매",
        sourceId: config.sourceId,
        posterUrl: item.PosterUrl || item.ImgUrl || item.Url || ""
      });
    }
  }

  return { sourceId: config.sourceId, url: config.pageUrl, sessions };
}

function dtryxSessionStatus(item) {
  if (String(item.NextSkipYn || "").toUpperCase() === "N") return "needs-check";
  return statusFromSeats(item.SeatRemainCnt ?? item.RemainSeatCnt);
}

function dtryxShowseqDatesFromHtml(html) {
  return uniqBy(
    [...String(html || "").matchAll(/<a\b[^>]*\bclass=["'][^"']*\bbtnDay\b[^"']*["'][^>]*\bdata-dt=["'](\d{4}-\d{2}-\d{2})["'][^>]*>/gi)]
      .map((match) => match[1])
      .filter((date) => date >= todayKst()),
    (date) => date
  );
}

async function dtryxFallbackDates(config) {
  if (!config.pageUrl || config.skipDatePageProbe) return upcomingKstDates(14);

  try {
    const { response, text } = await fetchText(config.pageUrl);
    if (!response.ok) return upcomingKstDates(14);
    const dates = dtryxShowseqDatesFromHtml(text);
    return dates.length ? dates.slice(0, 14) : upcomingKstDates(14);
  } catch {
    return upcomingKstDates(14);
  }
}

function dtryxShowseqUrl(config, date) {
  const params = new URLSearchParams({
    BrandCd: config.brandCd,
    CinemaCd: config.cinemaCd,
    PlaySDT: date
  });
  if (config.publicCgid ?? config.cgid) params.set("cgid", config.publicCgid ?? config.cgid);
  return `https://www.dtryx.com/cinema/showseq_list.do?${params.toString()}`;
}

function dtryxShowseqSession(config, item, date) {
  const time = normalizeTime(item.StartTime);
  const canReserve = String(item.NextSkipYn || "").toUpperCase() !== "N";
  const programText = `${item.ScreeningInfo || ""} ${item.PlayTimeTypeNm || ""} ${item.MovieNm || ""}`;
  const screen = item.ScreenNm || item.ScreenNmNat || config.screenFallback || "상영관";
  return {
    id: `live-${config.venueId}-${compactDate(date)}-${item.MovieCd}-${item.ScreenCd}-${item.ShowSeq}`,
    date,
    time,
    timeSort: time,
    title: item.MovieNm || item.MovieNmNat,
    venueId: config.venueId,
    screen,
    program: item.PlayTimeTypeNm || item.ScreeningInfo || "상영시간표",
    kind: /영화제|GV|관객과의 대화|톡|토크|시네토크|강연/.test(programText)
      ? programText.includes("영화제")
        ? "festival"
        : "talk"
      : "program",
    status: dtryxSessionStatus(item),
    tags: [item.RatingNm, item.RunningTime ? `${item.RunningTime}분` : "", item.ScreeningInfo, item.PlayTimeTypeNm].filter(Boolean),
    summary: canReserve
      ? `${screen} · 잔여 ${item.RemainSeatCnt ?? item.SeatRemainCnt ?? "?"}/${item.TotalSeatCnt ?? "?"}석`
      : decodeEntities(item.NextSkipYnMsg || `${screen} · 공식 확인 필요`),
    bookingUrl: config.bookingUrl === "momo"
      ? momoBookingUrl(item.MovieCd, item.PlaySDT || date, item.ScreenCd, item.ShowSeq)
      : dtryxReserveUrl({
          cgid: config.cgid || config.publicCgid || "",
          brandCd: config.brandCd,
          cinemaCd: config.cinemaCd,
          movieCd: item.MovieCd,
          playSDT: item.PlaySDT || date,
          screenCd: item.ScreenCd,
          showSeq: item.ShowSeq,
          reserveBaseUrl: config.reserveBaseUrl
        }),
    bookingType: canReserve ? "booking" : "official",
    actionLabel: canReserve ? "예매" : "공식 확인",
    sourceId: config.sourceId,
    posterUrl: item.PosterUrl || item.ImgUrl || item.Url || ""
  };
}

async function fetchDtryxPublicShowseqSessions(config) {
  const dates = await dtryxFallbackDates(config);
  const sessions = [];

  for (const date of dates) {
    const url = dtryxShowseqUrl(config, date);
    const data = await fetchJson(url, {
      headers: config.pageUrl ? { referer: config.pageUrl } : {}
    });
    for (const item of data.Showseqlist || []) {
      sessions.push(dtryxShowseqSession(config, item, normalizeDate(item.PlaySDT || date)));
    }
  }

  return {
    sourceId: config.sourceId,
    url: config.pageUrl || "https://www.dtryx.com/cinema/showseq_list.do",
    sessions: uniqBy(sessions, (session) => session.id)
  };
}

async function fetchDtryxType2Sessions(config) {
  const dateUrl = `https://api.dtryx.com:30443/dtryx/cms/thirdparty/movie/third-party-type2-timetable-play-date-list?BrandCd=${config.brandCd}&CinemaCd=${config.cinemaCd}&MovieCd=&ChannelCd=homepage&WorkGuID=${config.workGuid}&EngVerYn=N`;
  const listBase = "https://api.dtryx.com:30443/dtryx/cms/thirdparty/movie/third-party-type2-timetable-list";
  const dates = await fetchJson(dateUrl);
  const sessions = [];

  for (const dateRow of dtryxVisibleDateRows(dates)) {
    const date = normalizeDate(dateRow.PlaySDT);
    const params = new URLSearchParams({
      BrandCd: config.brandCd,
      CinemaCd: config.cinemaCd,
      PlaySDT: date,
      ImgSize: "small",
      ChannelCd: "homepage",
      WorkGuID: config.workGuid,
      EngVerYn: "N"
    });
    const data = await fetchJson(`${listBase}?${params.toString()}`);

    for (const item of data.Recordset || []) {
      const time = normalizeTime(item.StartTime);
      const canReserve = String(item.NextSkipYn || "").toUpperCase() !== "N";
      const programText = `${item.ScreeningInfo || ""} ${item.PlayTimeTypeNm || ""} ${item.MovieNm || ""}`;
      sessions.push({
        id: `live-${config.venueId}-${compactDate(date)}-${item.MovieCd}-${item.ScreenCd}-${item.ShowSeq}`,
        date,
        time,
        timeSort: time,
        title: item.MovieNm,
        venueId: config.venueId,
        screen: item.ScreenNm || config.screenFallback || "상영관",
        program: item.PlayTimeTypeNm || item.ScreeningInfo || "상영시간표",
        kind: /영화제|GV|관객과의 대화|톡|토크|시네토크|강연/.test(programText)
          ? programText.includes("영화제")
            ? "festival"
            : "talk"
          : "program",
        status: dtryxSessionStatus(item),
        tags: [item.RatingNm, item.RunningTime ? `${item.RunningTime}분` : "", item.ScreeningInfo, item.PlayTimeTypeNm].filter(Boolean),
        summary: canReserve
          ? `${item.ScreenNm || "상영관"} · 잔여 ${item.RemainSeatCnt ?? item.SeatRemainCnt ?? "?"}/${item.TotalSeatCnt ?? "?"}석`
          : decodeEntities(item.NextSkipYnMsg || `${item.ScreenNm || "상영관"} · 공식 확인 필요`),
        bookingUrl: dtryxReserveUrl({
          cgid: config.cgid,
          brandCd: config.brandCd,
          cinemaCd: config.cinemaCd,
          movieCd: item.MovieCd,
          playSDT: item.PlaySDT || date,
          screenCd: item.ScreenCd,
          showSeq: item.ShowSeq,
          reserveBaseUrl: config.reserveBaseUrl
        }),
        bookingType: canReserve ? "booking" : "official",
        actionLabel: canReserve ? "예매" : "공식 확인",
        sourceId: config.sourceId,
        posterUrl: item.PosterUrl || item.ImgUrl || item.Url || ""
      });
    }
  }

  return { sourceId: config.sourceId, url: config.pageUrl || dateUrl, sessions };
}

async function fetchArirangSessions() {
  const config = {
    sourceId: "arirang-dtryx-showtimes",
    venueId: "arirang",
    cinemaCd: "000088",
    brandCd: "etc",
    workGuid: "ADF5F3D5-BF7B-4449-9AA2-16858E197DDA",
    cgid: "FE8EF4D2-F22D-4802-A39A-D58F23A29C1E",
    pageUrl: "https://cine.arirang.go.kr:8443/arirang/index.do"
  };
  const dateUrl = `https://api.dtryx.com:30443/dtryx/cms/thirdparty/movie/third-party-type2-timetable-play-date-list?BrandCd=${config.brandCd}&CinemaCd=${config.cinemaCd}&MovieCd=&ChannelCd=homepage&WorkGuID=${config.workGuid}&EngVerYn=N`;
  const listBase = "https://api.dtryx.com:30443/dtryx/cms/thirdparty/movie/third-party-type2-timetable-list";
  const dates = await fetchJson(dateUrl);
  const sessions = [];

  for (const dateRow of dtryxVisibleDateRows(dates)) {
    const date = normalizeDate(dateRow.PlaySDT);
    const params = new URLSearchParams({
      BrandCd: config.brandCd,
      CinemaCd: config.cinemaCd,
      PlaySDT: date,
      ImgSize: "small",
      ChannelCd: "homepage",
      WorkGuID: config.workGuid,
      EngVerYn: "N"
    });
    const data = await fetchJson(`${listBase}?${params.toString()}`);

    for (const item of data.Recordset || []) {
      const time = normalizeTime(item.StartTime);
      const canReserve = String(item.NextSkipYn || "").toUpperCase() !== "N";
      sessions.push({
        id: `live-arirang-${compactDate(date)}-${item.MovieCd}-${item.ScreenCd}-${item.ShowSeq}`,
        date,
        time,
        timeSort: time,
        title: item.MovieNm,
        venueId: config.venueId,
        screen: item.ScreenNm || "아리랑시네센터",
        program: item.PlayTimeTypeNm || item.ScreeningInfo || "상영시간표",
        kind: /GV|톡|토크|시네토크|강연/.test(`${item.PlayTimeTypeNm || ""} ${item.ScreeningInfo || ""}`) ? "talk" : "program",
        status: dtryxSessionStatus(item),
        tags: [item.RatingNm, item.RunningTime ? `${item.RunningTime}분` : "", item.ScreeningInfo, item.PlayTimeTypeNm].filter(Boolean),
        summary: canReserve
          ? `${item.ScreenNm || "상영관"} · 잔여 ${item.RemainSeatCnt ?? item.SeatRemainCnt ?? "?"}/${item.TotalSeatCnt ?? "?"}석`
          : decodeEntities(item.NextSkipYnMsg || `${item.ScreenNm || "상영관"} · 공식 확인 필요`),
        bookingUrl: dtryxReserveUrl({
          cgid: config.cgid,
          brandCd: config.brandCd,
          cinemaCd: config.cinemaCd,
          movieCd: item.MovieCd,
          playSDT: item.PlaySDT || date,
          screenCd: item.ScreenCd,
          showSeq: item.ShowSeq,
          reserveBaseUrl: config.reserveBaseUrl
        }),
        bookingType: canReserve ? "booking" : "official",
        actionLabel: canReserve ? "예매" : "공식 확인",
        sourceId: config.sourceId,
        posterUrl: item.PosterUrl || item.ImgUrl || item.Url || ""
      });
    }
  }

  return { sourceId: config.sourceId, url: dateUrl, sessions };
}

async function fetchArtnineSessions() {
  const config = {
    sourceId: "artnine-dtryx-showtimes",
    venueId: "artnine",
    cinemaCd: "000162",
    brandCd: "etc",
    workGuid: "ADF5F3D5-BF7B-4449-9AA2-16858E197DDA",
    cgid: "FE8EF4D2-F22D-4802-A39A-D58F23A29C1E",
    pageUrl: "https://litt.ly/artnine"
  };
  const dateUrl = `https://api.dtryx.com:30443/dtryx/cms/thirdparty/movie/third-party-type2-timetable-play-date-list?BrandCd=${config.brandCd}&CinemaCd=${config.cinemaCd}&MovieCd=&ChannelCd=homepage&WorkGuID=${config.workGuid}&EngVerYn=N`;
  const listBase = "https://api.dtryx.com:30443/dtryx/cms/thirdparty/movie/third-party-type2-timetable-list";
  const dates = await fetchJson(dateUrl);
  const sessions = [];

  for (const dateRow of dtryxVisibleDateRows(dates)) {
    const date = normalizeDate(dateRow.PlaySDT);
    const params = new URLSearchParams({
      BrandCd: config.brandCd,
      CinemaCd: config.cinemaCd,
      PlaySDT: date,
      ImgSize: "small",
      ChannelCd: "homepage",
      WorkGuID: config.workGuid,
      EngVerYn: "N"
    });
    const data = await fetchJson(`${listBase}?${params.toString()}`);

    for (const item of data.Recordset || []) {
      const time = normalizeTime(item.StartTime);
      const canReserve = String(item.NextSkipYn || "").toUpperCase() !== "N";
      const programText = `${item.ScreeningInfo || ""} ${item.PlayTimeTypeNm || ""} ${item.MovieNm || ""}`;
      sessions.push({
        id: `live-artnine-${compactDate(date)}-${item.MovieCd}-${item.ScreenCd}-${item.ShowSeq}`,
        date,
        time,
        timeSort: time,
        title: item.MovieNm,
        venueId: config.venueId,
        screen: item.ScreenNm || "아트나인",
        program: item.PlayTimeTypeNm || item.ScreeningInfo || "상영시간표",
        kind: /GV|관객과의 대화|톡|토크|시네토크|강연/.test(programText) ? "talk" : "program",
        status: dtryxSessionStatus(item),
        tags: [item.RatingNm, item.RunningTime ? `${item.RunningTime}분` : "", item.ScreeningInfo, item.PlayTimeTypeNm].filter(Boolean),
        summary: canReserve
          ? `${item.ScreenNm || "상영관"} · 잔여 ${item.RemainSeatCnt ?? item.SeatRemainCnt ?? "?"}/${item.TotalSeatCnt ?? "?"}석`
          : decodeEntities(item.NextSkipYnMsg || `${item.ScreenNm || "상영관"} · 공식 확인 필요`),
        bookingUrl: dtryxReserveUrl({
          cgid: config.cgid,
          brandCd: config.brandCd,
          cinemaCd: config.cinemaCd,
          movieCd: item.MovieCd,
          playSDT: item.PlaySDT || date,
          screenCd: item.ScreenCd,
          showSeq: item.ShowSeq,
          reserveBaseUrl: config.reserveBaseUrl
        }),
        bookingType: canReserve ? "booking" : "official",
        actionLabel: canReserve ? "예매" : "공식 확인",
        sourceId: config.sourceId,
        posterUrl: item.PosterUrl || item.ImgUrl || item.Url || ""
      });
    }
  }

  return { sourceId: config.sourceId, url: config.pageUrl, sessions };
}

async function fetchLaikaSessions() {
  return fetchDtryxType2Sessions({
    sourceId: "laika-dtryx-showtimes",
    venueId: "laika",
    cinemaCd: "000072",
    brandCd: "spacedog",
    workGuid: "FE8EF4D2-F22D-4802-A39A-D58F23A29C1E",
    cgid: "FE8EF4D2-F22D-4802-A39A-D58F23A29C1E",
    pageUrl: "https://www.dtryx.com/cinema/main.do?cgid=FE8EF4D2-F22D-4802-A39A-D58F23A29C1E&BrandCd=spacedog&CinemaCd=000072",
    screenFallback: "라이카시네마"
  });
}

async function fetchHeyriSessions() {
  return fetchDtryxType2Sessions({
    sourceId: "heyri-dtryx-showtimes",
    venueId: "heyri",
    cinemaCd: "000071",
    brandCd: "indieart",
    workGuid: "FE8EF4D2-F22D-4802-A39A-D58F23A29C1E",
    cgid: "FE8EF4D2-F22D-4802-A39A-D58F23A29C1E",
    pageUrl: "https://scinema.org/cinema/main.do?cgid=FE8EF4D2-F22D-4802-A39A-D58F23A29C1E&BrandCd=indieart&CinemaCd=000071",
    reserveBaseUrl: "https://scinema.org",
    screenFallback: "헤이리시네마"
  });
}

async function fetchForestSessions() {
  const config = {
    sourceId: "forest-schedule",
    venueId: "forest",
    cinemaCd: "000065",
    brandCd: "indieart",
    workGuid: "81630DDE-489C-4034-A6FB-9AD54E055E5B",
    cgid: "81630DDE-489C-4034-A6FB-9AD54E055E5B",
    pageUrl: "https://www.dtryx.com/cinema/main.do?cgid=81630DDE-489C-4034-A6FB-9AD54E055E5B&BrandCd=indieart&CinemaCd=000065"
  };
  const dateUrl = `https://api.dtryx.com:30443/dtryx/cms/thirdparty/movie/third-party-type2-timetable-play-date-list?BrandCd=${config.brandCd}&CinemaCd=${config.cinemaCd}&MovieCd=&ChannelCd=homepage&WorkGuID=${config.workGuid}&EngVerYn=N`;
  const listBase = "https://api.dtryx.com:30443/dtryx/cms/thirdparty/movie/third-party-type2-timetable-list";
  const dates = await fetchJson(dateUrl);
  const sessions = [];

  for (const dateRow of dtryxVisibleDateRows(dates)) {
    const date = normalizeDate(dateRow.PlaySDT);
    const params = new URLSearchParams({
      BrandCd: config.brandCd,
      CinemaCd: config.cinemaCd,
      PlaySDT: date,
      ImgSize: "small",
      ChannelCd: "homepage",
      WorkGuID: config.workGuid,
      EngVerYn: "N"
    });
    const data = await fetchJson(`${listBase}?${params.toString()}`);

    for (const item of data.Recordset || []) {
      const time = normalizeTime(item.StartTime);
      const canReserve = String(item.NextSkipYn || "").toUpperCase() !== "N";
      const programText = `${item.ScreeningInfo || ""} ${item.PlayTimeTypeNm || ""} ${item.MovieNm || ""}`;
      sessions.push({
        id: `live-forest-${compactDate(date)}-${item.MovieCd}-${item.ScreenCd}-${item.ShowSeq}`,
        date,
        time,
        timeSort: time,
        title: item.MovieNm,
        venueId: config.venueId,
        screen: item.ScreenNm || "더숲아트시네마",
        program: item.ScreeningInfo || item.PlayTimeTypeNm || "상영시간표",
        kind: /영화제|GV|관객과의 대화|톡|토크|시네토크|강연/.test(programText)
          ? programText.includes("영화제")
            ? "festival"
            : "talk"
          : "program",
        status: dtryxSessionStatus(item),
        tags: [item.RatingNm, item.RunningTime ? `${item.RunningTime}분` : "", item.ScreeningInfo, item.PlayTimeTypeNm].filter(Boolean),
        summary: canReserve
          ? `${item.ScreenNm || "상영관"} · 잔여 ${item.RemainSeatCnt ?? item.SeatRemainCnt ?? "?"}/${item.TotalSeatCnt ?? "?"}석`
          : decodeEntities(item.NextSkipYnMsg || `${item.ScreenNm || "상영관"} · 공식 확인 필요`),
        bookingUrl: dtryxReserveUrl({
          cgid: config.cgid,
          brandCd: config.brandCd,
          cinemaCd: config.cinemaCd,
          movieCd: item.MovieCd,
          playSDT: item.PlaySDT || date,
          screenCd: item.ScreenCd,
          showSeq: item.ShowSeq,
          reserveBaseUrl: config.reserveBaseUrl
        }),
        bookingType: canReserve ? "booking" : "official",
        actionLabel: canReserve ? "예매" : "공식 확인",
        sourceId: config.sourceId,
        posterUrl: item.PosterUrl || item.ImgUrl || item.Url || ""
      });
    }
  }

  return { sourceId: config.sourceId, url: config.pageUrl, sessions };
}

async function fetchMovieeSessions(config) {
  const dateUrl = `https://moviee.co.kr/api/TicketApi/GetPlayDateList?tIdList=${config.theaterId}&mId=&groupCd=-1&mode=0&gId=&pId=`;
  const datesData = await fetchJson(dateUrl);
  const dates = (datesData.ResData?.Table || [])
    .map((row) => normalizeDate(row.PLAY_DT))
    .filter((date) => date >= todayKst())
    .slice(0, 14);
  const sessions = [];

  for (const date of dates) {
    const params = new URLSearchParams({
      tId: config.theaterId,
      mId: "",
      playDt: date,
      ntId: "",
      gId: ""
    });
    const data = await fetchJson(`https://moviee.co.kr/api/TicketApi/GetPlayTimeList?${params.toString()}`);

    for (const item of data.ResData?.Table || []) {
      const time = normalizeCompactTime(item.PLAY_TIME);
      const canReserve =
        String(item.RESERVE_YN || "") === "1" &&
        String(item.TICKET_STOP_YN || "") !== "1" &&
        isFutureKstDateTime(item.LIMIT_TIME);
      const remainingSeats = Number(item.REMAINSEAT_CNT);
      const totalSeats = Number(item.SEAT_CNT);
      const status = remainingSeats === 0 ? "soldout" : canReserve ? "confirmed" : "needs-check";
      const runtime = runtimeFromCompactTimes(item.PLAY_TIME, item.END_TIME);
      const grade = movieeGradeLabel(item.GRADE);
      const programText = `${item.M_NM || ""} ${item.SUBTITLE || ""}`;

      sessions.push({
        id: `live-${config.venueId}-${compactDate(date)}-${item.PT_ID || shortHash(`${item.M_ID}-${item.TS_ID}-${item.PNO}-${time}`)}`,
        date,
        time,
        timeSort: time,
        title: item.M_NM,
        venueId: config.venueId,
        screen: item.TS_NM || config.screenFallback || "상영관",
        program: item.SUBTITLE || "상영시간표",
        kind: /GV|관객과의 대화|톡|토크|시네토크|강연/.test(programText) ? "talk" : "program",
        status,
        tags: [grade, runtime, item.SUBTITLE].filter(Boolean),
        summary: canReserve
          ? `${item.TS_NM || "상영관"} · 잔여 ${Number.isFinite(remainingSeats) ? remainingSeats : "?"}/${Number.isFinite(totalSeats) ? totalSeats : "?"}석`
          : `${item.TS_NM || "상영관"} · 온라인 예매 마감 여부 공식 확인`,
        bookingUrl: movieeTicketUrl({
          theaterId: config.theaterId,
          movieId: item.M_ID,
          playDate: date,
          screenId: item.TS_ID,
          playNo: item.PNO
        }),
        detailUrl: config.pageUrl,
        bookingType: canReserve ? "booking" : "official",
        actionLabel: canReserve ? "예매" : "공식 확인",
        sourceId: config.sourceId,
        posterUrl: movieePosterUrl(item.THUMB_FILE)
      });
    }
  }

  return { sourceId: config.sourceId, url: config.pageUrl, sessions };
}

async function fetchKucineSessions() {
  return fetchMovieeSessions({
    sourceId: "kucine-moviee-showtimes",
    venueId: "kucine",
    theaterId: "121",
    pageUrl: "https://kucinema.net/reservation/",
    screenFallback: "KU시네마테크"
  });
}

async function fetchFilmforumSessions() {
  return fetchMovieeSessions({
    sourceId: "filmforum-moviee-showtimes",
    venueId: "filmforum",
    theaterId: "130",
    pageUrl: "http://www.filmforum.kr/movie/ticketing.asp",
    screenFallback: "필름포럼"
  });
}

async function fetchSangsangmadangSessions() {
  return fetchMovieeSessions({
    sourceId: "sangsangmadang-cinema",
    venueId: "sangsangmadang",
    theaterId: "123",
    pageUrl: "https://www.sangsangmadang.com/movie/list",
    screenFallback: "KT&G 상상마당 시네마"
  });
}

function extractJsonLdObjects(html) {
  const objects = [];
  for (const match of String(html || "").matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) objects.push(...parsed);
      else objects.push(parsed);
    } catch {
      // Ignore malformed third-party schema blocks.
    }
  }
  return objects;
}

function movielandProductLinks(html, pageUrl) {
  const links = [];
  for (const match of String(html || "").matchAll(/href=["']([^"']*\/product\/[^"']+\/\d+\/category\/24\/display\/1\/[^"']*)["']/gi)) {
    const absolute = toAbsoluteUrl(pageUrl, match[1]).replace(/\?.*$/, "");
    const parsed = parseUrl(absolute);
    if (!parsed || !/\/product\/[^/]+\/\d+\/category\/24\/display\/1\/?$/i.test(parsed.pathname)) continue;
    links.push(parsed.toString());
  }
  return uniqBy(links, (url) => url).slice(0, 40);
}

function movielandProductId(url) {
  return String(url || "").match(/\/product\/[^/]+\/(\d+)\//)?.[1] || shortHash(url);
}

function movielandTitle(html, product) {
  const title = stripHtml(String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
    .replace(/\s*-\s*MOVIE LAND.*$/i, "")
    .trim();
  if (title) return title;
  const description = String(product?.description || "").replace(/\s+\d{4}\s*$/, "").trim();
  return description || product?.name || "무비랜드 상영작";
}

function movielandBookingUrl(offerUrl, detailUrl) {
  const url = parseUrl(offerUrl);
  if (url?.searchParams.get("item_code")) {
    return `${url.origin}${url.pathname}?item_code=${encodeURIComponent(url.searchParams.get("item_code"))}`;
  }
  return detailUrl;
}

function parseMovielandOfferName(offerName) {
  const text = decodeEntities(offerName).replace(/\s+/g, " ").trim();
  const patterns = [
    /^(?<title>.+?)\s+(?<month>\d{1,2})\s*[.\/]\s*(?<day>\d{1,2})\s*(?:\((?<weekday>[A-Z]{2,3}|[월화수목금토일])\))?\s*[-–—]\s*(?<time>\d{1,2}:\d{2})(?:\s*[-–—]\s*(?<seat>[A-Z]\d+|[가-힣A-Za-z0-9]+))?\s*$/i,
    /^(?<title>.+?)\s+(?<month>\d{1,2})\s*월\s*(?<day>\d{1,2})\s*일(?:\s*\([^)]+\))?\s+(?<time>\d{1,2}:\d{2})(?:\s+(?<seat>[A-Z]\d+|[가-힣A-Za-z0-9]+))?\s*$/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.groups) continue;
    return {
      title: match.groups.title.trim(),
      date: dateFromMonthDay(Number(match.groups.month), Number(match.groups.day)),
      time: normalizeTime(match.groups.time),
      seat: match.groups.seat || ""
    };
  }

  return null;
}

function parseMovielandProductSessions(html, detailUrl) {
  const product = extractJsonLdObjects(html).find((item) => item?.["@type"] === "Product" && Array.isArray(item.offers));
  if (!product) return [];

  const title = movielandTitle(html, product);
  const productId = movielandProductId(detailUrl);
  const poster = Array.isArray(product.image) ? product.image[0] : product.image || "";
  const grouped = new Map();

  for (const offer of product.offers || []) {
    const offerName = String(offer?.name || "");
    const parsedOffer = parseMovielandOfferName(offerName);
    if (!parsedOffer) continue;

    const date = parsedOffer.date;
    if (date < todayKst()) continue;

    const time = parsedOffer.time;
    const key = `${date}|${time}`;
    const isAvailable = !/OutOfStock/i.test(String(offer.availability || ""));
    const group = grouped.get(key) || {
      date,
      time,
      totalSeats: 0,
      remainingSeats: 0,
      firstUrl: "",
      availableUrl: ""
    };

    group.totalSeats += 1;
    if (isAvailable) {
      group.remainingSeats += 1;
      if (!group.availableUrl) group.availableUrl = offer.url || "";
    }
    if (!group.firstUrl) group.firstUrl = offer.url || "";
    grouped.set(key, group);
  }

  return [...grouped.values()].map((group) => {
    const bookingUrl = movielandBookingUrl(group.availableUrl || group.firstUrl, detailUrl);
    const status = group.remainingSeats <= 0 ? "soldout" : "confirmed";
    return {
      id: `live-movieland-${compactDate(group.date)}-${productId}-${group.time.replace(":", "")}`,
      date: group.date,
      time: group.time,
      timeSort: group.time,
      title,
      venueId: "movieland",
      screen: "무비랜드",
      program: "상영시간표",
      kind: "program",
      status,
      tags: [product.description ? String(product.description).replace(title, "").trim() : ""].filter(Boolean),
      summary: `무비랜드 · 잔여 ${group.remainingSeats}/${group.totalSeats}석`,
      bookingUrl,
      detailUrl,
      bookingType: "booking",
      actionLabel: "예매",
      sourceId: "movieland-cafe24-options",
      posterUrl: poster
    };
  });
}

async function fetchMovielandSessions() {
  const pageUrl = "https://movieland.co/category/now-showing/24/";
  const { response, text } = await fetchText(pageUrl);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  const sessions = [];
  for (const productUrl of movielandProductLinks(text, pageUrl)) {
    const detail = await fetchText(productUrl);
    if (!detail.response.ok) continue;
    sessions.push(...parseMovielandProductSessions(detail.text, productUrl.replace(/\/category\/24\/display\/1\/?$/i, "/")));
  }

  return { sourceId: "movieland-cafe24-options", url: pageUrl, sessions };
}

function yearForMonth(month) {
  const today = todayKst();
  const baseYear = Number(today.slice(0, 4));
  const baseMonth = Number(today.slice(5, 7));
  if (baseMonth >= 11 && month <= 2) return baseYear + 1;
  if (baseMonth <= 2 && month >= 11) return baseYear - 1;
  return baseYear;
}

function dateFromParts(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateFromMonthDay(month, day) {
  return dateFromParts(yearForMonth(month), month, day);
}

function articleBodyText(html) {
  const body =
    html.match(/<div\b[^>]*class=["'][^"']*contents_style[^"']*["'][^>]*>([\s\S]*?)<div class=["']wrap_btn/i)?.[1] ||
    html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i)?.[1] ||
    html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/i)?.[1] ||
    "";
  return decodeEntitiesPreservingBreaks(
    body
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6]|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function indiespacePostTitle(html, fallback = "") {
  const title =
    html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']*)["']/i)?.[1] ||
    html.match(/<meta\s+name=["']title["']\s+content=["']([^"']*)["']/i)?.[1] ||
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    fallback;
  return stripHtmlKeepingKoreanAngles(title);
}

function indiespacePoster(html) {
  const raw =
    html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']*)["']/i)?.[1] ||
    html.match(/data-thumbnail-url=["']([^"']+)["']/i)?.[1] ||
    "";
  return raw ? decodeEntities(raw) : "";
}

function cleanIndiespacePostTitle(title) {
  const text = stripHtmlKeepingKoreanAngles(title)
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  const angle = text.match(/[<〈]([^>〉]{1,90})[>〉]/);
  if (angle) return angle[1].trim();
  return text
    .replace(/\s*상영일정.*$/g, "")
    .replace(/\s*특별상영.*$/g, "")
    .replace(/\s*\/\s*영화예매.*$/g, "")
    .trim();
}

function indiespaceProgramTitle(title) {
  const text = stripHtmlKeepingKoreanAngles(title).replace(/^\[[^\]]+\]\s*/, "").trim();
  if (/썸머프라이드시네마/.test(text)) return "썸머프라이드시네마2026";
  if (/WDN/.test(text)) return "WDN 영화제";
  if (/무학산영화제/.test(text)) return "5회 무학산영화제";
  if (/인디돌잔치/.test(text)) return "인디돌잔치";
  if (/쇼케이스/.test(text)) return "독립영화 쇼케이스";
  if (/특별상영/.test(text)) return "특별상영";
  if (/상영일정|영화예매/.test(text)) return "작품별 상영일정";
  return text.replace(/[<〈][^>〉]+[>〉]/g, "").trim() || "인디스페이스";
}

function parseKoreanDateFromLine(line) {
  const match = String(line).match(/(?:(20\d{2})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (!match) return "";
  const month = Number(match[2]);
  const day = Number(match[3]);
  return dateFromParts(Number(match[1]) || yearForMonth(month), month, day);
}

function findKoreanTime(line) {
  const colon = String(line).match(/(\d{1,2}):(\d{2})/);
  const korean = String(line).match(/(오전|오후)\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
  if (!colon && !korean) return null;
  if (colon && (!korean || colon.index <= korean.index)) {
    return {
      index: colon.index,
      length: colon[0].length,
      time: `${colon[1].padStart(2, "0")}:${colon[2]}`
    };
  }

  let hour = Number(korean[2]);
  if (korean[1] === "오후" && hour < 12) hour += 12;
  if (korean[1] === "오전" && hour === 12) hour = 0;
  return {
    index: korean.index,
    length: korean[0].length,
    time: `${String(hour).padStart(2, "0")}:${String(korean[3] || "00").padStart(2, "0")}`
  };
}

function isIndiespaceScheduleNote(value) {
  return /^(?:조조|종영|조조\s*종영|인디토크|미니\s*인디토크)$/i.test(String(value || "").trim());
}

function titleFromIndiespaceTimeLine(line, timeMatch, fallbackTitle) {
  const after = String(line)
    .slice(timeMatch.index + timeMatch.length)
    .replace(/^[\s:：·.,\-]+/, "")
    .replace(/\s*\(참석[:：][\s\S]*$/g, "")
    .replace(/\s*참석[:：][\s\S]*$/g, "")
    .replace(/\s*진행[:：][\s\S]*$/g, "")
    .replace(/\s*\*\s*상영\s*전\s*영화안내[\s\S]*$/g, "")
    .trim();
  const angle = after.match(/[<〈]([^>〉]{1,90})[>〉]/);
  const cleaned = (angle ? angle[1] : after)
    .replace(/\s*\+?\s*(GV|인디토크)\b[\s\S]*$/gi, "")
    .replace(/\s*조조\s*개봉?$/g, "")
    .replace(/\s*개봉$/g, "")
    .trim();
  return !cleaned || isIndiespaceScheduleNote(cleaned) ? fallbackTitle : cleaned;
}

function indiespaceKind(program, line) {
  const text = `${program || ""} ${line || ""}`;
  if (/영화제|프라이드시네마|무학산/.test(text)) return "festival";
  if (/GV|관객과의 대화|인디토크|토크|포럼|쇼케이스|돌잔치|특별상영/.test(text)) return "talk";
  return "program";
}

function indiespaceActionInfo(text) {
  const formUrl = String(text).match(/https:\/\/forms\.gle\/[^\s<>"']+/i)?.[0] || "";
  if (formUrl) {
    return {
      bookingUrl: formUrl,
      bookingType: "official",
      actionLabel: "관람 신청"
    };
  }
  return {
    bookingUrl: "https://indiespace.kr/notice/5494",
    bookingType: "guide",
    actionLabel: "예매 안내"
  };
}

function parseIndiespacePostSessions(html, pageUrl, fallbackTitle = "") {
  const postTitle = indiespacePostTitle(html, fallbackTitle);
  const baseTitle = cleanIndiespacePostTitle(postTitle);
  const program = indiespaceProgramTitle(postTitle);
  const text = articleBodyText(html);
  const poster = indiespacePoster(html);
  const action = indiespaceActionInfo(text);
  const sessions = [];
  let activeDate = "";

  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line || /^window\./.test(line)) continue;

    const parsedDate = parseKoreanDateFromLine(line);
    if (parsedDate) activeDate = parsedDate;

    const timeMatch = findKoreanTime(line);
    if (!activeDate || !timeMatch) continue;

    const title = titleFromIndiespaceTimeLine(line, timeMatch, baseTitle);
    if (!title || /참석자는 변경|온라인 예매 환불/.test(title)) continue;

    sessions.push({
      id: `live-indiespace-${compactDate(activeDate)}-${shortHash(`${pageUrl}-${timeMatch.time}-${title}`)}`,
      date: activeDate,
      time: timeMatch.time,
      timeSort: timeMatch.time,
      title,
      venueId: "indiespace",
      screen: "인디스페이스",
      program,
      kind: indiespaceKind(program, line),
      status: "confirmed",
      tags: [/GV/.test(line) ? "GV" : "", /인디토크/.test(line) ? "인디토크" : "", /무료|관람 신청/.test(text) ? "관람 신청" : ""].filter(Boolean),
      summary: `${program} · 공식 상세글 기준`,
      ...action,
      detailUrl: pageUrl,
      sourceId: "indiespace-official-posts",
      posterUrl: poster
    });
  }

  return uniqBy(sessions, (session) => `${session.date}|${session.time}|${session.title}|${session.detailUrl}`).filter(
    (session) => session.date >= todayKst()
  );
}

async function fetchIndiespaceOfficialSessions() {
  const pageUrl = "https://indiespace.kr/";
  const { response, text } = await fetchText(pageUrl);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const source = { id: "indiespace-official-posts", name: "인디스페이스 공식 상세글", url: pageUrl };
  const items = extractIndiespaceListingItems(source, text)
    .filter((item) => /상영일정|영화예매|영화제|쇼케이스|특별상영|인디돌잔치|썸머/.test(item.title))
    .slice(0, 28);
  const sessions = [];

  for (const item of items) {
    const detail = await fetchText(item.url);
    if (!detail.response.ok) continue;
    sessions.push(...parseIndiespacePostSessions(detail.text, item.url, item.title));
  }

  return { sourceId: "indiespace-official-posts", url: pageUrl, sessions };
}

function splitTableCells(rowHtml) {
  return [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
}

function parseSacDateLabels(rowHtml) {
  return [...rowHtml.matchAll(/<strong>\s*(\d{2})\.(\d{2})\.[^<]*<\/strong>/gi)].map((match) =>
    dateFromMonthDay(Number(match[1]), Number(match[2]))
  );
}

function parseSacSessionsFromHtml(html, pageUrl) {
  const sessions = [];
  let activeDates = [];
  const rowPattern = /<tr\b[^>]*class=["'][^"']*\b(date-label|event)\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(html))) {
    const rowType = rowMatch[1];
    const rowHtml = rowMatch[2];

    if (rowType === "date-label") {
      activeDates = parseSacDateLabels(rowHtml);
      continue;
    }

    splitTableCells(rowHtml).forEach((cellHtml, index) => {
      const date = activeDates[index];
      const anchorMatch = cellHtml.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i);
      if (!date || !anchorMatch) return;

      const paragraphs = [...cellHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => match[1]);
      const time = normalizeTime(stripHtml(paragraphs[0] || cellHtml));
      const titleHtml = paragraphs.find((paragraph, paragraphIndex) => paragraphIndex > 0 && stripHtml(paragraph).length > 1) || cellHtml;
      const titleText = stripHtml(titleHtml);
      const runtimeMatch = titleText.match(/\((\d+)\s*min\)/i);
      const title = titleText.replace(/\(\d+\s*min\)/i, "").trim();
      const bookingUrl = toAbsoluteUrl(pageUrl, anchorMatch[1]);
      const kind = /GV|관객과의 대화|씨네토크|강연|토크|연주상영/.test(title) ? "talk" : "program";

      sessions.push({
        id: `live-sac-${date}-${shortHash(`${bookingUrl}-${time}-${title}`)}`,
        date,
        time,
        timeSort: time,
        title,
        venueId: "sac",
        screen: "서울아트시네마",
        program: "상영시간표",
        kind,
        status: "confirmed",
        tags: [runtimeMatch ? `${runtimeMatch[1]}분` : ""].filter(Boolean),
        summary: runtimeMatch ? `서울아트시네마 · ${runtimeMatch[1]}분` : "서울아트시네마 공식 시간표",
        bookingUrl,
        bookingType: "booking",
        actionLabel: "예매",
        sourceId: "sac-timetable"
      });
    });
  }

  return sessions.filter((session) => session.date >= todayKst());
}

async function fetchSacSessions() {
  const pageUrl = "https://www.cinematheque.seoul.kr/bbs/content.php?co_id=timetable";
  const { response, text } = await fetchText(pageUrl);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return { sourceId: "sac-timetable", url: pageUrl, sessions: parseSacSessionsFromHtml(text, pageUrl) };
}

function firstText(html, pattern) {
  return stripHtml(html.match(pattern)?.[1] || "");
}

function parseKofaSessionsFromHtml(html, pageUrl) {
  const start = html.indexOf("list-kofa-calendar");
  const body = start >= 0 ? html.slice(start) : html;
  const sessions = [];
  let activeMonth = "";
  let activeDay = "";
  const tokenPattern =
    /<dt\b[^>]*class=["']txt-month["'][^>]*>(\d{2})월<\/dt>|<dt\b[^>]*class=["']txt-day["'][^>]*>(\d{2})\.[^<]*<\/dt>|<!--\s*상세\s*-->([\s\S]*?)<!--\s*\/\/상세\s*-->/gi;
  let match;

  while ((match = tokenPattern.exec(body))) {
    if (match[1]) {
      activeMonth = match[1];
      continue;
    }
    if (match[2]) {
      activeDay = match[2];
      continue;
    }

    const detailHtml = match[3];
    if (!activeMonth || !activeDay || !/icon-dot/.test(detailHtml)) continue;

    const date = dateFromMonthDay(Number(activeMonth), Number(activeDay));
    if (date < todayKst()) continue;

    const movieMatch = detailHtml.match(/<p\b[^>]*class=["']txt-1["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const time = normalizeTime(firstText(detailHtml, /<span\b[^>]*class=["']icon-dot["'][^>]*>([\s\S]*?)<\/span>/i));
    const room = firstText(detailHtml, /<li\b[^>]*class=["']txt-room["'][^>]*>([\s\S]*?)<\/li>/i);
    const title = stripHtml(movieMatch?.[2] || "");
    if (!title || time === "시간 확인") continue;

    const runtime = firstText(detailHtml, /<span\b[^>]*class=["']min["'][^>]*>[\s\S]*?<\/strong>([\s\S]*?)<\/span>/i);
    const format = firstText(detailHtml, /<span\b[^>]*class=["']fomat["'][^>]*>([\s\S]*?)<\/span>/i);
    const program = firstText(detailHtml, /<p\b[^>]*class=["']layer-txt-1["'][^>]*>([\s\S]*?)<\/p>/i) || "시네마테크KOFA";
    const reservationId = detailHtml.match(/wRsvMovie\('[^']+'\s*,\s*'([^']+)'\)/)?.[1] || "";
    const detailUrl = movieMatch?.[1] ? toAbsoluteUrl(pageUrl, movieMatch[1]) : pageUrl;
    const kind = /GV|관객과의 대화|강연|토크|이벤트|특별/.test(`${program} ${detailHtml}`) ? "talk" : "program";

    sessions.push({
      id: `live-kofa-${date}-${shortHash(`${time}-${room}-${title}-${reservationId}`)}`,
      date,
      time,
      timeSort: time,
      title,
      venueId: "kofa",
      screen: room || "시네마테크KOFA",
      program,
      kind,
      status: "confirmed",
      tags: [runtime, format].filter(Boolean),
      summary: [room, runtime, format].filter(Boolean).join(" · ") || "KOFA 공식 시간표",
      bookingUrl: pageUrl,
      detailUrl,
      bookingType: "official",
      actionLabel: "공식 시간표",
      sourceId: "kofa-schedule",
      reservationId
    });
  }

  return sessions;
}

async function fetchKofaSessions() {
  const pageUrl = "https://www.koreafilm.or.kr/cinematheque/schedule";
  const { response, text } = await fetchText(pageUrl);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return { sourceId: "kofa-schedule", url: pageUrl, sessions: parseKofaSessionsFromHtml(text, pageUrl) };
}

const fullLiveFetchers = [
  fetchCinecubeSessions,
  fetchMomoSessions,
  fetchEmuSessions,
  fetchArirangSessions,
  fetchArtnineSessions,
  fetchLaikaSessions,
  fetchForestSessions,
  fetchKucineSessions,
  fetchFilmforumSessions,
  fetchSangsangmadangSessions,
  fetchMovielandSessions,
  fetchIndiespaceOfficialSessions,
  fetchSacSessions,
  fetchKofaSessions,
  fetchHeyriSessions
];

const seatStatusFetchers = [
  fetchCinecubeSessions,
  fetchMomoSessions,
  fetchEmuSessions,
  fetchArirangSessions,
  fetchArtnineSessions,
  fetchLaikaSessions,
  fetchForestSessions,
  fetchKucineSessions,
  fetchFilmforumSessions,
  fetchSangsangmadangSessions,
  fetchMovielandSessions,
  fetchHeyriSessions
];

function seatStatusRefreshIssue({ expectedSources, successfulSources, fetchedSessions, updatedSessions }) {
  const expected = Math.max(1, Number(expectedSources) || 0);
  const minimumSuccessfulSources = Math.ceil(expected / 2);
  if ((Number(successfulSources) || 0) < minimumSuccessfulSources) {
    return `only ${successfulSources || 0}/${expected} seat sources returned usable data`;
  }
  if ((Number(fetchedSessions) || 0) < 1) return "seat sources returned no future sessions";
  if ((Number(updatedSessions) || 0) < 1) return "seat refresh did not match any committed sessions";
  return "";
}

const liveFetcherSourceIds = new Map([
  [fetchCinecubeSessions, "cinecube-time-order"],
  [fetchMomoSessions, "momo-dtryx-showtimes"],
  [fetchEmuSessions, "emu-dtryx-showtimes"],
  [fetchArirangSessions, "arirang-dtryx-showtimes"],
  [fetchArtnineSessions, "artnine-dtryx-showtimes"],
  [fetchLaikaSessions, "laika-dtryx-showtimes"],
  [fetchForestSessions, "forest-schedule"],
  [fetchKucineSessions, "kucine-moviee-showtimes"],
  [fetchFilmforumSessions, "filmforum-moviee-showtimes"],
  [fetchSangsangmadangSessions, "sangsangmadang-cinema"],
  [fetchMovielandSessions, "movieland-cafe24-options"],
  [fetchIndiespaceOfficialSessions, "indiespace-official-posts"],
  [fetchSacSessions, "sac-timetable"],
  [fetchKofaSessions, "kofa-schedule"],
  [fetchHeyriSessions, "heyri-dtryx-showtimes"]
]);

const dtryxPublicFallbackConfigs = new Map([
  [
    "momo-dtryx-showtimes",
    {
      sourceId: "momo-dtryx-showtimes",
      venueId: "momo",
      cinemaCd: "000067",
      brandCd: "indieart",
      cgid: "",
      publicCgid: "",
      pageUrl: "https://www.arthousemomo.co.kr/pages/showtimes.php",
      screenFallback: "아트하우스 모모",
      bookingUrl: "momo"
    }
  ],
  [
    "emu-dtryx-showtimes",
    {
      sourceId: "emu-dtryx-showtimes",
      venueId: "emu",
      cinemaCd: "000069",
      brandCd: "indieart",
      cgid: "FE8EF4D2-F22D-4802-A39A-D58F23A29C1E",
      pageUrl: "http://www.emuartspace.com/main/emuartspace/",
      screenFallback: "에무시네마"
    }
  ],
  [
    "arirang-dtryx-showtimes",
    {
      sourceId: "arirang-dtryx-showtimes",
      venueId: "arirang",
      cinemaCd: "000088",
      brandCd: "etc",
      cgid: "FE8EF4D2-F22D-4802-A39A-D58F23A29C1E",
      pageUrl: "https://cine.arirang.go.kr:8443/arirang/index.do",
      skipDatePageProbe: true,
      screenFallback: "아리랑시네센터"
    }
  ],
  [
    "artnine-dtryx-showtimes",
    {
      sourceId: "artnine-dtryx-showtimes",
      venueId: "artnine",
      cinemaCd: "000162",
      brandCd: "etc",
      cgid: "FE8EF4D2-F22D-4802-A39A-D58F23A29C1E",
      pageUrl: "https://litt.ly/artnine",
      screenFallback: "아트나인"
    }
  ],
  [
    "laika-dtryx-showtimes",
    {
      sourceId: "laika-dtryx-showtimes",
      venueId: "laika",
      cinemaCd: "000072",
      brandCd: "spacedog",
      cgid: "FE8EF4D2-F22D-4802-A39A-D58F23A29C1E",
      pageUrl: "https://www.dtryx.com/cinema/main.do?cgid=FE8EF4D2-F22D-4802-A39A-D58F23A29C1E&BrandCd=spacedog&CinemaCd=000072",
      screenFallback: "라이카시네마"
    }
  ],
  [
    "forest-schedule",
    {
      sourceId: "forest-schedule",
      venueId: "forest",
      cinemaCd: "000065",
      brandCd: "indieart",
      cgid: "81630DDE-489C-4034-A6FB-9AD54E055E5B",
      pageUrl: "https://www.dtryx.com/cinema/main.do?cgid=81630DDE-489C-4034-A6FB-9AD54E055E5B&BrandCd=indieart&CinemaCd=000065",
      screenFallback: "더숲아트시네마"
    }
  ],
  [
    "heyri-dtryx-showtimes",
    {
      sourceId: "heyri-dtryx-showtimes",
      venueId: "heyri",
      cinemaCd: "000071",
      brandCd: "indieart",
      cgid: "FE8EF4D2-F22D-4802-A39A-D58F23A29C1E",
      pageUrl: "https://scinema.org/cinema/main.do?cgid=FE8EF4D2-F22D-4802-A39A-D58F23A29C1E&BrandCd=indieart&CinemaCd=000071",
      reserveBaseUrl: "https://scinema.org",
      screenFallback: "헤이리시네마"
    }
  ]
]);

async function fetchLiveFallback(sourceId) {
  const config = dtryxPublicFallbackConfigs.get(sourceId);
  if (!config) return null;
  return fetchDtryxPublicShowseqSessions(config);
}

function isUpcomingSession(session, today, currentTime) {
  if (!session?.date) return true;
  if (session.date < today) return false;
  if (session.date > today) return true;
  const time = String(session.timeSort || session.time || "");
  return !/^\d{2}:\d{2}$/.test(time) || time >= currentTime;
}

function liveSessionMetrics(sessions, now = new Date()) {
  const today = todayKst(now);
  const currentTime = currentKstTime(now);
  const dates = new Set();
  let count = 0;
  for (const session of sessions || []) {
    if (!isUpcomingSession(session, today, currentTime)) continue;
    count += 1;
    if (session?.date) dates.add(session.date);
  }
  return { sessions: count, dates: dates.size };
}

function sourceSessionMetrics(schedule, now = new Date()) {
  const today = todayKst(now);
  const currentTime = currentKstTime(now);
  const metrics = {};
  for (const session of schedule.sessions || []) {
    if (!isUpcomingSession(session, today, currentTime)) continue;
    const sourceId = session.sourceId || "unknown";
    metrics[sourceId] ||= { sessions: 0, dates: new Set() };
    metrics[sourceId].sessions += 1;
    if (session.date) metrics[sourceId].dates.add(session.date);
  }

  return Object.fromEntries(
    Object.entries(metrics).map(([sourceId, value]) => [
      sourceId,
      {
        sessions: value.sessions,
        dates: value.dates.size
      }
    ])
  );
}

function liveResultQualityIssue(sourceId, sessions, existingMetrics = {}, now = new Date()) {
  const current = liveSessionMetrics(sessions, now);
  const existing = existingMetrics[sourceId] || { sessions: 0, dates: 0 };
  const floor = sourceSafetyFloors[sourceId];

  if (current.sessions <= 0 && existing.sessions > 0) {
    return `returned 0 sessions; existing has ${existing.sessions}`;
  }

  if (floor && existing.sessions >= floor.sessions && current.sessions < floor.sessions) {
    return `session count below safety floor ${current.sessions}/${floor.sessions}; existing has ${existing.sessions}`;
  }

  if (floor && existing.dates >= floor.dates && current.dates < floor.dates) {
    return `date coverage below safety floor ${current.dates}/${floor.dates}; existing has ${existing.dates}`;
  }

  if (existing.sessions >= 8 && current.sessions < Math.ceil(existing.sessions * suspiciousDropSessionRatio)) {
    return `session count suspiciously dropped ${current.sessions}/${existing.sessions}`;
  }

  if (existing.dates >= 3 && current.dates < Math.ceil(existing.dates * suspiciousDropDateRatio)) {
    return `date coverage suspiciously dropped ${current.dates}/${existing.dates}`;
  }

  return "";
}

function liveResultFallbackProbeIssue(sourceId, sessions, existingMetrics = {}, now = new Date()) {
  if (!dtryxPublicFallbackConfigs.has(sourceId)) return "";

  const current = liveSessionMetrics(sessions, now);
  const existing = existingMetrics[sourceId] || { sessions: 0, dates: 0 };
  const floor = sourceSafetyFloors[sourceId] || { sessions: 0, dates: 0 };

  if (current.sessions <= 0) return "";
  if (existing.sessions < floor.sessions || existing.dates < floor.dates) return "";

  if (current.sessions < Math.ceil(existing.sessions * fallbackProbeSessionRatio)) {
    return `session count softened below fallback probe threshold ${current.sessions}/${existing.sessions}`;
  }

  if (current.dates < Math.ceil(existing.dates * fallbackProbeDateRatio)) {
    return `date coverage softened below fallback probe threshold ${current.dates}/${existing.dates}`;
  }

  return "";
}

function mergeFallbackResult(primaryResult, fallbackResult, reason = "") {
  const sourceId = primaryResult.sourceId || fallbackResult.sourceId;
  const primarySessions = Array.isArray(primaryResult.sessions) ? primaryResult.sessions : [];
  const fallbackSessions = Array.isArray(fallbackResult.sessions) ? fallbackResult.sessions : [];
  const sessions = uniqBy([...primarySessions, ...fallbackSessions], (session) => session.id || `${session.date}|${session.time}|${session.title}|${session.screen}`);

  return {
    ...primaryResult,
    sourceId,
    sessions,
    fallbackMerged: true,
    fallbackReason: reason,
    fallbackSessionCount: fallbackSessions.length
  };
}

async function richerFallbackMerge(sourceId, result, existingMetrics, reason) {
  const fallback = await acceptedFallbackResult(sourceId, existingMetrics);
  if (!fallback.result) return { result, warning: fallback.issue };

  const primarySessions = Array.isArray(result.sessions) ? result.sessions : [];
  const merged = mergeFallbackResult({ ...result, sourceId, sessions: primarySessions }, fallback.result, reason);
  const primaryMetrics = liveSessionMetrics(primarySessions);
  const mergedMetrics = liveSessionMetrics(merged.sessions);

  if (mergedMetrics.sessions > primaryMetrics.sessions || mergedMetrics.dates > primaryMetrics.dates) {
    return { result: merged, warning: "" };
  }

  return { result, warning: "fallback had no additional sessions" };
}

function retainedExistingWarning(sourceId, reason, existingMetrics) {
  const existing = existingMetrics[sourceId] || { sessions: 0, dates: 0 };
  return {
    sourceId,
    warning: `${reason}; kept ${existing.sessions} existing sessions across ${existing.dates} date(s)`,
    preservedExisting: true,
    existingSessionCount: existing.sessions,
    existingDateCount: existing.dates
  };
}

function rejectedLiveResultError(sourceId, reason, url = "", existingMetrics = {}) {
  const existing = existingMetrics[sourceId] || { sessions: 0, dates: 0 };
  if (existing.sessions > 0) return retainedExistingWarning(sourceId, reason, existingMetrics);
  return { sourceId, url, error: reason };
}

async function acceptedFallbackResult(sourceId, existingMetrics) {
  const fallback = await fetchLiveFallback(sourceId);
  if (!fallback) return { result: null, issue: "no fallback configured" };

  const fallbackSourceId = fallback.sourceId || sourceId;
  const sessions = Array.isArray(fallback.sessions) ? fallback.sessions : [];
  const issue = liveResultQualityIssue(fallbackSourceId, sessions, existingMetrics);
  if (issue) return { result: null, issue: `fallback ${issue}` };

  return {
    result: {
      ...fallback,
      sourceId: fallbackSourceId,
      sessions
    },
    issue: ""
  };
}

function mergeLiveSessions(schedule, liveSessions, refreshedSourceIds = new Set(liveSourceIds)) {
  const refreshed = new Set(refreshedSourceIds);
  const supersededManualIds = new Set(
    [...refreshed].flatMap((sourceId) => supersededManualSourceIdsByLiveSourceId.get(sourceId) || [])
  );
  const existing = (schedule.sessions || []).filter(
    (session) => !refreshed.has(session.sourceId) && !supersededManualIds.has(session.sourceId)
  );
  return {
    ...schedule,
    sessions: [...existing, ...liveSessions].sort((a, b) =>
      `${a.date} ${a.timeSort || a.time} ${a.venueId}`.localeCompare(`${b.date} ${b.timeSort || b.time} ${b.venueId}`)
    )
  };
}

function compactSessionText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function seatStatusKeys(session) {
  const id = session.id ? `id:${session.id}` : "";
  const sourceKey = [
    "source",
    session.sourceId || "",
    session.date || "",
    session.time || "",
    session.venueId || "",
    compactSessionText(session.title),
    compactSessionText(session.screen)
  ].join("|");
  const screenKey = [
    "screen",
    session.date || "",
    session.time || "",
    session.venueId || "",
    compactSessionText(session.title),
    compactSessionText(session.screen)
  ].join("|");
  const titleKey = [
    "title",
    session.date || "",
    session.time || "",
    session.venueId || "",
    compactSessionText(session.title)
  ].join("|");
  return [id, sourceKey, screenKey, titleKey].filter(Boolean);
}

function indexSeatStatusSessions(sessions) {
  const byKey = new Map();
  for (const session of sessions) {
    for (const key of seatStatusKeys(session)) {
      if (!byKey.has(key)) byKey.set(key, session);
    }
  }
  return byKey;
}

function findSeatStatusSession(index, session) {
  for (const key of seatStatusKeys(session)) {
    if (index.has(key)) return index.get(key);
  }
  return null;
}

function mergeSeatStatuses(schedule, liveSessions, checkedAt) {
  const seatStatusIndex = indexSeatStatusSessions(liveSessions);
  let updatedSessions = 0;

  const sessions = (schedule.sessions || []).map((session) => {
    const next = findSeatStatusSession(seatStatusIndex, session);
    if (!next) return session;
    updatedSessions += 1;
    return {
      ...session,
      status: next.status || session.status,
      tags: next.tags?.length ? next.tags : session.tags,
      summary: next.summary || session.summary,
      bookingUrl: next.bookingUrl || session.bookingUrl,
      detailUrl: next.detailUrl || session.detailUrl,
      bookingType: next.bookingType || session.bookingType,
      actionLabel: next.actionLabel || session.actionLabel,
      posterUrl: next.posterUrl || session.posterUrl,
      seatStatusCheckedAt: checkedAt
    };
  });

  return {
    schedule: {
      ...schedule,
      sessions,
      meta: {
        ...(schedule.meta || {}),
        seatStatusVerifiedAt: checkedAt
      }
    },
    updatedSessions
  };
}

async function fetchLiveSessions(fetchers, existingSchedule = null) {
  const liveResults = [];
  const liveErrors = [];
  const liveWarnings = [];
  const existingMetrics = existingSchedule ? sourceSessionMetrics(existingSchedule) : {};
  for (const fetcher of fetchers) {
    const expectedSourceId = liveFetcherSourceIds.get(fetcher) || fetcher.name;
    if (collectInBrowser && browserLiveSourceIds.has(expectedSourceId)) continue;
    console.log(`[live] Fetching ${expectedSourceId}`);
    try {
      const result = await fetcher();
      const sourceId = result.sourceId || expectedSourceId;
      const sessions = Array.isArray(result.sessions) ? result.sessions : [];
      const qualityIssue = liveResultQualityIssue(sourceId, sessions, existingMetrics);
      if (qualityIssue) {
        const fallback = await acceptedFallbackResult(sourceId, existingMetrics);
        if (fallback.result) {
          liveResults.push(fallback.result);
          continue;
        }
        const rejected = rejectedLiveResultError(
          sourceId,
          `${qualityIssue}; ${fallback.issue}`,
          result.url || "",
          existingMetrics
        );
        if (rejected.warning) liveWarnings.push(rejected);
        else liveErrors.push(rejected);
        continue;
      }
      const fallbackProbeIssue = liveResultFallbackProbeIssue(sourceId, sessions, existingMetrics);
      if (fallbackProbeIssue) {
        const fallbackMerge = await richerFallbackMerge(sourceId, { ...result, sourceId, sessions }, existingMetrics, fallbackProbeIssue);
        liveResults.push(fallbackMerge.result);
        if (fallbackMerge.warning) {
          liveWarnings.push({
            sourceId,
            warning: `${fallbackProbeIssue}; ${fallbackMerge.warning}`,
            preservedExisting: false,
            existingSessionCount: existingMetrics[sourceId]?.sessions || 0,
            existingDateCount: existingMetrics[sourceId]?.dates || 0
          });
        }
        continue;
      }
      liveResults.push({ ...result, sourceId, sessions });
    } catch (error) {
      try {
        const fallback = await acceptedFallbackResult(expectedSourceId, existingMetrics);
        if (fallback.result) {
          liveResults.push(fallback.result);
          continue;
        }
        const rejected = rejectedLiveResultError(
          expectedSourceId,
          `${error.message}; ${fallback.issue}`,
          "",
          existingMetrics
        );
        if (rejected.warning) liveWarnings.push(rejected);
        else liveErrors.push(rejected);
      } catch (fallbackError) {
        const rejected = rejectedLiveResultError(
          expectedSourceId,
          `${error.message}; fallback failed: ${fallbackError.message}`,
          "",
          existingMetrics
        );
        if (rejected.warning) liveWarnings.push(rejected);
        else liveErrors.push(rejected);
      }
    }
  }
  return { liveResults, liveErrors, liveWarnings };
}

async function writeScheduleArtifacts(schedule) {
  await writeFileAtomic(schedulePath, JSON.stringify(schedule, null, 2), "utf8");
}

function hasExactSessionTime(session) {
  return /^\d{2}:\d{2}$/.test(String(session.time || ""));
}

function prunePastScheduleDates(schedule) {
  const today = todayKst();
  return {
    ...schedule,
    sessions: (schedule.sessions || []).filter((session) => !session.date || session.date >= today),
    festivals: (schedule.festivals || []).filter((festival) => !festival.date || festival.date >= today)
  };
}

function pruneUnscheduledSessions(schedule) {
  return {
    ...schedule,
    sessions: (schedule.sessions || []).filter(hasExactSessionTime)
  };
}

function ensureVenues(schedule) {
  const venues = [...(schedule.venues || [])];
  const byId = new Map(venues.map((venue) => [venue.id, venue]));
  const additions = [
    {
      id: "arirang",
      name: "아리랑시네센터",
      area: "성북",
      type: "독립·예술영화관",
      url: "https://cine.arirang.go.kr:8443/arirang/index.do",
      accent: "teal"
    },
    {
      id: "artnine",
      name: "아트나인",
      area: "이수",
      type: "독립·예술영화관",
      url: "https://litt.ly/artnine",
      accent: "violet"
    },
    {
      id: "kucine",
      name: "KU시네마테크",
      area: "광진",
      type: "독립·예술영화관",
      url: "https://kucinema.net/",
      accent: "pink"
    },
    {
      id: "filmforum",
      name: "필름포럼",
      area: "서대문",
      type: "독립·예술영화관",
      url: "http://www.filmforum.kr/",
      accent: "blue"
    },
    {
      id: "forest",
      name: "더숲아트시네마",
      area: "노원",
      type: "독립·예술영화관",
      url: "https://www.dtryx.com/cinema/main.do?cgid=81630DDE-489C-4034-A6FB-9AD54E055E5B&BrandCd=indieart&CinemaCd=000065",
      accent: "green"
    },
    {
      id: "sangsangmadang",
      name: "KT&G 상상마당 시네마",
      area: "홍대",
      type: "독립·예술영화관",
      url: "https://www.sangsangmadang.com/movie/list",
      accent: "red"
    },
    {
      id: "movieland",
      name: "무비랜드",
      area: "성수",
      type: "독립·예술영화관",
      url: "https://movieland.co/",
      accent: "amber"
    },
    {
      id: "heyri",
      name: "헤이리시네마",
      area: "파주 헤이리",
      type: "독립·예술영화관",
      url: "https://scinema.org/cinema/main.do?cgid=FE8EF4D2-F22D-4802-A39A-D58F23A29C1E&BrandCd=indieart&CinemaCd=000071",
      accent: "teal"
    }
  ];

  for (const venue of additions) {
    if (byId.has(venue.id)) {
      Object.assign(byId.get(venue.id), venue);
    } else {
      venues.push(venue);
    }
  }

  return { ...schedule, venues };
}

function ensureLiveSources(schedule) {
  const sources = [...(schedule.sources || [])];
  const byId = new Map(sources.map((source) => [source.id, source]));
  const additions = [
    {
      id: "cinecube-time-order",
      name: "씨네큐브 날짜별 시간표 API",
      venueId: "cinecube",
      url: "https://www.cinecube.co.kr/cinema/time-order-table",
      parserStatus: "live-api"
    },
    {
      id: "momo-dtryx-showtimes",
      name: "아트하우스 모모 Dtryx 시간표 API",
      venueId: "momo",
      url: "https://arthousemomo.co.kr/pages/showtimes.php",
      parserStatus: "live-api"
    },
    {
      id: "emu-dtryx-showtimes",
      name: "에무시네마 Dtryx 시간표 API",
      venueId: "emu",
      url: "http://www.emuartspace.com/main/emuartspace/",
      parserStatus: "live-api"
    },
    ...programBoardSources,
    {
      id: "arirang-dtryx-showtimes",
      name: "아리랑시네센터 Dtryx 시간표 API",
      venueId: "arirang",
      url: "https://cine.arirang.go.kr:8443/arirang/index.do",
      parserStatus: "live-api"
    },
    {
      id: "artnine-dtryx-showtimes",
      name: "아트나인 Dtryx 시간표 API",
      venueId: "artnine",
      url: "https://litt.ly/artnine",
      parserStatus: "live-api"
    },
    {
      id: "laika-dtryx-showtimes",
      name: "라이카시네마 Dtryx 시간표 API",
      venueId: "laika",
      url: "https://www.dtryx.com/cinema/main.do?cgid=FE8EF4D2-F22D-4802-A39A-D58F23A29C1E&BrandCd=spacedog&CinemaCd=000072",
      parserStatus: "live-api"
    },
    {
      id: "kucine-moviee-showtimes",
      name: "KU시네마테크 Moviee 시간표 API",
      venueId: "kucine",
      url: "https://kucinema.net/reservation/",
      parserStatus: "live-api"
    },
    {
      id: "sac-timetable",
      name: "서울아트시네마 공식 시간표",
      venueId: "sac",
      url: "https://www.cinematheque.seoul.kr/bbs/content.php?co_id=timetable",
      parserStatus: "live-html"
    },
    {
      id: "kofa-schedule",
      name: "시네마테크KOFA 공식 시간표",
      venueId: "kofa",
      url: "https://www.koreafilm.or.kr/cinematheque/schedule",
      parserStatus: "live-html"
    },
    {
      id: "filmforum-schedule",
      name: "필름포럼 공식 시간표",
      venueId: "filmforum",
      url: "http://www.filmforum.kr/movie/schedule/list.asp",
      parserStatus: "manual-image-heavy"
    },
    {
      id: "filmforum-moviee-showtimes",
      name: "필름포럼 Moviee 시간표 API",
      venueId: "filmforum",
      url: "http://www.filmforum.kr/movie/ticketing.asp",
      parserStatus: "live-api"
    },
    {
      id: "forest-schedule",
      name: "더숲아트시네마 Dtryx 시간표 API",
      venueId: "forest",
      url: "https://www.dtryx.com/cinema/main.do?cgid=81630DDE-489C-4034-A6FB-9AD54E055E5B&BrandCd=indieart&CinemaCd=000065",
      parserStatus: "live-api"
    },
    {
      id: "sangsangmadang-cinema",
      name: "KT&G 상상마당 시네마 Moviee 시간표 API",
      venueId: "sangsangmadang",
      url: "https://www.sangsangmadang.com/movie/list",
      parserStatus: "live-api"
    },
    {
      id: "movieland-cafe24-options",
      name: "무비랜드 Cafe24 회차 옵션",
      venueId: "movieland",
      url: "https://movieland.co/category/now-showing/24/",
      parserStatus: "live-html"
    },
    {
      id: "indiespace-official-posts",
      name: "인디스페이스 공식 상세글 회차",
      venueId: "indiespace",
      url: "https://indiespace.kr/",
      parserStatus: "live-html"
    },
    {
      id: "heyri-dtryx-showtimes",
      name: "헤이리시네마 Dtryx 시간표 API",
      venueId: "heyri",
      url: "https://scinema.org/cinema/main.do?cgid=FE8EF4D2-F22D-4802-A39A-D58F23A29C1E&BrandCd=indieart&CinemaCd=000071",
      parserStatus: "live-api"
    }
  ];
  for (const source of additions) {
    if (byId.has(source.id)) {
      Object.assign(byId.get(source.id), source);
    } else {
      sources.push(source);
    }
  }
  return { ...schedule, sources };
}

function refreshCoverageScope(schedule, checkedAt = new Date().toISOString()) {
  const includedVenueIds = (schedule.venues || []).map((venue) => venue.id);
  return {
    ...schedule,
    coverageScope: {
      reviewedAt: checkedAt,
      policy: "정기 상영시간표를 공개하는 서울 독립·예술 단관/시네마테크를 우선 반영합니다.",
      includedVenueIds,
      reviewedCandidates: [
        {
          id: "picturehouse",
          name: "픽처하우스",
          area: "서울",
          status: "deferred",
          label: "보류",
          reason: "안정적인 공식 미래 시간표와 회차별 직접 예매 경로가 확인될 때까지 보류합니다."
        },
        {
          id: "cgv-arthouse-screens",
          name: "CGV 아트하우스 일부 스크린",
          area: "강변·압구정·여의도·용산·신촌 등",
          status: "excluded",
          label: "제외",
          reason: "멀티플렉스 전체 시간표에서 일부 아트 스크린만 안정적으로 분리하는 별도 정책이 필요합니다."
        },
        {
          id: "venue-rental-spaces",
          name: "대관·비정기 상영 공간",
          area: "서울",
          status: "deferred",
          label: "보류",
          reason: "정기 편성표보다 행사·대관 성격이 강한 공간은 날짜·시간·예매 링크가 반복 확인될 때 후보로 승격합니다."
        },
        {
          id: "silver-classic-theaters",
          name: "실버·고전영화 중심 상영관",
          area: "서울",
          status: "excluded",
          label: "제외",
          reason: "현재 서비스 범위인 독립·예술영화관 상영시간표와 성격이 달라 별도 섹션이 생기기 전까지 제외합니다."
        }
      ]
    }
  };
}

async function fetchSourceSnapshot(source) {
  const startedAt = new Date().toISOString();
  if (source.skipSnapshot) {
    return createSkippedSourceSnapshotResult(source, startedAt);
  }

  try {
    const { response, text } = await fetchText(source.url);
    const hash = createHash("sha256").update(text).digest("hex");
    // Only overwrite the committed snapshot on a successful response; a 4xx/5xx body
    // is an error page, and clobbering the good snapshot with it would poison the parser.
    if (response.ok) {
      await writeFileAtomic(`${snapshotDir}/${safeSnapshotFilename(source.id)}.html`, sanitizeSourceSnapshot(text), "utf8");
    }
    const warning = response.ok ? "" : `source snapshot returned ${response.status} ${response.statusText}`;
    return {
      health: {
        sourceId: source.id,
        url: source.url,
        ok: response.ok,
        blocking: false,
        status: response.status,
        checkedAt: startedAt,
        warning,
        contentHash: hash,
        bytes: Buffer.byteLength(text)
      },
      candidate: sourceCandidate(source, text)
    };
  } catch (error) {
    return {
      health: {
        sourceId: source.id,
        url: source.url,
        ok: false,
        blocking: false,
        status: 0,
        checkedAt: startedAt,
        warning: `source snapshot unavailable: ${error.message}`
      },
      candidate: {
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        error: error.message
      }
    };
  }
}

async function main() {
  await mkdir(snapshotDir, { recursive: true });

  let schedule = ensureLiveSources(ensureVenues(JSON.parse(await readFile(schedulePath, "utf8"))));
  if (collectInBrowser) schedule = prepareBrowserLiveSchedule(schedule);
  const sourceResults = [];
  for (const source of schedule.sources || []) {
    if (liveSourceIds.has(source.id)) continue;
    console.log(`[snapshot] Fetching ${source.id}`);
    sourceResults.push(await fetchSourceSnapshot(source));
  }

  const { liveResults, liveErrors, liveWarnings } = await fetchLiveSessions(fullLiveFetchers, schedule);

  const checkedAt = new Date().toISOString();
  const preservedSourceWarnings = liveWarnings.filter((warning) => warning.preservedExisting);
  const verificationIncomplete = liveErrors.length > 0 || preservedSourceWarnings.length > 0;
  const liveSessions = liveResults.flatMap((result) => result.sessions);
  schedule = mergeLiveSessions(schedule, liveSessions, new Set(liveResults.map((result) => result.sourceId)));
  schedule = pruneUnscheduledSessions(schedule);
  schedule = prunePastScheduleDates(schedule);
  schedule = normalizeScheduleLinks(schedule);
  schedule = await refreshProgramBoardRecords(schedule);
  schedule = enrichProgramRecords(schedule);
  schedule = normalizeFestivalSessions(schedule);
  schedule = refreshCuratedRecords(schedule);
  schedule = refreshMeta(schedule, checkedAt, { verificationIncomplete });
  schedule = refreshCoverageScope(schedule, checkedAt);
  schedule = sanitizeScheduleImageUrls(schedule);
  const sourceById = new Map(schedule.sources.map((source) => [source.id, source]));

  const health = [
    ...(collectInBrowser ? deferredBrowserHealth(checkedAt) : []),
    ...sourceResults.map((result) => result.health),
    ...liveResults.map((result) => {
      const metrics = liveSessionMetrics(result.sessions);
      return {
        sourceId: result.sourceId,
        url: result.url,
        ok: true,
        blocking: true,
        status: 200,
        checkedAt,
        parserStatus: sourceById.get(result.sourceId)?.parserStatus || "live-api",
        liveSessionCount: metrics.sessions,
        liveDateCount: metrics.dates,
        upstreamDateCount: Number.isFinite(result.upstreamDateCount) ? result.upstreamDateCount : null,
        upstreamActiveDateCount: Number.isFinite(result.upstreamActiveDateCount) ? result.upstreamActiveDateCount : null,
        fallbackMerged: Boolean(result.fallbackMerged),
        fallbackReason: result.fallbackReason || "",
        fallbackSessionCount: result.fallbackSessionCount || 0
      };
    }),
    ...liveWarnings.map((warning) => ({
      sourceId: warning.sourceId,
      ok: true,
      blocking: false,
      status: 206,
      checkedAt,
      parserStatus: sourceById.get(warning.sourceId)?.parserStatus || "live-api",
      warning: warning.warning,
      preservedExisting: Boolean(warning.preservedExisting),
      liveSessionCount: warning.existingSessionCount || 0,
      liveDateCount: warning.existingDateCount || 0
    })),
    ...liveErrors.map((error) => ({
      sourceId: error.sourceId,
      ok: false,
      blocking: true,
      status: 0,
      checkedAt,
      parserStatus: sourceById.get(error.sourceId)?.parserStatus || "live-api",
      error: error.error
    }))
  ];
  const healthById = new Map(health.map((entry) => [entry.sourceId, entry]));
  schedule.sources = schedule.sources.map((source) => {
    const entry = healthById.get(source.id);
    return {
      ...source,
      lastCheckedAt: entry?.deferredToBrowser ? null : checkedAt,
      lastOk: entry?.ok ?? null,
      lastStatus: entry?.status ?? null,
      lastError: entry?.error || "",
      lastWarning: entry?.warning || "",
      preservedExisting: Boolean(entry?.preservedExisting),
      liveSessionCount: entry?.liveSessionCount ?? 0,
      liveDateCount: entry?.liveDateCount ?? 0,
      upstreamDateCount: entry?.upstreamDateCount ?? null,
      upstreamActiveDateCount: entry?.upstreamActiveDateCount ?? null,
      lastFallbackUsed: Boolean(entry?.fallbackMerged),
      lastFallbackReason: entry?.fallbackReason || "",
      lastFallbackSessionCount: entry?.fallbackSessionCount ?? 0
    };
  });
  const candidates = sourceResults.map((result) => result.candidate);

  await writeFileAtomic(healthPath, JSON.stringify({ checkedAt, health }, null, 2), "utf8");
  await writeFileAtomic(candidatesPath, JSON.stringify({ checkedAt, candidates }, null, 2), "utf8");
  await writeFileAtomic(livePath, JSON.stringify({ checkedAt, liveResults, liveWarnings, liveErrors }, null, 2), "utf8");
  await writeScheduleArtifacts(schedule);

  console.log(`Checked ${health.length} sources.`);
  console.log(`Merged ${liveSessions.length} live sessions.`);
  if (liveWarnings.length) console.log(`Live adapter warnings: ${liveWarnings.length}`);
  if (liveErrors.length) console.log(`Live adapter errors: ${liveErrors.length}`);
  if (verificationIncomplete) {
    const incompleteSourceIds = [
      ...new Set([
        ...liveErrors.map((error) => error.sourceId),
        ...preservedSourceWarnings.map((warning) => warning.sourceId)
      ])
    ];
    throw new Error(`Full refresh incomplete for: ${incompleteSourceIds.join(", ")}`);
  }
}

async function refreshSeatStatusOnly() {
  let schedule = ensureLiveSources(ensureVenues(JSON.parse(await readFile(schedulePath, "utf8"))));
  const { liveResults, liveErrors, liveWarnings } = await fetchLiveSessions(seatStatusFetchers, schedule);
  const checkedAt = new Date().toISOString();
  const liveSessions = liveResults.flatMap((result) => result.sessions);
  const merged = mergeSeatStatuses(schedule, liveSessions, checkedAt);
  const refreshIssue = seatStatusRefreshIssue({
    expectedSources: seatStatusFetchers.filter((fetcher) => !collectInBrowser || !browserLiveSourceIds.has(liveFetcherSourceIds.get(fetcher))).length,
    successfulSources: liveResults.filter((result) => liveSessionMetrics(result.sessions).sessions > 0).length,
    fetchedSessions: liveSessions.length,
    updatedSessions: merged.updatedSessions
  });
  if (refreshIssue) {
    throw new Error(`Seat-status refresh rejected: ${refreshIssue}`);
  }
  schedule = normalizeScheduleLinks(merged.schedule);
  schedule = normalizeFestivalSessions(schedule);
  schedule = sanitizeScheduleImageUrls(schedule);
  schedule = prunePastScheduleDates(schedule);
  schedule = refreshMeta(schedule, checkedAt, { seatStatusOnly: true });

  const sourceById = new Map(schedule.sources.map((source) => [source.id, source]));
  for (const result of liveResults) {
    const source = sourceById.get(result.sourceId);
    if (!source) continue;
    Object.assign(source, {
      lastSeatCheckedAt: checkedAt,
      lastSeatOk: true,
      lastSeatError: "",
      liveSeatSessionCount: result.sessions.length
    });
  }
  for (const error of liveErrors) {
    const source = sourceById.get(error.sourceId);
    if (!source) continue;
    Object.assign(source, {
      lastSeatCheckedAt: checkedAt,
      lastSeatOk: false,
      lastSeatError: error.error,
      liveSeatSessionCount: 0
    });
  }

  await writeScheduleArtifacts(schedule);

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "seat-status",
        checkedAt,
        fetchedSessions: liveSessions.length,
        updatedSessions: merged.updatedSessions,
        warnings: liveWarnings,
        errors: liveErrors
      },
      null,
      2
    )
  );
}

export {
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
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (seatStatusMode) {
    await refreshSeatStatusOnly();
  } else {
    await main();
  }
}
