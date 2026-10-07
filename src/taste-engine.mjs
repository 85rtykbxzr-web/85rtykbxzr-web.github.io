// 취향 추천: reads a 왓챠피디아 (or Letterboxd) ratings export in the browser, learns what the
// person likes from TMDB metadata of the films they rated, and recommends films they have not
// rated that are on the streaming services they use in Korea. Nothing leaves the browser except
// TMDB lookups. Pure logic here; the sheet UI lives in taste-ui.mjs.

// Korean streaming services TMDB (JustWatch data) knows about. 쿠팡플레이 and 라프텔 are not in it.
export const ottServices = [
  { id: "netflix", name: "넷플릭스", short: "N", tmdb: [8, 1796] },
  { id: "watcha", name: "왓챠", short: "W", tmdb: [97] },
  { id: "tving", name: "티빙", short: "T", tmdb: [1883] },
  { id: "wavve", name: "웨이브", short: "w", tmdb: [356] },
  { id: "disney", name: "디즈니+", short: "D", tmdb: [337] },
  { id: "apple", name: "Apple TV+", short: "A", tmdb: [350] },
  { id: "prime", name: "프라임 비디오", short: "P", tmdb: [119] },
  { id: "mubi", name: "MUBI", short: "M", tmdb: [11] }
];

// ---------- CSV ----------

export function parseCsv(text) {
  const source = String(text || "").replace(/^﻿/, "");
  const delimiter = (source.split(/\r?\n/, 1)[0].match(/\t/g) || []).length > (source.split(/\r?\n/, 1)[0].match(/,/g) || []).length ? "\t" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

const headerAliases = {
  title: ["title", "제목", "name", "작품명", "영화"],
  originalTitle: ["original title", "originaltitle", "원제", "english title", "영문제목", "영어제목"],
  year: ["year", "연도", "개봉연도", "제작연도", "releaseyear"],
  rating: ["rating", "별점", "평점", "my rating", "myrating", "내평점", "score"],
  type: ["type", "콘텐츠유형", "유형", "content_type", "contenttype"],
  directors: ["directors", "director", "감독"],
  genres: ["genres", "genre", "장르"],
  countries: ["countries", "country", "국가", "제작국가"],
  date: ["rated_at", "ratedat", "watchedat", "watched date", "watcheddate", "date", "본날짜", "평가일", "watched_at"],
  code: ["content_code", "contentcode", "id", "code"]
};

function headerKey(cell) {
  const value = String(cell || "").trim().toLowerCase().replace(/[\s_-]+/g, (match) => (match.includes(" ") ? " " : match));
  const compact = value.replace(/[\s_-]+/g, "");
  for (const [key, names] of Object.entries(headerAliases)) {
    if (names.some((name) => name === value || name.replace(/[\s_-]+/g, "") === compact)) return key;
  }
  return "";
}

function splitList(value) {
  return String(value || "").split(/\s*[|,/]\s*/).map((item) => item.trim()).filter(Boolean);
}

export function readRatings(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { format: "", items: [], skipped: 0 };
  const header = rows[0].map(headerKey);
  const index = Object.fromEntries(Object.keys(headerAliases).map((key) => [key, header.indexOf(key)]));
  if (index.title < 0) throw new Error("제목 열을 찾지 못했어요. 왓챠피디아나 레터박스드에서 내보낸 CSV인지 확인해 주세요.");
  const ratingValues = rows.slice(1).map((row) => Number.parseFloat(row[index.rating])).filter(Number.isFinite);
  // 10-point exports (rating 1-10) are halved to the 5-point scale
  const scale = ratingValues.length && Math.max(...ratingValues) > 5 ? 0.5 : 1;
  const items = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const title = String(row[index.title] || "").trim();
    if (!title) { skipped += 1; continue; }
    const rawRating = Number.parseFloat(row[index.rating]);
    const rawType = String(row[index.type] ?? "").toLowerCase();
    const year = Number.parseInt(String(row[index.year] ?? "").slice(0, 4), 10);
    items.push({
      title,
      originalTitle: index.originalTitle >= 0 ? String(row[index.originalTitle] || "").trim() : "",
      year: Number.isFinite(year) ? year : null,
      rating: Number.isFinite(rawRating) && rawRating > 0 ? Math.round(rawRating * scale * 2) / 2 : null,
      type: /tv|series|시리즈|드라마|tv_seasons/.test(rawType) ? "tv" : "movie",
      directors: index.directors >= 0 ? splitList(row[index.directors]) : [],
      genres: index.genres >= 0 ? splitList(row[index.genres]) : [],
      countries: index.countries >= 0 ? splitList(row[index.countries]) : [],
      date: index.date >= 0 ? String(row[index.date] || "").slice(0, 10) : "",
      code: index.code >= 0 ? String(row[index.code] || "") : ""
    });
  }
  const names = rows[0].map((cell) => String(cell).trim().toLowerCase());
  const format = names.includes("letterboxd uri") ? "letterboxd" : names.includes("content_code") || names.includes("url") ? "watchapedia" : "csv";
  return { format, items, skipped };
}

