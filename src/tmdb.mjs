// TMDB lookups shared by the data pipeline (scripts/tmdb-posters.mjs) and the page, which
// searches TMDB itself for films the pipeline never saw (venues collected in the browser).
import { filmSearchTitle } from "./film-title.mjs";

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
