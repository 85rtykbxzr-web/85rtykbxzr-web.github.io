import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { isPastKstSession } from "../src/session-time.mjs";
import { writeFileAtomic } from "./write-file-atomic.mjs";

const schedulePath = fileURLToPath(new URL("../data/schedule.json", import.meta.url));
const outputPath = fileURLToPath(new URL("../data/community-trends.json", import.meta.url));
const cachePath = fileURLToPath(new URL("../data/community-trends-cache.json", import.meta.url));
const posterAssetDirectory = fileURLToPath(new URL("../assets/recommendation-posters/", import.meta.url));
const posterAssetPublicBase = "/assets/recommendation-posters";
const maximumPosterDownloadBytes = 8 * 1024 * 1024;
const galleryId = process.env.COMMUNITY_TREND_GALLERY_ID || "nouvellevague";
const seedLookbackDays = boundedInteger(process.env.COMMUNITY_TREND_LOOKBACK_DAYS || process.env.COMMUNITY_TREND_SEED_DAYS, 3, 1, 14);
const listPageCap = boundedInteger(
  process.env.COMMUNITY_TREND_MAX_PAGES || process.env.COMMUNITY_TREND_PAGE_CAP || process.env.COMMUNITY_TREND_PAGES,
  180,
  1,
  300
);
const minimumListPages = boundedInteger(process.env.COMMUNITY_TREND_MIN_PAGES, 6, 1, Math.min(listPageCap, 30));
const postFetchLimit = boundedInteger(process.env.COMMUNITY_TREND_POST_FETCH_LIMIT, 80, 0, 160);
const commentFetchLimit = boundedInteger(process.env.COMMUNITY_TREND_COMMENT_FETCH_LIMIT, Math.min(postFetchLimit, 80), 0, 160);
const commentItemLimit = boundedInteger(process.env.COMMUNITY_TREND_COMMENT_ITEM_LIMIT, 40, 1, 120);
const communityFetchTimeoutMs = boundedInteger(process.env.COMMUNITY_TREND_FETCH_TIMEOUT_MS, 15000, 1000, 60000);
const recencyDecay = boundedNumber(process.env.COMMUNITY_TREND_RECENCY_DECAY, 0.72, 0.2, 1);
const forceBackfill = /^(1|true|yes|backfill|seed)$/i.test(process.env.COMMUNITY_TREND_FORCE_BACKFILL || "");
const testerOnly = /^(1|true|yes|tester)$/i.test(process.env.COMMUNITY_TREND_TESTER_ONLY || process.env.COMMUNITY_TREND_STAGE || "");
const candidateCutoffMs = Date.now();
const todayKey = kstDateString();
const rollingDays = boundedInteger(process.env.COMMUNITY_TREND_SCORE_DAYS || process.env.COMMUNITY_TREND_ROLLING_DAYS, 3, 1, 14);
const windowStart = addDays(todayKey, -(rollingDays - 1));
const horizonEnd = addDays(todayKey, 14);
const listDateBackstop = addDays(todayKey, -Math.max(30, seedLookbackDays * 3));

const positiveTermGroups = [
  {
    label: "strong",
    weight: 6,
    terms: [
      "ㅆㅅㅌㅊ",
      "씹상타",
      "개명작",
      "갓작",
      "걸작",
      "인생작",
      "올해의",
      "최고",
      "미쳤",
      "미친 영화",
      "미친영화",
      "개쩜",
      "개쩐다",
      "개쩌",
      "쩐다",
      "압도",
      "강추",
      "꼭 봐",
      "꼭봐",
      "극장에서 봐야"
    ]
  },
  {
    label: "clear",
    weight: 4,
    terms: [
      "ㅅㅌㅊ",
      "상타치",
      "개좋",
      "존좋",
      "존잼",
      "꿀잼",
      "개재밌",
      "재밌",
      "재밋",
      "재미있",
      "재미남",
      "명작",
      "수작",
      "추천",
      "극장용",
      "극장서",
      "극장가서",
      "훌륭",
      "잘 만들",
      "잘만들",
      "감탄",
      "여운",
      "감동",
      "만족",
      "재관람"
    ]
  },
  {
    label: "soft",
    weight: 2,
    terms: [
      "좋았다",
      "좋았음",
      "좋더라",
      "좋음",
      "좋네",
      "좋긴",
      "좋고",
      "볼만",
      "괜찮",
      "인상적",
      "취저",
      "흥미롭",
      "재밋네",
      "나쁘지 않",
      "봐라",
      "볼 가치",
      "볼가치"
    ]
  }
];

const negativeTermGroups = [
  {
    label: "strong-negative",
    weight: 7,
    terms: [
      "ㅆㅎㅌㅊ",
      "씹하타",
      "개구림",
      "개구리",
      "개노잼",
      "노잼",
      "최악",
      "망작",
      "비추",
      "걸러",
      "돈아까",
      "시간아까",
      "보다 나옴",
      "보다나옴",
      "나가고 싶",
      "나가고싶"
    ]
  },
  {
    label: "clear-negative",
    weight: 4,
    terms: [
      "ㅎㅌㅊ",
      "하타치",
      "구림",
      "구리",
      "별로",
      "별루",
      "지루",
      "실망",
      "아쉽",
      "아까움",
      "안 좋",
      "안좋",
      "재미없",
      "재미 없",
      "불호",
      "후회"
    ]
  },
  {
    label: "soft-negative",
    weight: 2,
    terms: [
      "ㄴㄴ",
      "노노",
      "굳이",
      "애매",
      "평범",
      "그닥",
      "그다지",
      "별말",
      "미묘",
      "그저"
    ]
  }
];