// ---------- the person's own numbers (no network) ----------

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function tally(items, pick) {
  const map = new Map();
  for (const item of items) {
    for (const key of pick(item)) {
      if (!key) continue;
      const entry = map.get(key) || { key, count: 0, sum: 0, rated: 0 };
      entry.count += 1;
      if (item.rating != null) { entry.sum += item.rating; entry.rated += 1; }
      map.set(key, entry);
    }
  }
  return [...map.values()].map((entry) => ({ ...entry, avg: entry.rated ? entry.sum / entry.rated : null }));
}

export function ratingStats(items) {
  const rated = items.filter((item) => item.rating != null);
  const ratings = rated.map((item) => item.rating);
  const avg = mean(ratings);
  const sd = Math.sqrt(mean(ratings.map((value) => (value - avg) ** 2))) || 1;
  const buckets = Array.from({ length: 10 }, (_, slot) => ({ score: (slot + 1) / 2, count: 0 }));
  for (const value of ratings) buckets[Math.min(9, Math.max(0, Math.round(value * 2) - 1))].count += 1;
  const movies = items.filter((item) => item.type === "movie");
  const decades = tally(movies.filter((item) => item.year), (item) => [`${Math.floor(item.year / 10) * 10}`]).sort((a, b) => a.key.localeCompare(b.key));
  const genres = tally(movies, (item) => item.genres).filter((entry) => entry.count >= 3).sort((a, b) => b.count - a.count);
  const countries = tally(movies, (item) => item.countries).filter((entry) => entry.count >= 3).sort((a, b) => b.count - a.count);
  const directors = tally(movies, (item) => item.directors).filter((entry) => entry.count >= 2).sort((a, b) => b.count - a.count || (b.avg || 0) - (a.avg || 0));
  const months = tally(items.filter((item) => /^\d{4}-\d{2}/.test(item.date)), (item) => [item.date.slice(0, 7)]).sort((a, b) => b.count - a.count);
  const years = movies.filter((item) => item.year).map((item) => item.year);
  return {
    total: items.length,
    movies: movies.length,
    series: items.length - movies.length,
    rated: rated.length,
    avg,
    sd,
    buckets,
    fiveShare: ratings.length ? ratings.filter((value) => value >= 5).length / ratings.length : 0,
    lowShare: ratings.length ? ratings.filter((value) => value <= 2).length / ratings.length : 0,
    decades,
    genres,
    countries,
    directors,
    busiestMonth: months[0] || null,
    oldest: years.length ? Math.min(...years) : null,
    classicShare: years.length ? years.filter((year) => year < 1980).length / years.length : 0
  };
}

// ---------- TMDB ----------

