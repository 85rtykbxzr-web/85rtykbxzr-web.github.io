// TMDB poster lookup for the story ticket: English (or text-free) artwork per film title.
// Needs TMDB_API_KEY (v3 key); without it every mode is a no-op.
//   node scripts/tmdb-posters.mjs --fill              refresh data/ticket-posters.json from data/schedule.json
//   node scripts/tmdb-posters.mjs --probe "더 드라마"   print the match for a title
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./write-file-atomic.mjs";
import { filmSearchTitle, filmTitleKey } from "../src/film-title.mjs";
import { searchTmdbPoster, tmdbImageBase } from "../src/tmdb.mjs";

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

// Looks up titles that are new or stale, keeps the rest, and drops films no longer scheduled.
export async function fillTicketPosters({ apiKey, now = Date.now(), fetchImpl = fetch } = {}) {
  const schedule = await readJson(join(root, "data/schedule.json"), { sessions: [] });
  const existing = await readJson(postersPath, { films: {} });
  const titles = new Map();
  for (const session of schedule.sessions || []) {
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