const questionPatterns = [
  /[?？]/,
  /어떰|어때|어떤데|어떤가|어떠냐/,
  /볼\s*만\s*한(?:가|지|가요|지요)|볼\s*만\s*하(?:냐|니|나|노|냐고|ㄴ가|ㄴ지|ㅁ\?)/,
  /볼망함|볼까|볼지|보러\s*갈|보러갈|봐도\s*(?:됨|되|괜찮)/,
  /괜찮(?:냐|음\?|을까|나|은가|은지)|좋(?:냐|음\?|을까|나|은가|은지)|재밌(?:냐|음\?|을까|나|는가|는지)|재밋(?:냐|음\?|을까|나|는가|는지)/,
  /추천\s*좀|추천좀|본\s*사람|본사람|본\s*놈|본놈/,
  /하냐|하니|하노|해야\s*함|해야함/
];

const reviewQuestionPatterns = [
  /볼\s*만|어떰|어때|어떤데|어떤가|어떠냐/,
  /재밌|재밋|재미|좋(?:냐|음|은가|은지|을까|나)|괜찮/,
  /추천|평\s*어|평이|후기|명작|걸작|수작|꿀잼|존잼|노잼|별로|비추/,
  /잘\s*만듦|잘\s*만듬|잘만듦|잘만듬/
];

const knownTrailerUrls = new Map([
  ["여름의 카메라", "https://www.youtube.com/watch?v=pthUnBEF6og"],
  ["사무라이 타임슬리퍼", "https://www.youtube.com/watch?v=QKxXrJX3g-U"],
  ["센티멘탈 밸류", "https://www.youtube.com/watch?v=BI7FBHUENxM"],
  ["토이 스토리 5", "https://www.youtube.com/watch?v=xZmN1QPwE9s"]
].map(([title, url]) => [normalizeTitle(title), url]));

const knownPosterPages = new Map([
  ["유레카", "Eureka_(2023_film)"],
  ["유레카(2D)", "Eureka_(2023_film)"],
  ["세일러복과 기관총", "Sailor_Suit_and_Machine_Gun_(film)"]
].map(([title, page]) => [normalizeTitle(title), page]));

const knownPosterUrls = new Map([
  ["센트럴파크", "https://a.ltrbxd.com/resized/film-poster/5/7/6/7/1/57671-central-park-0-600-0-900-crop.jpg?v=1822695d44"]
].map(([title, url]) => [normalizeTitle(title), url]));

const posterPageCache = new Map();
const posterHealthCache = new Map();

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  const integer = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(min, Math.min(integer, max));
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(number, max));
}

function kstDateString(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function parseDate(dateString) {
  return new Date(`${dateString}T00:00:00+09:00`);
}

function addDays(dateString, days) {
  const date = parseDate(dateString);
  date.setDate(date.getDate() + days);
  return kstDateString(date);
}

function daysBetween(startDate, endDate) {
  return Math.round((parseDate(endDate).getTime() - parseDate(startDate).getTime()) / 86400000);
}

function dateRange(startDate, endDate) {
  const range = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    range.push(date);
  }
  return range;
}

function normalizeTitle(value) {
  return String(value || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "")
    .toLowerCase();
}