export function createTmdb({ apiKey, fetchImpl = fetch, concurrency = 8, onRequest }) {
  const cache = new Map();
  const queue = [];
  let active = 0;
  const pump = () => {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active += 1;
      job().finally(() => { active -= 1; pump(); });
    }
  };
  async function request(path, params, attempt = 0) {
    const url = `https://api.themoviedb.org/3${path}?${new URLSearchParams({ api_key: apiKey, ...params })}`;
    const response = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (response.status === 429 && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
      return request(path, params, attempt + 1);
    }
    if (!response.ok) throw new Error(`TMDB ${response.status} ${path}`);
    return response.json();
  }
  return function get(path, params = {}) {
    const key = `${path}?${new URLSearchParams(params)}`;
    if (!cache.has(key)) {
      cache.set(key, new Promise((resolve, reject) => {
        queue.push(() => request(path, params).then(resolve, reject).finally(() => onRequest?.()));
        pump();
      }).catch((error) => { cache.delete(key); throw error; }));
    }
    return cache.get(key);
  };
}

export function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "")
    .toLowerCase();
}

function releaseYear(film) {
  const year = Number.parseInt(String(film.release_date || film.first_air_date || "").slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

// The rated film's TMDB entry: an exact Korean or original title within a year, else the
// closest-year result of a strong search, else nothing (a wrong match poisons the profile).
export function pickMatch(results, item) {
  const wanted = [normalizeTitle(item.title), normalizeTitle(item.originalTitle)].filter(Boolean);
  const scored = (results || []).map((film, order) => {
    const titles = [film.title, film.original_title, film.name, film.original_name].map(normalizeTitle);
    const exact = titles.some((title) => wanted.includes(title));
    const year = releaseYear(film);
    const gap = item.year && year ? Math.abs(item.year - year) : 3;
    return { film, exact, gap, order };
  });
  const exact = scored.filter((entry) => entry.exact && entry.gap <= 1).sort((a, b) => a.gap - b.gap || a.order - b.order)[0];
  if (exact) return exact.film;
  const close = scored.filter((entry) => entry.gap === 0 && entry.order === 0)[0];
  return close && (close.film.vote_count || 0) >= 20 ? close.film : null;
}

export async function matchRated(get, item) {
  const kind = item.type === "tv" ? "tv" : "movie";
  const base = { query: item.title, language: "ko-KR", include_adult: "false" };
  const withYear = item.year ? { ...base, [kind === "tv" ? "first_air_date_year" : "year"]: String(item.year) } : base;
  let found = pickMatch((await get(`/search/${kind}`, withYear)).results, item);
  if (!found && item.year) found = pickMatch((await get(`/search/${kind}`, base)).results, item);
  if (!found && item.originalTitle) found = pickMatch((await get(`/search/${kind}`, { ...base, query: item.originalTitle })).results, item);
  return found ? found.id : null;
}

// ---------- features and the taste vector ----------

const featureWeight = { g: 1, k: 1.5, d: 3, c: 0.7, l: 0.7, y: 0.4, n: 0.5 };

function directorsOf(detail) {
  return (detail.credits?.crew || []).filter((person) => person.job === "Director");
}

export function filmFeatures(detail) {
  const features = new Map();
  const add = (key, value = 1) => features.set(key, (features.get(key) || 0) + value);
  for (const genre of detail.genres || []) add(`g:${genre.id}`);
  for (const id of detail.genre_ids || []) add(`g:${id}`);
  for (const keyword of (detail.keywords?.keywords || []).slice(0, 30)) add(`k:${keyword.id}`);
  for (const person of directorsOf(detail)) add(`d:${person.id}`);
  for (const person of (detail.credits?.cast || []).slice(0, 4)) add(`c:${person.id}`);
  if (detail.original_language) add(`l:${detail.original_language}`);
  const year = releaseYear(detail);
  if (year) add(`y:${Math.floor(year / 10) * 10}`);
  for (const country of (detail.production_countries || []).slice(0, 2)) add(`n:${country.iso_3166_1}`);
  return features;
}

function weightOf(feature, idf) {
  const kind = feature[0];
  return (featureWeight[kind] || 0.5) * (kind === "k" ? idf.get(feature) || 1 : 1);
}

// Each rated film pulls the profile toward its features by how far its rating sits above or
// below the person's own average, so a harsh rater's 4 counts like a generous rater's 5.
export function buildProfile(seeds, stats) {
  const docFreq = new Map();
  for (const seed of seeds) for (const feature of seed.features.keys()) if (feature[0] === "k") docFreq.set(feature, (docFreq.get(feature) || 0) + 1);
  const idf = new Map([...docFreq].map(([feature, count]) => [feature, Math.min(2.2, 0.6 + Math.log(1 + seeds.length / count) / 2)]));
  const vector = new Map();
  for (const seed of seeds) {
    const weight = Math.max(-1.6, Math.min(2, (seed.rating - stats.avg) / stats.sd));
    seed.weight = weight;
    for (const [feature, value] of seed.features) {
      vector.set(feature, (vector.get(feature) || 0) + weight * value * weightOf(feature, idf));
    }
  }
  return { vector, idf };
}

function cosine(profile, features, idf) {
  let dot = 0;
  let norm = 0;
  for (const [feature, value] of features) {
    const weighted = value * weightOf(feature, idf);
    dot += (profile.get(feature) || 0) * weighted;
    norm += weighted * weighted;
  }
  let profileNorm = 0;
  for (const value of profile.values()) profileNorm += value * value;
  return norm && profileNorm ? dot / Math.sqrt(norm * profileNorm) : 0;
}

function bayesQuality(film) {
  const votes = film.vote_count || 0;
  const average = film.vote_average || 0;
  const prior = 6.6;
  const weight = 250;
  return (votes * average + weight * prior) / (votes + weight);
}

// ---------- providers ----------

export function providerIds(selected) {
  return ottServices.filter((service) => selected.includes(service.id)).flatMap((service) => service.tmdb);
}

export function availability(detail, selected, includeRent) {
  const kr = detail["watch/providers"]?.results?.KR;
  if (!kr) return { link: "", services: [], rentOnly: false };
  const ids = (list) => new Set((list || []).map((provider) => provider.provider_id));
  const flat = ids(kr.flatrate);
  const paid = new Set([...ids(kr.rent), ...ids(kr.buy)]);
  const services = [];
  let rentOnly = true;
  for (const service of ottServices) {
    if (!selected.includes(service.id)) continue;
    if (service.tmdb.some((id) => flat.has(id))) { services.push({ ...service, mode: "구독" }); rentOnly = false; }
    else if (includeRent && service.tmdb.some((id) => paid.has(id))) services.push({ ...service, mode: "대여" });
  }
  return { link: kr.link || "", services, rentOnly: services.length > 0 && rentOnly };
}

// ---------- the whole run ----------

function seenKeys(items) {
  const keys = new Set();
  for (const item of items) {
    for (const title of [item.title, item.originalTitle]) {
      const key = normalizeTitle(title);
      if (!key) continue;
      keys.add(key);
      if (item.year) for (const year of [item.year - 1, item.year, item.year + 1]) keys.add(`${key}|${year}`);
    }
  }
  return keys;
}

function isSeen(film, keys, ratedIds) {
  if (ratedIds.has(film.id)) return true;
  const year = releaseYear(film);
  for (const title of [film.title, film.original_title]) {
    const key = normalizeTitle(title);
    if (!key) continue;
    if (year ? keys.has(`${key}|${year}`) : keys.has(key)) return true;
  }
  return false;
}

function chooseSeeds(items, stats, { liked = 60, disliked = 18 } = {}) {
  const movies = items.filter((item) => item.type === "movie" && item.rating != null);
  const byRecent = (a, b) => b.rating - a.rating || String(b.date).localeCompare(String(a.date));
  const likedCut = Math.max(3.5, Math.min(4.5, stats.avg + 0.5));
  const dislikedCut = Math.min(2.5, stats.avg - 1);
  const good = movies.filter((item) => item.rating >= likedCut).sort(byRecent).slice(0, liked);
  const bad = movies.filter((item) => item.rating <= dislikedCut).sort((a, b) => a.rating - b.rating).slice(0, disliked);
  return [...good, ...bad];
}

const detailAppend = "credits,keywords,recommendations,similar,watch/providers";

export async function runTaste({ items, selected, includeRent = false, hiddenGems = false, get, theaterIds = [], onStep = () => {} }) {
  const stats = ratingStats(items);
  const ratedMovies = items.filter((item) => item.type === "movie");
  if (ratedMovies.filter((item) => item.rating != null).length < 5) throw new Error("별점 준 영화가 5편은 넘어야 취향을 읽을 수 있어요.");

  // 1. find the rated films on TMDB
  const seedItems = chooseSeeds(items, stats);
  onStep({ phase: "match", total: seedItems.length, done: 0 });
  let matched = 0;
  const seedIds = await Promise.all(seedItems.map(async (item) => {
    const id = await matchRated(get, item).catch(() => null);
    matched += 1;
    onStep({ phase: "match", total: seedItems.length, done: matched });
    return id;
  }));

  // 2. read what each of those films is made of
  const seeds = [];
  const ratedIds = new Set();
  await Promise.all(seedItems.map(async (item, index) => {
    const id = seedIds[index];
    if (!id) return;
    ratedIds.add(id);
    const detail = await get(`/movie/${id}`, { language: "ko-KR", append_to_response: detailAppend }).catch(() => null);
    if (!detail) return;
    seeds.push({ item, id, rating: item.rating, detail, features: filmFeatures(detail) });
    onStep({ phase: "read", total: seedItems.length, done: seeds.length, title: detail.title || item.title });
  }));
  if (seeds.filter((seed) => seed.rating >= stats.avg).length < 3) throw new Error("좋아한 영화를 TMDB에서 충분히 찾지 못했어요. 제목이 원제·한글 제목과 많이 다른지 확인해 주세요.");

  const { vector, idf } = buildProfile(seeds, stats);
  // someone whose favourites average 7.8 on TMDB isn't served 6.2 thrillers; the floor follows them
  const likedVotes = seeds.filter((seed) => seed.weight > 0 && seed.detail.vote_count > 30).map((seed) => seed.detail.vote_average);
  const qualityFloor = Math.max(5.9, Math.min(6.9, (likedVotes.length ? mean(likedVotes) : 7) - 1.1));
  const keys = seenKeys(items);

  // favourite directors: rated twice or more among the liked seeds, by summed weight
  const directorScore = new Map();
  const directorName = new Map();
  for (const seed of seeds) {
    const directors = directorsOf(seed.detail);
    for (const person of directors) {
      directorScore.set(person.id, (directorScore.get(person.id) || 0) + seed.weight);
      // the CSV often carries the Korean name; use it when the film has a single director
      const korean = directors.length === 1 && seed.item.directors.length === 1 ? seed.item.directors[0] : "";
      if (!directorName.has(person.id) || (korean && /[가-힣]/.test(korean))) directorName.set(person.id, korean && /[가-힣]/.test(korean) ? korean : person.name);
    }
  }
  const favouriteDirectors = [...directorScore].filter(([, score]) => score >= 1.2).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const favouriteDirectorIds = new Set(favouriteDirectors.map(([id]) => id));

  // 3. gather candidates: films the liked ones lead to, and well-rated films in the person's
  // favourite genres that are on their services right now
  onStep({ phase: "gather" });
  const pool = new Map();
  const touch = (film, source) => {
    if (!film?.id || film.adult || isSeen(film, keys, ratedIds)) return null;
    const entry = pool.get(film.id) || { film, links: [], discovered: false };
    pool.set(film.id, entry);
    if (source) entry.links.push(source);
    return entry;
  };
  for (const seed of seeds) {
    if (seed.weight <= 0) continue;
    const lists = [[seed.detail.recommendations?.results || [], 1], [seed.detail.similar?.results || [], 0.35]];
    for (const [list, strength] of lists) {
      list.slice(0, 20).forEach((film, rank) => touch(film, { seed, value: seed.weight * strength * (1 - rank / 30) }));
    }
  }
  const services = providerIds(selected);
  const monetization = includeRent ? "flatrate|rent|buy" : "flatrate";
  const genreScore = new Map();
  for (const [feature, value] of vector) if (feature.startsWith("g:")) genreScore.set(Number(feature.slice(2)), value);
  const topGenres = [...genreScore].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id);
  const keywordScore = [...vector].filter(([feature]) => feature.startsWith("k:")).sort((a, b) => b[1] - a[1]);
  const topKeywords = keywordScore.slice(0, 6).map(([feature]) => feature.slice(2));
  if (services.length) {
    const discover = (params) => get("/discover/movie", {
      language: "ko-KR", watch_region: "KR", with_watch_providers: services.join("|"), with_watch_monetization_types: monetization,
      include_adult: "false", "vote_count.gte": hiddenGems ? "60" : "150", sort_by: "vote_average.desc", ...params
    }).catch(() => ({ results: [] }));
    const runs = [
      ...topGenres.map((genre) => discover({ with_genres: String(genre) })),
      ...topGenres.slice(0, 2).map((genre) => discover({ with_genres: String(genre), page: "2" })),
      discover({ with_keywords: topKeywords.join("|") }),
      favouriteDirectors.length ? discover({ with_crew: favouriteDirectors.map(([id]) => id).join("|"), "vote_count.gte": "20" }) : null,
      discover({ sort_by: "popularity.desc", "vote_average.gte": "7" })
    ].filter(Boolean);
    for (const result of await Promise.all(runs)) for (const film of result.results || []) {
      const entry = touch(film, null);
      if (entry) entry.discovered = true;
    }
  }

  // quick pre-score with what the list results carry, then read the best ones in full
  const prelim = [...pool.values()].map((entry) => {
    const graph = entry.links.reduce((sum, link) => sum + link.value, 0);
    const genres = (entry.film.genre_ids || []).reduce((sum, id) => sum + Math.max(0, genreScore.get(id) || 0), 0);
    return { entry, pre: graph * 2 + genres * 0.05 + (entry.discovered ? 0.6 : 0) + bayesQuality(entry.film) / 10 };
  }).sort((a, b) => b.pre - a.pre).slice(0, 140);

  onStep({ phase: "score", total: prelim.length, done: 0 });
  let read = 0;
  const scored = (await Promise.all(prelim.map(async ({ entry }) => {
    const detail = await get(`/movie/${entry.film.id}`, { language: "ko-KR", append_to_response: "credits,keywords,watch/providers" }).catch(() => null);
    read += 1;
    onStep({ phase: "score", total: prelim.length, done: read });
    if (!detail || isSeen(detail, keys, ratedIds)) return null;
    const where = availability(detail, selected, includeRent);
    if (selected.length && !where.services.length) return null;
    const features = filmFeatures(detail);
    const taste = cosine(vector, features, idf);
    const graph = entry.links.reduce((sum, link) => sum + Math.max(0, link.value), 0);
    const directors = directorsOf(detail);
    const director = directors.find((person) => favouriteDirectorIds.has(person.id));
    const quality = (bayesQuality(detail) - 5.8) / 2.5;
    const popularity = Math.min(1, Math.log10(1 + (detail.vote_count || 0)) / 4.3);
    // a film people rate poorly needs a favourite director to get in
    if (bayesQuality(detail) < qualityFloor && !director) return null;
    let score = taste * 1.25 + Math.min(1.6, graph) * 0.22 + quality * 0.35 + (director ? 0.25 : 0);
    if (hiddenGems) score -= popularity * 0.35;
    if (where.rentOnly) score -= 0.08;
    return { detail, entry, where, taste, graph, director, directors, score, features };
  }))).filter(Boolean);

  // 4. pick with variety: a director or a franchise doesn't fill the list
  scored.sort((a, b) => b.score - a.score);
  const picks = [];
  const directorCount = new Map();
  const collections = new Set();
  for (const candidate of scored) {
    if (picks.length >= 36) break;
    const directorId = candidate.directors[0]?.id;
    const collection = candidate.detail.belongs_to_collection?.id;
    if (collection && collections.has(collection)) continue;
    if (directorId && (directorCount.get(directorId) || 0) >= 2) continue;
    picks.push(candidate);
    if (directorId) directorCount.set(directorId, (directorCount.get(directorId) || 0) + 1);
    if (collection) collections.add(collection);
  }
  const best = picks[0]?.score || 1;
  const worst = picks.at(-1)?.score ?? 0;
  const recs = picks.map((candidate) => ({
    ...describe(candidate, { idf, vector, directorName }),
    match: Math.round(72 + 27 * Math.pow(Math.max(0, (candidate.score - worst) / ((best - worst) || 1)), 0.8))
  }));

  // 5. what's on in Seoul theatres right now, scored the same way
  let theater = [];
  if (theaterIds.length) {
    theater = (await Promise.all(theaterIds.slice(0, 60).map(async (id) => {
      const detail = await get(`/movie/${id}`, { language: "ko-KR", append_to_response: "credits,keywords" }).catch(() => null);
      if (!detail || isSeen(detail, keys, ratedIds)) return null;
      const features = filmFeatures(detail);
      const directors = directorsOf(detail);
      const director = directors.find((person) => favouriteDirectorIds.has(person.id));
      const taste = cosine(vector, features, idf);
      return { detail, entry: { links: [] }, taste, director, directors, features, score: taste + (director ? 0.25 : 0) + (bayesQuality(detail) - 6) / 10 };
    }))).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 4).map((candidate) => describe(candidate, { idf, vector, directorName }));
  }

  return {
    stats,
    seeds: seeds.sort((a, b) => b.rating - a.rating || (b.detail.vote_count || 0) - (a.detail.vote_count || 0)),
    recs,
    theater
  };
}

