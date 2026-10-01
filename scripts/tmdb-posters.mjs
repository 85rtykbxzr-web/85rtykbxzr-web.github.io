// TMDB poster lookup for films whose cinema listing has no artwork.
// Needs TMDB_API_KEY (v3 key). Usage: node scripts/tmdb-posters.mjs --probe "더 드라마" ["이방인" ...]

const API = "https://api.themoviedb.org/3";
export const tmdbImageBase = "https://image.tmdb.org/t/p/w780";

export function cleanFilmTitle(title) {
  return String(title || "")
    .replace(/\s*\((?:2D|3D|4K|자막|영문자막|더빙|디지털|리마스터링?)[^)]*\)\s*/gi, " ")
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value) {
  return String(value || "").replace(/[^\p{Letter}\p{Number}]+/gu, "").toLowerCase();
}

// Prefer an exact Korean title match, then the most popular result that has a poster.
export function pickTmdbResult(results, title) {
  const wanted = normalize(cleanFilmTitle(title));
  const withPoster = (results || []).filter((item) => item.poster_path);
  const exact = withPoster.filter((item) => normalize(item.title) === wanted || normalize(item.original_title) === wanted);
  const pool = exact.length ? exact : withPoster;
  return pool.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0] || null;
}

// Original-release artwork reads better than localized one-sheets: English first, then
// text-free, each ranked by TMDB votes.
export function pickTmdbPoster(posters, languages = ["en", null]) {
  for (const language of languages) {
    const ranked = (posters || [])
      .filter((poster) => (poster.iso_639_1 ?? null) === language && poster.file_path)
      .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0) || (b.vote_count || 0) - (a.vote_count || 0));
    if (ranked.length) return ranked[0].file_path;
  }
  return "";
}

async function tmdbJson(path, params, { apiKey, fetchImpl }) {
  const response = await fetchImpl(`${API}${path}?${new URLSearchParams({ api_key: apiKey, ...params })}`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`TMDB ${path} failed: ${response.status}`);
  return response.json();
}

export async function searchTmdbPoster(title, { apiKey, fetchImpl = fetch } = {}) {
  const query = cleanFilmTitle(title);
  if (!apiKey || !query) return null;
  const data = await tmdbJson("/search/movie", { query, language: "ko-KR", include_adult: "false" }, { apiKey, fetchImpl });
  const best = pickTmdbResult(data.results, query);
  if (!best) return null;
  const images = await tmdbJson(`/movie/${best.id}/images`, { include_image_language: "en,null" }, { apiKey, fetchImpl }).catch(() => null);
  const posterPath = pickTmdbPoster(images?.posters) || best.poster_path;
  return { tmdbId: best.id, title: best.title, originalTitle: best.original_title, releaseDate: best.release_date || "", posterUrl: `${tmdbImageBase}${posterPath}` };
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === "--probe") {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    console.log("TMDB_API_KEY is not set; skipping probe.");
    process.exit(0);
  }
  for (const title of process.argv.slice(3)) {
    try {
      console.log(JSON.stringify({ query: title, match: await searchTmdbPoster(title, { apiKey }) }));
    } catch (error) {
      console.log(JSON.stringify({ query: title, error: error.message }));
    }
  }
}