function cleanText(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function compactTitle(value) {
  return String(value || "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function recommendationTitle(value) {
  const fallback = compactTitle(value);
  let title = fallback;
  let previous = "";
  while (title && title !== previous) {
    previous = title;
    title = title
      .replace(/\s*\((?:2D|3D|4D|IMAX|SCREENX|자막|더빙|한글자막|영문자막)\)\s*$/i, "")
      .trim();
  }
  return title || fallback;
}

function countTerm(text, term) {
  const source = String(text || "").toLowerCase();
  const needle = String(term || "").toLowerCase();
  if (!needle) return 0;
  let count = 0;
  let index = source.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = source.indexOf(needle, index + needle.length);
  }
  return count;
}

function countWeightedTerms(text, groups) {
  const hits = [];
  let score = 0;
  for (const group of groups) {
    for (const term of group.terms) {
      const count = countTerm(text, term);
      if (!count) continue;
      const weighted = count * group.weight;
      score += weighted;
      hits.push({
        term,
        count,
        weight: group.weight,
        score: weighted,
        label: group.label
      });
    }
  }
  hits.sort((a, b) => b.score - a.score || b.count - a.count || a.term.localeCompare(b.term, "ko"));
  return { score, hits };
}

function isQuestionLike(text) {
  const source = String(text || "").toLowerCase();
  return questionPatterns.some((pattern) => pattern.test(source));
}

function isReviewQuestion(text) {
  const source = String(text || "").toLowerCase();
  return isQuestionLike(source) && reviewQuestionPatterns.some((pattern) => pattern.test(source));
}

function reviewSignal(post) {
  const titleBodyText = `${post.title || ""} ${post.body || ""}`.trim();
  const comments = Array.isArray(post.comments) ? post.comments : [];
  const questionLike = isQuestionLike(titleBodyText);
  const reviewQuestion = isReviewQuestion(titleBodyText);
  const titleBodyPositive = questionLike ? { score: 0, hits: [] } : countWeightedTerms(titleBodyText, positiveTermGroups);
  let commentPositiveScore = 0;
  const commentPositiveHits = [];

  for (const comment of comments) {
    const memo = comment.memo || "";
    if (!memo) continue;
    const allowCommentPositive = !questionLike || reviewQuestion;
    const commentPositive = allowCommentPositive && !isQuestionLike(memo) ? countWeightedTerms(memo, positiveTermGroups) : { score: 0, hits: [] };
    commentPositiveScore += commentPositive.score;
    commentPositiveHits.push(...commentPositive.hits);
  }

  const positiveHits = [...titleBodyPositive.hits, ...commentPositiveHits]
    .sort((a, b) => b.score - a.score || b.count - a.count || a.term.localeCompare(b.term, "ko"))
    .slice(0, 8);
  const positive = titleBodyPositive.score + commentPositiveScore;
  const negative = 0;
  const rawNet = positive;

  return {
    positive,
    negative,
    positiveHits,
    negativeHits: [],
    questionLike,
    reviewQuestion,
    commentCount: comments.length,
    commentPositive: commentPositiveScore,
    commentNegative: 0,
    rawNet,
    net: rawNet > 0 ? rawNet : 0
  };
}

function parseCommunityDate(rawDate, rawTitle = "") {
  const source = String(rawTitle || rawDate || "").trim();
  let match = source.match(/(20\d{2})[-.](\d{1,2})[-.](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;

  match = String(rawDate || "").match(/\b(\d{1,2})[.](\d{1,2})\b/);
  if (match) {
    const year = todayKey.slice(0, 4);
    let parsed = `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
    if (parsed > todayKey) parsed = `${Number(year) - 1}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
    return parsed;
  }

  if (/\b\d{1,2}:\d{2}\b/.test(String(rawDate || ""))) return todayKey;
  return "";
}

function isWithinWindow(date) {
  return Boolean(date && date >= windowStart && date <= todayKey);
}

function isWithinListWindow(date, listWindowStart) {
  return Boolean(date && date >= listWindowStart && date <= todayKey);
}

function resolveUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return "";
  }
}

function extractDateCell(row) {
  const dateCell = row.match(/<td[^>]*class=["'][^"']*gall_date[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
  if (!dateCell) return { text: "", title: "" };
  const cell = dateCell[0];
  return {
    text: cleanText(dateCell[1]),
    title: cell.match(/\btitle=["']([^"']+)["']/i)?.[1] || ""
  };
}

function isNoticePostMarkup(markup) {
  const source = String(markup || "");
  if (/\bdata-type=["']icon_notice["']/i.test(source)) return true;
  if (/\bclass=["'][^"']*icon_notice[^"']*["']/i.test(source)) return true;
  if (/<td[^>]*class=["'][^"']*gall_subject[^"']*["'][^>]*>\s*<b>\s*공지\s*<\/b>\s*<\/td>/i.test(source)) return true;
  return false;
}

function extractDesktopPosts(html, baseUrl) {
  const posts = [];
  for (const match of html.matchAll(/<tr[^>]*class=["'][^"']*(?:ub-content|us-post)[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowMarkup = match[0];
    if (isNoticePostMarkup(rowMarkup)) continue;
    const row = match[1];
    const link = row.match(/<a[^>]+href=["']([^"']*(?:board\/view|\/view)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const title = compactTitle(cleanText(link[2]));
    const url = resolveUrl(link[1], baseUrl);
    const date = extractDateCell(row);
    const dateKey = parseCommunityDate(date.text, date.title);
    if (title.length < 2 || title.length > 120 || !url) continue;
    posts.push({ title, url, date: dateKey, source: "desktop-list" });
  }
  return posts;
}

function extractFallbackPosts(html, baseUrl) {
  const posts = [];
  for (const match of html.matchAll(/<a[^>]+href=["']([^"']*(?:board\/view|\/view)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (isNoticePostMarkup(match[0])) continue;
    const title = compactTitle(cleanText(match[2]));
    const url = resolveUrl(match[1], baseUrl);
    if (title.length < 2 || title.length > 120 || !url) continue;
    posts.push({ title, url, date: "", source: "fallback-list" });
  }
  return posts;
}

function extractPosts(html, baseUrl) {
  const desktopPosts = extractDesktopPosts(html, baseUrl);
  const posts = desktopPosts.length ? desktopPosts : extractFallbackPosts(html, baseUrl);
  const byUrl = new Map();
  for (const post of posts) {
    if (!byUrl.has(post.url)) byUrl.set(post.url, post);
  }
  return [...byUrl.values()];
}

function extractPostBody(html) {
  const patterns = [
    /<div[^>]*class=["'][^"']*write_div[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*writing_view_box[^"']*["'][^>]*>([\s\S]*?)<div[^>]*class=["'][^"']*comment/i,
    /<div[^>]*class=["'][^"']*thum-txtin[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return cleanText(match[1]);
  }
  return "";
}

function extractHiddenValue(html, name) {
  const escapedName = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<input[^>]+name=["']${escapedName}["'][^>]+value=["']([^"']*)["']`, "i"),
    new RegExp(`<input[^>]+value=["']([^"']*)["'][^>]+name=["']${escapedName}["']`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return cleanText(match[1]);
  }
  return "";
}

function articleNumberFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("no") || parsed.pathname.match(/\/(\d+)(?:$|[/?#])/)?.[1] || "";
  } catch {
    return "";
  }
}

function parseCommentPayload(payload) {
  const comments = [];
  const items = Array.isArray(payload?.comments) ? payload.comments : [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const deleted = String(item.del_yn || "N").toUpperCase() === "Y";
    const name = cleanText(item.name || "");
    const memo = cleanText(item.memo || "");
    if (deleted || !memo || name === "댓글돌이") continue;
    comments.push({
      no: String(item.no || ""),
      name,
      memo,
      date: cleanText(item.reg_date || "")
    });
    if (comments.length >= commentItemLimit) break;
  }
  return comments;
}

async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(communityFetchTimeoutMs),
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; SeoulCinemaSchedule/0.1; +https://seoulcinemaschedule.com)",
      accept: "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return response.text();
}

async function fetchPostComments(post, html) {
  const articleNo = articleNumberFromUrl(post.url);
  const securityToken = extractHiddenValue(html, "e_s_n_o");
  if (!articleNo || !securityToken) {
    return { comments: [], skipped: true, reason: "missing comment token" };
  }

  const body = new URLSearchParams({
    id: galleryId,
    no: articleNo,
    cmt_id: galleryId,
    cmt_no: articleNo,
    focus_cno: "",
    focus_pno: "",
    e_s_n_o: securityToken,
    comment_page: "1",
    sort: "D",
    prevCnt: "",
    board_type: "",
    _GALLTYPE_: extractHiddenValue(html, "_GALLTYPE_") || "G",
    secret_article_key: extractHiddenValue(html, "secret_article_key")
  });

  const response = await fetch("https://gall.dcinside.com/board/comment/", {
    method: "POST",
    signal: AbortSignal.timeout(communityFetchTimeoutMs),
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; SeoulCinemaSchedule/0.1; +https://seoulcinemaschedule.com)",
      accept: "application/json,text/javascript,*/*;q=0.1",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      referer: post.url,
      origin: "https://gall.dcinside.com"
    },
    body
  });
  if (!response.ok) throw new Error(`comment ${post.url} ${response.status}`);
  const payload = await response.json();
  return { comments: parseCommentPayload(payload), skipped: false, reason: "" };
}

async function fetchWikipediaPoster(page) {
  if (!page) return "";
  if (posterPageCache.has(page)) return posterPageCache.get(page);

  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page)}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; SeoulCinemaSchedule/0.1; +https://seoulcinemaschedule.com)",
      accept: "application/json"
    }
  });
  if (!response.ok) throw new Error(`${url} ${response.status}`);

  const data = await response.json();
  const posterUrl = data.thumbnail?.source || data.originalimage?.source || "";
  const safePosterUrl = /^https:\/\/upload\.wikimedia\.org\//i.test(posterUrl) ? posterUrl : "";
  posterPageCache.set(page, safePosterUrl);
  return safePosterUrl;
}

function posterPriority(url) {
  const raw = String(url || "");
  if (!raw) return 0;

  let parsed = null;
  try {
    parsed = new URL(raw);
  } catch {
    return 0;
  }

  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  if (host === "img.dtryx.com") return 100;
  if (host === "cinecube.co.kr") return 90;
  if (host === "movieland.co") return 85;
  if (host === "upload.wikimedia.org") return 82;
  if (host === "koreafilm.or.kr") return 80;
  if (host === "cinematheque.seoul.kr") return 78;
  if (host === "arthousemomo.co.kr") return 76;
  if (/daumcdn\.net|kakaocdn\.net$/i.test(host)) return 70;
  if (host === "moviee.co.kr" && /\/DisplayImage\b/i.test(parsed.pathname)) return 0;
  return 50;
}

function sortedPosterUrls(urls) {
  return [...new Set(Array.from(urls || []).filter((url) => /^https?:\/\//i.test(String(url || ""))))]
    .filter((url) => posterPriority(url) > 0)
    .sort((a, b) => posterPriority(b) - posterPriority(a) || a.localeCompare(b));
}

async function isReachableImageUrl(url) {
  if (!url) return false;
  if (posterHealthCache.has(url)) return posterHealthCache.get(url);

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; SeoulCinemaSchedule/0.1; +https://seoulcinemaschedule.com)",
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      }
    });
    const ok = response.ok && /^image\//i.test(response.headers.get("content-type") || "");
    if (response.body?.cancel) await response.body.cancel().catch(() => {});
    posterHealthCache.set(url, ok);
    return ok;
  } catch {
    posterHealthCache.set(url, false);
    return false;
  }
}

async function firstReachablePosterUrl(urls) {
  for (const url of sortedPosterUrls(urls)) {
    if (await isReachableImageUrl(url)) return url;
  }
  return "";
}

async function collectCommunityPosts(candidates, scanPlan) {
  const { listWindowStart, listLookbackDays, scanMode } = scanPlan;
  const posts = [];
  const errors = [];
  let scannedPageCount = 0;
  let listedPostCount = 0;
  let detailedPostCount = 0;
  let commentFetchCount = 0;
  let commentCount = 0;
  let commentFetchErrorCount = 0;
  let reachedLookbackStart = false;
  let oldestScannedDate = "";
  let newestScannedDate = "";
  let undatedPageStreak = 0;
  let loadFailureStreak = 0;

  for (let page = 1; page <= listPageCap; page += 1) {
    const urls = [
      `https://gall.dcinside.com/mgallery/board/lists/?id=${encodeURIComponent(galleryId)}&page=${page}`,
      `https://m.dcinside.com/board/${encodeURIComponent(galleryId)}?page=${page}`
    ];
    let pageLoaded = false;
    let pagePosts = [];
    let stopAfterPage = false;
    for (const url of urls) {
      if (pageLoaded) break;
      try {
        const html = await fetchText(url);
        pagePosts = extractPosts(html, url);
        posts.push(...pagePosts);
        pageLoaded = true;
      } catch (error) {
        errors.push(error.message);
      }
    }

    if (pageLoaded) {
      loadFailureStreak = 0;
      scannedPageCount = page;
      listedPostCount += pagePosts.length;
      const pageDates = pagePosts
        .map((post) => post.date)
        .filter((date) => date && date >= listDateBackstop && date <= todayKey)
        .sort();
      if (pageDates.length) {
        undatedPageStreak = 0;
        const pageOldest = pageDates[0];
        const pageNewest = pageDates[pageDates.length - 1];
        if (!oldestScannedDate || pageOldest < oldestScannedDate) oldestScannedDate = pageOldest;
        if (!newestScannedDate || pageNewest > newestScannedDate) newestScannedDate = pageNewest;
        if (page >= minimumListPages && pageOldest < listWindowStart) {
          reachedLookbackStart = true;
          stopAfterPage = true;
        }
      } else {
        undatedPageStreak += 1;
        if (page >= Math.max(minimumListPages, 12) && undatedPageStreak >= 3) {
          errors.push(`Stopped community list scan after ${page} pages because list dates could not be read.`);
          stopAfterPage = true;
        }
      }
    } else {
      loadFailureStreak += 1;
      if (page >= Math.max(minimumListPages, 12) && loadFailureStreak >= 3) {
        errors.push(`Stopped community list scan after ${page} pages because list pages could not be loaded.`);
        stopAfterPage = true;
      }
    }

    if (stopAfterPage) break;
    await new Promise((resolve) => setTimeout(resolve, 650));
  }

  if (!reachedLookbackStart && oldestScannedDate && oldestScannedDate >= listWindowStart) {
    errors.push(`Community list scan reached ${scannedPageCount} pages but only got back to ${oldestScannedDate}; target was ${listWindowStart}.`);
  }

  const uniquePosts = [...new Map(posts.map((post) => [post.url, post])).values()].filter((post) => !post.date || isWithinListWindow(post.date, listWindowStart));
  const matchingPosts = uniquePosts.filter((post) => candidateMatches(post.title, candidates).length).slice(0, postFetchLimit);

  for (const post of matchingPosts) {
    try {
      const html = await fetchText(post.url);
      post.body = extractPostBody(html);
      if (!post.date) {
        const dateText = cleanText(html.match(/<span[^>]*class=["'][^"']*date[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
        post.date = parseCommunityDate(dateText);
      }
      post.comments = [];
      if (commentFetchCount < commentFetchLimit) {
        try {
          const result = await fetchPostComments(post, html);
          post.comments = result.comments;
          if (!result.skipped) commentFetchCount += 1;
          commentCount += post.comments.length;
        } catch (error) {
          commentFetchErrorCount += 1;
          errors.push(error.message);
        }
      }
      detailedPostCount += 1;
    } catch (error) {
      errors.push(error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  return {
    posts: uniquePosts.filter((post) => isWithinListWindow(post.date, listWindowStart)),
    errors,
    scannedPageCount,
    listedPostCount,
    detailedPostCount,
    commentFetchCount,
    commentCount,
    commentFetchErrorCount,
    reachedLookbackStart,
    oldestScannedDate,
    newestScannedDate,
    listLookbackDays,
    listWindowStart,
    scanMode,
    listPageCap,
    minimumListPages
  };
}

function buildCandidates(schedule) {
  const venuesById = new Map((schedule.venues || []).map((venue) => [venue.id, venue]));
  const grouped = new Map();
  for (const session of schedule.sessions || []) {
    if (!session.date || session.date < todayKey || session.date > horizonEnd || isPastKstSession(session, candidateCutoffMs)) continue;
    const title = compactTitle(session.title);
    const normalized = normalizeTitle(title);
    if (!title || normalized.length < 2) continue;
    if (!grouped.has(normalized)) {
      grouped.set(normalized, {
        title,
        normalized,
        sessions: [],
        venueIds: new Set(),
        posterUrls: new Set(),
        url: ""
      });
    }
    const candidate = grouped.get(normalized);
    candidate.sessions.push(session);
    if (session.venueId) candidate.venueIds.add(session.venueId);
    if (session.posterUrl) candidate.posterUrls.add(session.posterUrl);
    if (!candidate.url && (session.bookingUrl || session.detailUrl)) candidate.url = session.bookingUrl || session.detailUrl;
  }

  return [...grouped.values()].map((candidate) => {
    candidate.sessions.sort((a, b) => `${a.date} ${a.timeSort || a.time}`.localeCompare(`${b.date} ${b.timeSort || b.time}`, "ko"));
    const nextSession = candidate.sessions[0] || {};
    return {
      title: candidate.title,
      normalized: candidate.normalized,
      posterUrl: sortedPosterUrls(candidate.posterUrls)[0] || "",
      posterUrls: sortedPosterUrls(candidate.posterUrls),
      url: candidate.url,
      sessionCount: candidate.sessions.length,
      venueIds: [...candidate.venueIds],
      venueNames: [...candidate.venueIds].map((id) => venuesById.get(id)?.name).filter(Boolean),
      nextDate: nextSession.date || "",
      nextTime: nextSession.time || ""
    };
  });
}

function candidateMatches(text, candidates) {
  const normalizedText = normalizeTitle(text);
  if (!normalizedText) return [];
  return candidates.filter((candidate) => {
    if (candidate.normalized.length < 2) return false;
    return normalizedText.includes(candidate.normalized) || (normalizedText.length >= 4 && candidate.normalized.includes(normalizedText));
  });
}

function commentsForCandidate(post, candidate, matchCount) {
  const comments = Array.isArray(post.comments) ? post.comments : [];
  if (matchCount <= 1) return comments;
  return comments.filter((comment) => normalizeTitle(comment.memo).includes(candidate.normalized));
}

async function readJsonOrEmpty(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

function communityScanPlan(existingCache) {
  const seedStart = addDays(todayKey, -(seedLookbackDays - 1));
  const seedDates = dateRange(seedStart, todayKey);
  const cachedCoverageDates = new Set((existingCache.scanCoverage?.dates || []).filter(isWithinWindow));
  const cachedSignalDates = new Set(Object.keys(existingCache.days || {}).filter(isWithinWindow));
  const knownDates = new Set([...cachedCoverageDates, ...cachedSignalDates]);
  const missingPastDates = forceBackfill ? seedDates.filter((date) => date < todayKey) : seedDates.filter((date) => date < todayKey && !knownDates.has(date));
  const listWindowStart = missingPastDates.length ? missingPastDates[0] : todayKey;

  return {
    scanMode: listWindowStart === todayKey ? "daily" : "backfill",
    listWindowStart,
    listLookbackDays: daysBetween(listWindowStart, todayKey) + 1,
    seedLookbackDays,
    seedStart
  };
}

function buildDailySignals(candidates, posts) {
  const days = {};
  for (const post of posts) {
    if (!isWithinWindow(post.date)) continue;
    days[post.date] ||= {};
    const text = `${post.title} ${post.body || ""}`;
    const matches = candidateMatches(text, candidates);
    if (!matches.length) continue;

    for (const candidate of matches) {
      const signal = reviewSignal({
        ...post,
        comments: commentsForCandidate(post, candidate, matches.length)
      });
      if (!signal.net) continue;

      days[post.date][candidate.normalized] ||= {
        title: candidate.title,
        positiveSignal: 0,
        mentionCount: 0,
        evidence: []
      };
      const entry = days[post.date][candidate.normalized];
      entry.positiveSignal += signal.net;
      entry.mentionCount += 1;
      if (entry.evidence.length < 3) {
        entry.evidence.push({
          title: post.title,
          url: post.url,
          date: post.date,
          positive: signal.net,
          rawPositive: signal.positive,
          negative: signal.negative,
          positiveHits: signal.positiveHits,
          negativeHits: signal.negativeHits,
          questionLike: signal.questionLike,
          reviewQuestion: signal.reviewQuestion,
          commentCount: signal.commentCount,
          commentPositive: signal.commentPositive,
          commentNegative: signal.commentNegative
        });
      }
    }
  }
  return days;
}

function cleanDailySignals(signals) {
  const cleaned = {};
  for (const [normalized, signal] of Object.entries(signals || {})) {
    cleaned[normalized] = {
      title: signal.title || "",
      positiveSignal: Number(signal.positiveSignal || 0),
      mentionCount: Number(signal.mentionCount || 0),
      evidence: (signal.evidence || []).slice(0, 3).map((item) => ({
        title: item.title || "",
        url: item.url || "",
        date: item.date || "",
        positive: Number(item.positive || 0),
        rawPositive: Number(item.rawPositive || item.positive || 0),
        negative: Number(item.negative || 0),
        positiveHits: item.positiveHits || [],
        negativeHits: item.negativeHits || [],
        questionLike: Boolean(item.questionLike),
        reviewQuestion: Boolean(item.reviewQuestion),
        commentCount: Number(item.commentCount || 0),
        commentPositive: Number(item.commentPositive || 0),
        commentNegative: Number(item.commentNegative || 0)
      }))
    };
  }
  return cleaned;
}

function mergeRollingCache(existing, dailySignals, community) {
  const days = { ...(existing.days || {}) };
  const refreshedDates = community.reachedLookbackStart && community.listWindowStart
    ? dateRange(community.listWindowStart, todayKey).filter(isWithinWindow)
    : Object.keys(dailySignals);
  for (const date of refreshedDates) {
    days[date] = dailySignals[date] || {};
  }

  for (const date of Object.keys(days)) {
    if (!isWithinWindow(date)) delete days[date];
    else days[date] = cleanDailySignals(days[date]);
  }

  const coverageDates = new Set((existing.scanCoverage?.dates || []).filter(isWithinWindow));
  if (community.reachedLookbackStart && community.listWindowStart) {
    for (const date of dateRange(community.listWindowStart, todayKey)) {
      if (isWithinWindow(date)) coverageDates.add(date);
    }
  }

  return {
    version: 2,
    galleryId,
    rollingDays,
    windowStart,
    windowEnd: todayKey,
    scoreModel: {
      windowDays: rollingDays,
      recencyDecay
    },
    scanCoverage: {
      dates: [...coverageDates].sort(),
      lastMode: community.scanMode || "",
      lastWindowStart: community.listWindowStart || "",
      lastWindowEnd: todayKey,
      lastReachedLookbackStart: Boolean(community.reachedLookbackStart)
    },
    updatedAt: new Date().toISOString(),
    days
  };
}

function roundMetric(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function roundWeight(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function recencyWeight(date) {
  const ageDays = Math.max(0, daysBetween(date, todayKey));
  return roundWeight(Math.pow(recencyDecay, ageDays));
}

function aggregateSignals(candidates, cache) {
  const byCandidate = new Map(candidates.map((candidate) => [
    candidate.normalized,
    {
      ...candidate,
      positiveSignal: 0,
      rawPositiveSignal: 0,
      mentionCount: 0,
      rawMentionCount: 0,
      evidence: []
    }
  ]));

  for (const [date, signals] of Object.entries(cache.days || {})) {
    const weight = recencyWeight(date);
    for (const [normalized, signal] of Object.entries(signals || {})) {
      const aggregate = byCandidate.get(normalized);
      if (!aggregate) continue;
      const positive = Number(signal.positiveSignal || 0);
      const mentions = Number(signal.mentionCount || 0);
      aggregate.rawPositiveSignal += positive;
      aggregate.rawMentionCount += mentions;
      aggregate.positiveSignal += positive * weight;
      aggregate.mentionCount += mentions * weight;
      aggregate.evidence.push(...(signal.evidence || []).map((item) => ({
        ...item,
        date: item.date || date,
        dayWeight: weight
      })));
    }
  }

  return [...byCandidate.values()]
    .map((candidate) => ({
      ...candidate,
      positiveSignal: roundMetric(candidate.positiveSignal),
      mentionCount: roundMetric(candidate.mentionCount),
      rawPositiveSignal: roundMetric(candidate.rawPositiveSignal),
      rawMentionCount: Number(candidate.rawMentionCount || 0),
      score: roundMetric(candidate.positiveSignal * 12 + candidate.mentionCount * 5 + Math.min(candidate.sessionCount, 8)),
      evidence: candidate.evidence.slice(0, 5)
    }))
    .filter((candidate) => candidate.positiveSignal > 0 && candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.positiveSignal - a.positiveSignal || b.mentionCount - a.mentionCount || b.sessionCount - a.sessionCount || a.title.localeCompare(b.title, "ko"));
}

function backfillCandidates(scored, candidates) {
  const scoredKeys = new Set(scored.map((candidate) => candidate.normalized));
  return candidates
    .filter((candidate) => !scoredKeys.has(candidate.normalized))
    .map((candidate) => ({
      ...candidate,
      score: 0,
      positiveSignal: 0,
      mentionCount: 0,
      rawPositiveSignal: 0,
      rawMentionCount: 0,
      evidence: [],
      scheduleBackfill: true
    }))
    .sort((a, b) => b.sessionCount - a.sessionCount || a.nextDate.localeCompare(b.nextDate) || a.title.localeCompare(b.title, "ko"));
}

async function outputItems(scored, candidates) {
  const candidatePool = [...scored, ...backfillCandidates(scored, candidates)];
  const items = [];
  const skippedPosterlessTitles = [];
  for (const candidate of candidatePool) {
    if (items.length >= 4) break;
    const title = recommendationTitle(candidate.title);
    const titleKey = normalizeTitle(title);
    const knownPosterUrl = knownPosterUrls.get(candidate.normalized) || knownPosterUrls.get(titleKey) || "";
    const fallbackPosterPage = knownPosterPages.get(candidate.normalized) || knownPosterPages.get(titleKey) || "";
    const fallbackPosterUrl = fallbackPosterPage ? await fetchWikipediaPoster(fallbackPosterPage).catch(() => "") : "";
    const posterCandidates = [knownPosterUrl, fallbackPosterUrl, ...(candidate.posterUrls || []), candidate.posterUrl].filter(Boolean);
    const posterUrl = await firstReachablePosterUrl(posterCandidates);
    if (!posterUrl) {
      skippedPosterlessTitles.push(title);
      continue;
    }
    items.push({
      rank: items.length + 1,
      title,
      posterUrl,
      localPosterUrl: posterUrl,
      posterSource: posterUrl === knownPosterUrl
        ? "known-poster"
        : posterUrl === fallbackPosterUrl
          ? "wikipedia-pageimage"
          : "verified-official",
      trailerUrl: knownTrailerUrls.get(candidate.normalized) || knownTrailerUrls.get(titleKey) || "",
      url: candidate.url,
      score: candidate.score,
      signal: candidate.positiveSignal,
      positiveSignal: candidate.positiveSignal,
      mentionCount: candidate.mentionCount,
      rawPositiveSignal: candidate.rawPositiveSignal,
      rawMentionCount: candidate.rawMentionCount,
      scheduleBackfill: Boolean(candidate.scheduleBackfill),
      venueIds: candidate.venueIds,
      venueNames: candidate.venueNames,
      nextDate: candidate.nextDate,
      nextTime: candidate.nextTime,
      evidence: candidate.evidence
    });
  }
  if (skippedPosterlessTitles.length) {
    console.warn(`[community-trends] skipped posterless weekly pick candidate(s): ${skippedPosterlessTitles.join(", ")}`);
  }
  if (items.length < 4) {
    throw new Error(`Only ${items.length} weekly pick(s) had reachable image posters`);
  }
  return items;
}

function optimizedRemotePosterUrl(value) {
  return String(value || "").replace(/\.small\.jpg(?=$|[?#])/i, ".thumb.jpg");
}

async function fetchPosterBuffer(sourceUrl) {
  const candidates = [...new Set([optimizedRemotePosterUrl(sourceUrl), sourceUrl].filter(Boolean))];
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; SeoulCinemaSchedule/1.0)" },
        signal: AbortSignal.timeout(communityFetchTimeoutMs)
      });
      if (!response.ok || !String(response.headers.get("content-type") || "").toLowerCase().startsWith("image/")) continue;
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > maximumPosterDownloadBytes) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > maximumPosterDownloadBytes) continue;
      return buffer;
    } catch {
      // Try the original URL if its optimized variant is unavailable.
    }
  }
  throw new Error("poster download failed");
}

async function cacheRecommendationPoster(item) {
  try {
    const sourceBuffer = await fetchPosterBuffer(item.posterUrl);
    const optimizedBuffer = await sharp(sourceBuffer, { failOn: "none" })
      .rotate()
      .resize({ width: 320, height: 480, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 68, effort: 4 })
      .toBuffer();
    const assetId = createHash("sha256").update(optimizedBuffer).digest("hex").slice(0, 16);
    const filename = `${assetId}.webp`;
    const assetPath = `${posterAssetDirectory}${filename}`;
    await mkdir(posterAssetDirectory, { recursive: true });
    await writeFileAtomic(assetPath, optimizedBuffer, null);
    const localPosterUrl = `${posterAssetPublicBase}/${filename}`;
    return {
      ...item,
      posterSourceUrl: item.posterUrl,
      posterUrl: localPosterUrl,
      localPosterUrl
    };
  } catch (error) {
    console.warn(`[community-trends] local poster cache failed for ${item.title}: ${error.message}`);
    return { ...item, posterSourceUrl: item.posterUrl };
  }
}

async function removeUnusedCachedPosters(items) {
  const activeFilenames = new Set(
    items
      .map((item) => String(item.posterUrl || "").match(/^\/assets\/recommendation-posters\/([A-Za-z0-9._-]+\.webp)$/)?.[1])
      .filter(Boolean)
  );
  let entries = [];
  try {
    entries = await readdir(posterAssetDirectory, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".webp") && !activeFilenames.has(entry.name))
      .map((entry) => unlink(`${posterAssetDirectory}${entry.name}`).catch(() => {}))
  );
}

async function main() {
  const schedule = JSON.parse(await readFile(schedulePath, "utf8"));
  const candidates = buildCandidates(schedule);
  const existingCache = await readJsonOrEmpty(cachePath);
  const scanPlan = communityScanPlan(existingCache);
  const community = await collectCommunityPosts(candidates, scanPlan).catch((error) => ({ ...scanPlan, posts: [], errors: [error.message] }));
  const dailySignals = buildDailySignals(candidates, community.posts);
  const cache = mergeRollingCache(existingCache, dailySignals, community);
  const scored = aggregateSignals(candidates, cache);
  const remoteItems = await outputItems(scored, candidates);
  const items = await Promise.all(remoteItems.map(cacheRecommendationPoster));
  const payload = {
    label: `최근 ${rollingDays}일 추천`,
    generatedAt: new Date().toISOString(),
    weekStart: windowStart,
    weekEnd: todayKey,
    windowStart,
    windowEnd: todayKey,
    rollingDays,
    scoreModel: {
      windowDays: rollingDays,
      recencyDecay
    },
    items,
    testerOnly,
    promotedToMain: !testerOnly,
    sourceInternal: {
      kind: "public-community-positive-signal",
      galleryId,
      fetchedPostCount: community.posts.length,
      listedPostCount: community.listedPostCount || 0,
      detailedPostCount: community.detailedPostCount || 0,
      commentFetchCount: community.commentFetchCount || 0,
      commentCount: community.commentCount || 0,
      commentFetchErrorCount: community.commentFetchErrorCount || 0,
      scannedPageCount: community.scannedPageCount || 0,
      reachedLookbackStart: Boolean(community.reachedLookbackStart),
      oldestScannedDate: community.oldestScannedDate || "",
      newestScannedDate: community.newestScannedDate || "",
      scanMode: community.scanMode || "",
      candidateWindowStart: todayKey,
      candidateWindowEnd: horizonEnd,
      candidateCount: candidates.length,
      seedLookbackDays,
      seedStart: scanPlan.seedStart,
      listLookbackDays: community.listLookbackDays || scanPlan.listLookbackDays,
      listWindowStart: community.listWindowStart || scanPlan.listWindowStart,
      listPageCap,
      minimumListPages,
      scoreModel: {
        windowDays: rollingDays,
        recencyDecay
      },
      scoredPostDays: Object.keys(dailySignals).sort(),
      signalMode: "positive-only",
      positiveTermGroups,
      negativeTermGroups: [],
      negativeHandling: "ignored-for-ranking",
      questionPatterns: questionPatterns.map((pattern) => pattern.source),
      reviewQuestionPatterns: reviewQuestionPatterns.map((pattern) => pattern.source),
      posterProvider: "verified-image-official-source+known-poster-url+wikipedia-pageimage-fallback",
      errors: (community.errors || []).slice(0, 6)
    }
  };

  await writeFileAtomic(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  await writeFileAtomic(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  await removeUnusedCachedPosters(items);
  console.log(`Wrote ${items.length} weekly positive picks to data/community-trends.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