function describe(candidate, { idf, vector, directorName }) {
  const { detail } = candidate;
  const reasons = [];
  const links = [...(candidate.entry.links || [])].sort((a, b) => b.value - a.value);
  const fromSeeds = [];
  for (const link of links) {
    const name = link.seed.detail.title || link.seed.item.title;
    if (!fromSeeds.includes(name)) fromSeeds.push(name);
    if (fromSeeds.length === 2) break;
  }
  if (fromSeeds.length) reasons.push({ kind: "seed", text: `${fromSeeds.map((name) => `‘${name}’`).join(", ")}에 높은 별점을 준 당신에게` });
  if (candidate.director) reasons.push({ kind: "director", text: `좋아하는 감독 ${directorName.get(candidate.director.id) || candidate.director.name}` });
  const sharedKeywords = (detail.keywords?.keywords || [])
    .map((keyword) => ({ keyword, value: (vector.get(`k:${keyword.id}`) || 0) * (idf.get(`k:${keyword.id}`) || 1) }))
    .filter((entry) => entry.value > 0.6)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((entry) => entry.keyword.name);
  if (sharedKeywords.length) reasons.push({ kind: "keywords", text: sharedKeywords.map((name) => `#${name}`).join(" ") });
  const directors = candidate.directors || [];
  return {
    id: detail.id,
    title: detail.title || detail.original_title,
    originalTitle: detail.original_title && detail.original_title !== detail.title ? detail.original_title : "",
    year: releaseYear(detail),
    runtime: detail.runtime || null,
    poster: detail.poster_path || "",
    backdrop: detail.backdrop_path || "",
    overview: detail.overview || "",
    genres: (detail.genres || []).map((genre) => genre.name).slice(0, 3),
    director: directors.map((person) => directorName.get(person.id) || person.name).slice(0, 2).join(", "),
    voteAverage: detail.vote_average ? Math.round(detail.vote_average * 10) / 10 : null,
    voteCount: detail.vote_count || 0,
    where: candidate.where || null,
    reasons
  };
}
