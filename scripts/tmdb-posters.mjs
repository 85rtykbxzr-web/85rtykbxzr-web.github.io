// TMDB poster lookup for the story ticket: English (or text-free) artwork per film title.
// Needs TMDB_API_KEY (v3 key); without it every mode is a no-op.
//   node scripts/tmdb-posters.mjs --fill              refresh data/ticket-posters.json from data/schedule.json
//   node scripts/tmdb-posters.mjs --probe "더 드라마"   print the match for a title
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./write-file-atomic.mjs";
import { browserLiveConfigs, fetchBrowserVenue } from "../src/browser-live-schedule.mjs";
import { filmSearchTitle, filmTitleKey } from "../src/film-title.mjs";

const API = "https://api.themoviedb.org/3";
export const tmdbImageBase = "https://image.tmdb.org/t/p/";

function normalize(value) {
  return String(value || "").replace(/[^\p{Letter}\p{Number}]+/gu, "").toLowerCase();
}

// Prefer an exact Korean title match, then the most popular result that has a poster.
// Exact Korean or original title matches first, most popular first.
export function rankTmdbResults(results, title) {
  const wanted = normalize(filmSearchTitle(title));
  const withPoster = (results || []).filter((item) => item.poster_path);
  const exact = withPoster.filter((item) => normalize(item.title) === wanted || normalize(item.original_title) === wanted);
  return (exact.length ? exact : withPoster).sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
}

export function pickTmdbResult(results, title) {
  return rankTmdbResults(results, title)[0] || null;
}

// Poster choices for the ticket: English artwork first, then text-free, then Korean,
// each ranked by TMDB votes.
export function rankTmdbPosters(posters, limit = 8) {
  const order = ["en", null, "ko"];
  return (posters || [])
    .filter((poster) => poster.file_path && order.includes(poster.iso_639_1 ?? null))
    .sort((a, b) =>
      order.indexOf(a.iso_639_1 ?? null) - order.indexOf(b.iso_639_1 ?? null) ||
      (b.vote_average || 0) - (a.vote_average || 0) ||
      (b.vote_count || 0) - (a.vote_count || 0))
    .slice(0, limit)
    .map((poster) => poster.file_path);
}

async function tmdbJson(path, params, { apiKey, fetchImpl }) {
  const response = await fetchImpl(`${API}${path}?${new URLSearchParams({ api_key: apiKey, ...params })}`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`TMDB ${path} failed: ${response.status}`);
  return response.json();
}

// runtime (minutes, from the cinema listing) breaks ties between films sharing a title.
export async function searchTmdbPoster(title, { apiKey, runtime = 0, fetchImpl = fetch } = {}) {
  const query = filmSearchTitle(title);
  if (!apiKey || !query) return null;
  const options = { apiKey, fetchImpl };
  const data = await tmdbJson("/search/movie", { query, language: "ko-KR", include_adult: "false" }, options);
  const ranked = rankTmdbResults(data.results, query);
  let best = ranked[0];
  if (!best) return null;
  if (runtime && ranked.length > 1) {
    for (const candidate of ranked.slice(0, 4)) {
      const details = await tmdbJson(`/movie/${candidate.id}`, {}, options).catch(() => null);
      if (details?.runtime && Math.abs(details.runtime - runtime) <= 6) {
        best = candidate;
        break;
      }
    }
  }
  const images = await tmdbJson(`/movie/${best.id}/images`, { include_image_language: "en,null,ko" }, options).catch(() => null);
  const posters = rankTmdbPosters(images?.posters);
  if (!posters.length && best.poster_path) posters.push(best.poster_path);
  return { tmdbId: best.id, title: best.title, originalTitle: best.original_title, releaseDate: best.release_date || "", posters };
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const postersPath = join(root, "data/ticket-posters.json");
const DAY = 24 * 60 * 60 * 1000;
const hitTtl = 30 * DAY;
const missTtl = 3 * DAY;
const lookupBudget = 120;

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

// Venues collected in the visitor's browser never reach schedule.json, so their titles are
// fetched here the same way; a venue that cannot be reached is simply skipped.
async function browserLiveSessions(fetchImpl) {
  const results = await Promise.allSettled(browserLiveConfigs.map((config) => fetchBrowserVenue(config, { fetchImpl })));
  results.forEach((result, index) => {
    if (result.status === "rejected") console.warn(`Ticket posters: skipped ${browserLiveConfigs[index].name} (${result.reason?.message || result.reason})`);
  });
  return results.flatMap((result) => (result.status === "fulfilled" ? result.value.sessions : []));
}

// Looks up titles that are new or stale, keeps the rest, and drops films no longer scheduled.
export async function fillTicketPosters({ apiKey, now = Date.now(), fetchImpl = fetch } = {}) {
  const schedule = await readJson(join(root, "data/schedule.json"), { sessions: [] });
  const existing = await readJson(postersPath, { films: {} });
  const titles = new Map();
  const liveSessions = await browserLiveSessions(fetchImpl);
  for (const session of [...(schedule.sessions || []), ...liveSessions]) {
    const key = filmTitleKey(session.title);
    const runtime = Number(String(session.tags || "").match(/(\d{2,3})분/)?.[1] || 0);
    if (key && !titles.has(key)) titles.set(key, { title: filmSearchTitle(session.title), runtime });
  }
  const films = {};
  let lookups = 0;
  let failures = 0;
  for (const [key, { title, runtime }] of titles) {
    const previous = existing.films?.[key];
    const age = previous ? now - Date.parse(previous.checkedAt || 0) : Infinity;
    const fresh = previous && age < (previous.posters?.length ? hitTtl : missTtl);
    if (fresh || lookups >= lookupBudget) {
      if (previous) films[key] = previous;
      continue;
    }
    lookups += 1;
    try {
      const match = await searchTmdbPoster(title, { apiKey, runtime, fetchImpl });
      films[key] = { title, tmdbId: match?.tmdbId || null, posters: match?.posters || [], checkedAt: new Date(now).toISOString() };
    } catch (error) {
      failures += 1;
      if (previous) films[key] = previous;
      console.warn(`TMDB lookup failed for ${title}: ${error.message}`);
    }
  }
  const output = { generatedAt: new Date(now).toISOString(), source: "TMDB", imageBase: tmdbImageBase, films };
  await writeFileAtomic(postersPath, `${JSON.stringify(output, null, 2)}\n`);
  const found = Object.values(films).filter((film) => film.posters.length).length;
  console.log(`Ticket posters: ${found}/${titles.size} films have TMDB artwork (${lookups} lookups, ${failures} failures).`);
}

const mode = import.meta.url === `file://${process.argv[1]}` ? process.argv[2] : "";
if (mode === "--fill" || mode === "--probe") {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    console.log("TMDB_API_KEY is not set; leaving ticket posters unchanged.");
    process.exit(0);
  }
}
if (mode === "--fill") await fillTicketPosters({ apiKey: process.env.TMDB_API_KEY });
if (mode === "--probe") {
  const apiKey = process.env.TMDB_API_KEY;
  for (const title of process.argv.slice(3)) {
    try {
      console.log(JSON.stringify({ query: title, match: await searchTmdbPoster(title, { apiKey }) }));
    } catch (error) {
      console.log(JSON.stringify({ query: title, error: error.message }));
    }
  }
}
