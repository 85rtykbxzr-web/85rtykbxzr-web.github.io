// Festival "interest ranking": counts how often a festival's films come up in the
// community gallery from two weeks before the festival until it ends.
// Kept separate from the weekly picks so festival chatter never reshuffles them.

export const festivalLeadDays = 14;
export const festivalPickLimit = 8;
export const festivalCacheRetentionDays = 45;

// Short or common titles only count when the post is clearly about the festival.
const festivalAliases = {
  "biff-": ["부국제", "부산국제영화제", "부산영화제", "biff", "부산"],
  "jeonju-": ["전주국제영화제", "전주영화제", "전주", "jiff"],
  "bifan-": ["부천국제판타스틱영화제", "부천영화제", "부천", "bifan"]
};

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function normalizeFestivalTitle(value) {
  return String(value || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "")
    .toLowerCase();
}

export function festivalAliasesFor(festival) {
  const id = String(festival?.id || "");
  const key = Object.keys(festivalAliases).find((prefix) => id.startsWith(prefix));
  const names = [festival?.name, ...(key ? festivalAliases[key] : [])].filter(Boolean);
  return [...new Set(names.map((name) => String(name).toLowerCase()))];
}

// BIFF "전체 상영작" page: one table per section, one <b onclick=...prog_view...> per film,
// titled "한국어 제목 / English Title".
export function parseBiffLineup(html, baseUrl = "https://www.biff.kr/") {
  const films = [];
  const sections = String(html || "").split(/<div class=["']list_sec["']>/i).slice(1);
  for (const sectionMarkup of sections) {
    const section = stripTags(sectionMarkup.match(/<h3>\s*<strong>([\s\S]*?)<\/strong>/i)?.[1] || "");
    for (const match of sectionMarkup.matchAll(/<b[^>]*onclick=["']location\.href='([^']*prog_view\.asp[^']*)'\s*["'][^>]*>([\s\S]*?)<\/b>/gi)) {
      const fullTitle = stripTags(match[2]);
      const [koreanTitle, ...rest] = fullTitle.split(" / ");
      const title = (koreanTitle || fullTitle).trim();
      if (!title) continue;
      let url = "";
      try {
        url = new URL(match[1].replace(/\s+/g, ""), baseUrl).href;
      } catch {
        url = "";
      }
      films.push({ title, englishTitle: rest.join(" / ").trim(), section, url });
    }
  }
  const byTitle = new Map();
  for (const film of films) {
    const key = normalizeFestivalTitle(film.title);
    if (key && !byTitle.has(key)) byTitle.set(key, film);
  }
  return [...byTitle.values()];
}

export const lineupParsers = {
  biff: parseBiffLineup
};

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function festivalPickWindow(festival) {
  if (!festival?.startDate || !festival?.endDate) return null;
  return { start: addDays(festival.startDate, -festivalLeadDays), end: festival.endDate };
}

export function activeLineupFestivals(festivals, today) {
  return (festivals || []).filter((festival) => {
    const window = festivalPickWindow(festival);
    return Boolean(festival?.lineup?.url && lineupParsers[festival.lineup.format] && window && today >= window.start && today <= window.end);
  });
}

export function festivalCandidates(films) {
  return films
    .map((film) => ({ ...film, normalized: normalizeFestivalTitle(film.title) }))
    .filter((film) => film.normalized.length >= 2);
}

// A title of four or more letters counts on its own; shorter ones ("여름", "엄마의 집")
// and films flagged requiresAlias need the post to name the festival as well.
export function festivalMatches(text, candidates, aliases) {
  const normalizedText = normalizeFestivalTitle(text);
  if (!normalizedText) return [];
  const lowered = String(text || "").toLowerCase();
  const mentionsFestival = aliases.some((alias) => lowered.includes(alias));
  return candidates.filter((candidate) => {
    if (!normalizedText.includes(candidate.normalized)) return false;
    return (candidate.normalized.length >= 4 && !candidate.requiresAlias) || mentionsFestival;
  });
}

// Per-day counts so a run only rewrites the days it scanned.
export function buildFestivalDays(posts, candidates, aliases, window) {
  const days = {};
  for (const post of posts) {
    if (!post.date || post.date < window.start || post.date > window.end) continue;
    const text = `${post.title || ""} ${post.body || ""}`;
    const matches = festivalMatches(text, candidates, aliases);
    days[post.date] ||= {};
    for (const candidate of matches) {
      const entry = (days[post.date][candidate.normalized] ||= { title: candidate.title, mentionCount: 0, commentCount: 0 });
      entry.mentionCount += 1;
      entry.commentCount += Array.isArray(post.comments) ? post.comments.length : 0;
    }
  }
  return days;
}

export function mergeFestivalDays(existingDays, freshDays, scannedDates, window) {
  const days = { ...(existingDays || {}) };
  for (const date of scannedDates) {
    if (date >= window.start && date <= window.end) days[date] = freshDays[date] || {};
  }
  for (const date of Object.keys(days)) {
    if (date < window.start || date > window.end) delete days[date];
  }
  return days;
}

export function rankFestivalPicks(days, candidates) {
  const byKey = new Map(candidates.map((candidate) => [candidate.normalized, { ...candidate, mentionCount: 0, commentCount: 0 }]));
  for (const signals of Object.values(days || {})) {
    for (const [key, signal] of Object.entries(signals || {})) {
      const entry = byKey.get(key);
      if (!entry) continue;
      entry.mentionCount += Number(signal.mentionCount || 0);
      entry.commentCount += Number(signal.commentCount || 0);
    }
  }
  return [...byKey.values()]
    .filter((entry) => entry.mentionCount > 0)
    .map((entry) => ({ ...entry, score: entry.mentionCount * 3 + Math.min(entry.commentCount, 30) * 0.2 }))
    .sort((a, b) => b.score - a.score || b.mentionCount - a.mentionCount || a.title.localeCompare(b.title, "ko"))
    .slice(0, festivalPickLimit)
    .map((entry, index) => ({
      rank: index + 1,
      title: entry.title,
      englishTitle: entry.englishTitle || "",
      section: entry.section || "",
      url: entry.url || "",
      mentionCount: entry.mentionCount
    }));
}
