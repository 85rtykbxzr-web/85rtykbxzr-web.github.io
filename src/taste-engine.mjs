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

// the person's own scale: how generous they are and how spread out
export function ratingStats(items) {
  const ratings = items.filter((item) => item.rating != null).map((item) => item.rating);
  const avg = mean(ratings);
  const sd = Math.sqrt(mean(ratings.map((value) => (value - avg) ** 2))) || 1;
  return { total: items.length, rated: ratings.length, avg, sd };
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

// Features fall into blocks that are compared separately, so a film with thirty keywords can't
// win on themes alone and a film with none isn't sunk by them.
const blockOf = { g: "genre", k: "theme", d: "people", c: "people", l: "place", n: "place", y: "era" };
// "reach" is not a feature block: it is how far a film's vote count sits from those of the
// liked films, so someone who loves 300-vote festival films isn't handed blockbusters
const blockWeight = { genre: 0.18, theme: 0.32, people: 0.24, place: 0.12, era: 0.04, reach: 0.1 };
const featureWeight = { g: 1, k: 1, d: 2.5, c: 0.8, l: 0.8, y: 1, n: 1 };

function directorsOf(detail) {
  return (detail.credits?.crew || []).filter((person) => person.job === "Director");
}

export function filmFeatures(detail) {
  const features = new Map();
  const add = (key, value = 1) => features.set(key, (features.get(key) || 0) + value);
  for (const genre of detail.genres || []) add(`g:${genre.id}`);
  if (!detail.genres) for (const id of detail.genre_ids || []) add(`g:${id}`);
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
  return (featureWeight[kind] || 0.5) * (idf.get(feature) || 1);
}

// Each rated film pulls the profile toward its features by how far its rating sits above or
// below the person's own average, so a harsh rater's 4 counts like a generous rater's 5. Rare
// features (a keyword three liked films share) count for more than ones every film has.
export function buildProfile(seeds, stats) {
  const docFreq = new Map();
  for (const seed of seeds) for (const feature of seed.features.keys()) docFreq.set(feature, (docFreq.get(feature) || 0) + 1);
  const idf = new Map([...docFreq].map(([feature, count]) => [feature, feature[0] === "k" ? Math.min(2.2, 0.6 + Math.log(1 + seeds.length / count) / 2) : 1]));
  const vector = new Map();
  for (const seed of seeds) {
    const weight = Math.max(-1.6, Math.min(2, (seed.rating - stats.avg) / stats.sd));
    seed.weight = weight;
    for (const [feature, value] of seed.features) {
      vector.set(feature, (vector.get(feature) || 0) + weight * value * weightOf(feature, idf));
    }
  }
  const norms = {};
  for (const [feature, value] of vector) {
    const block = blockOf[feature[0]];
    norms[block] = (norms[block] || 0) + value * value;
  }
  const reachOf = seeds.filter((seed) => seed.weight > 0 && seed.detail).map((seed) => Math.log10(1 + (seed.detail.vote_count || 0)));
  const reachMean = mean(reachOf);
  const reach = reachOf.length >= 5 ? { mean: reachMean, sd: Math.max(0.35, Math.sqrt(mean(reachOf.map((value) => (value - reachMean) ** 2)))) } : null;
  return { vector, idf, norms, reach };
}

// how well a film fits the profile, block by block: a cosine in -1..1, or null when the film
// has nothing in that block
export function blockSimilarity(profile, features, votes) {
  const { vector, idf, norms, reach } = profile;
  const dot = {};
  const norm = {};
  for (const [feature, value] of features) {
    const block = blockOf[feature[0]];
    const weighted = value * weightOf(feature, idf);
    dot[block] = (dot[block] || 0) + (vector.get(feature) || 0) * weighted;
    norm[block] = (norm[block] || 0) + weighted * weighted;
  }
  const out = {};
  for (const block of Object.keys(blockWeight)) {
    out[block] = norm[block] && norms[block] ? dot[block] / Math.sqrt(norm[block] * norms[block]) : null;
  }
  out.reach = reach && votes != null ? -Math.abs(Math.log10(1 + votes) - reach.mean) / reach.sd : null;
  return out;
}

// The blocks live on very different scales: nearly every drama scores 0.7 on genre while
// keyword cosines against a profile of hundreds of keywords stay under 0.15, even though
// keywords say far more. So each block is measured against the spread of the candidate
// pool and the standard scores are mixed.
export function blockScale(blockList) {
  const scale = {};
  for (const block of Object.keys(blockWeight)) {
    const values = blockList.map((blocks) => blocks[block]).filter((value) => value != null);
    const average = mean(values);
    const spread = Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
    scale[block] = { mean: average, sd: spread > 1e-6 ? spread : 1 };
  }
  return scale;
}

export function similarity(blocks, scale) {
  let total = 0;
  let used = 0;
  for (const [block, weight] of Object.entries(blockWeight)) {
    if (blocks[block] == null) continue;
    const z = (blocks[block] - scale[block].mean) / scale[block].sd;
    total += weight * Math.max(-2.5, Math.min(2.5, z));
    used += weight;
  }
  return used ? total / used : 0;
}

// how alike two candidates are, for keeping the list varied
function filmOverlap(a, b, idf) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [feature, value] of a) {
    const weighted = value * weightOf(feature, idf);
    na += weighted * weighted;
    if (b.has(feature)) dot += weighted * b.get(feature) * weightOf(feature, idf);
  }
  for (const [feature, value] of b) nb += (value * weightOf(feature, idf)) ** 2;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// TMDB averages run high for films with few, devoted voters; pull them toward a sober prior
function bayesQuality(film) {
  const votes = film.vote_count || 0;
  const average = film.vote_average || 0;
  const prior = 6.4;
  const weight = 400;
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

function chooseSeeds(items, stats, { liked = 80, disliked = 20 } = {}) {
  const movies = items.filter((item) => item.type === "movie" && item.rating != null);
  const byRecent = (a, b) => b.rating - a.rating || String(b.date).localeCompare(String(a.date));
  const likedCut = Math.max(3.5, Math.min(4.5, stats.avg + 0.5));
  const dislikedCut = Math.min(2.5, stats.avg - 1);
  const good = movies.filter((item) => item.rating >= likedCut).sort(byRecent).slice(0, liked);
  const bad = movies.filter((item) => item.rating <= dislikedCut).sort((a, b) => a.rating - b.rating).slice(0, disliked);
  return [...good, ...bad];
}

const detailAppend = "credits,keywords,recommendations,similar,watch/providers";
// below this a "nearest liked film" shares little more than a genre; checked by eye on real runs
const nearMin = 0.18;

export async function runTaste({ items, selected, includeRent = false, hiddenGems = false, get, theaterIds = [], onStep = () => {} }) {
  const stats = ratingStats(items);
  const ratedMovies = items.filter((item) => item.type === "movie");
  if (ratedMovies.filter((item) => item.rating != null).length < 5) throw new Error("별점 준 영화가 5편은 넘어야 추천할 수 있어요.");

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
    onStep({ phase: "read", total: seedItems.length, done: seeds.length, title: item.title || detail.title, poster: detail.poster_path || "", rating: item.rating });
  }));
  if (seeds.filter((seed) => seed.rating >= stats.avg).length < 3) throw new Error("좋아한 영화를 TMDB에서 충분히 찾지 못했어요. 제목이 원제·한글 제목과 많이 다른지 확인해 주세요.");

  const profile = buildProfile(seeds, stats);
  const { vector } = profile;
  // someone whose favourites average 7.8 on TMDB isn't served 6.2 thrillers; the floor follows them
  const likedVotes = seeds.filter((seed) => seed.weight > 0 && seed.detail.vote_count > 30).map((seed) => seed.detail.vote_average);
  const qualityFloor = Math.max(5.9, Math.min(6.9, (likedVotes.length ? mean(likedVotes) : 7) - 1.1));
  const keys = seenKeys(items);

  // favourite directors: liked twice or more, by summed weight
  const directorScore = new Map();
  const directorName = new Map();
  for (const seed of seeds) {
    const directors = directorsOf(seed.detail);
    for (const person of directors) {
      directorScore.set(person.id, (directorScore.get(person.id) || 0) + seed.weight);
      // the CSV often carries the Korean name; use it when the film has a single director
      const korean = directors.length === 1 && seed.item.directors.length === 1 && /[가-힣]/.test(seed.item.directors[0]) ? seed.item.directors[0] : "";
      if (korean || !directorName.has(person.id)) directorName.set(person.id, korean || person.name);
    }
  }
  const favouriteDirectors = [...directorScore].filter(([, score]) => score >= 1.2).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const favouriteDirectorIds = new Set(favouriteDirectors.map(([id]) => id));

  // 3. gather candidates. TMDB's recommendations ("people who liked this also liked") of the
  // liked films are the strongest lead; the same lists from disliked films count against.
  onStep({ phase: "gather" });
  const pool = new Map();
  const against = new Map();
  const touch = (film, source) => {
    if (!film?.id || film.adult || isSeen(film, keys, ratedIds)) return null;
    const entry = pool.get(film.id) || { film, links: [], discovered: false };
    pool.set(film.id, entry);
    if (source) entry.links.push(source);
    return entry;
  };
  for (const seed of seeds) {
    const lists = [[seed.detail.recommendations?.results || [], 1], [seed.detail.similar?.results || [], 0.3]];
    for (const [list, strength] of lists) {
      list.slice(0, 20).forEach((film, rank) => {
        const value = seed.weight * strength * (1 - rank / 30);
        if (seed.weight > 0) touch(film, { seed, value });
        else if (seed.weight < 0) against.set(film.id, (against.get(film.id) || 0) + value); // value is negative here
      });
    }
  }
  const services = providerIds(selected);
  const monetization = includeRent ? "flatrate|rent|buy" : "flatrate";
  const genreScore = new Map();
  for (const [feature, value] of vector) if (feature.startsWith("g:")) genreScore.set(Number(feature.slice(2)), value);
  const topGenres = [...genreScore].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id);
  const topKeywords = [...vector].filter(([feature]) => feature.startsWith("k:")).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([feature]) => feature.slice(2));
  const topCountries = [...vector].filter(([feature, value]) => feature.startsWith("n:") && value > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([feature]) => feature.slice(2));
  if (services.length) {
    const discover = (params) => get("/discover/movie", {
      language: "ko-KR", watch_region: "KR", with_watch_providers: services.join("|"), with_watch_monetization_types: monetization,
      include_adult: "false", "vote_count.gte": hiddenGems ? "50" : "150", sort_by: "vote_average.desc", ...params
    }).catch(() => ({ results: [] }));
    const runs = [
      ...topGenres.map((genre) => discover({ with_genres: String(genre) })),
      ...topGenres.slice(0, 2).map((genre) => discover({ with_genres: String(genre), page: "2" })),
      discover({ with_keywords: topKeywords.slice(0, 4).join("|") }),
      discover({ with_keywords: topKeywords.slice(4, 8).join("|") }),
      ...topCountries.map((country) => discover({ with_origin_country: country })),
      favouriteDirectors.length ? discover({ with_crew: favouriteDirectors.map(([id]) => id).join("|"), "vote_count.gte": "20" }) : null
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
    return { entry, pre: graph * 2 + genres * 0.04 + (entry.discovered ? 0.6 : 0) + bayesQuality(entry.film) / 10 + (against.get(entry.film.id) || 0) };
  }).sort((a, b) => b.pre - a.pre).slice(0, 160);

  onStep({ phase: "score", total: prelim.length, done: 0 });
  let done = 0;
  const read = (await Promise.all(prelim.map(async ({ entry }) => {
    const detail = await get(`/movie/${entry.film.id}`, { language: "ko-KR", append_to_response: "credits,keywords,watch/providers" }).catch(() => null);
    done += 1;
    onStep({ phase: "score", total: prelim.length, done });
    if (!detail || isSeen(detail, keys, ratedIds) || (detail.runtime && detail.runtime < 40)) return null;
    if (hiddenGems && (detail.vote_count || 0) > 2500) return null;
    const where = availability(detail, selected, includeRent);
    if (selected.length && !where.services.length) return null;
    const directors = directorsOf(detail);
    const director = directors.find((person) => favouriteDirectorIds.has(person.id));
    // a film people rate poorly needs a favourite director to get in
    if (bayesQuality(detail) < qualityFloor && !director) return null;
    const features = filmFeatures(detail);
    return { detail, entry, where, director, directors, features, blocks: blockSimilarity(profile, features, detail.vote_count) };
  }))).filter(Boolean);
  const scale = blockScale(read.map((candidate) => candidate.blocks));
  const scored = read.map((candidate) => {
    const { detail, entry, where, director } = candidate;
    const taste = similarity(candidate.blocks, scale);
    // TMDB's lists drift toward whatever is popular; a film that resembles the liked ones less
    // than most candidates do doesn't get in on links alone
    if (taste < -0.6 && !director) return null;
    // several liked films pointing at the same one matters, with diminishing returns, and in
    // full only for a film that also fits
    const support = entry.links.reduce((sum, link) => sum + link.value, 0);
    const fit = 0.4 + 0.6 * Math.max(0, Math.min(1, taste + 0.5));
    const graph = Math.log1p(Math.max(0, support)) * fit + (against.get(detail.id) || 0) * 0.6;
    const quality = (bayesQuality(detail) - 6.2) / 2;
    const popularity = Math.min(1, Math.log10(1 + (detail.vote_count || 0)) / 4.3);
    let score = taste * 0.25 + graph * 0.35 + quality * 0.3 + (director ? 0.2 : 0);
    if (hiddenGems) score -= popularity * 0.7;
    if (where.rentOnly) score -= 0.08;
    return { ...candidate, taste, score };
  }).filter(Boolean);

  // 4. pick with variety: each next film is weighed against how much it repeats the ones
  // already picked; a director gets two places at most, a franchise one
  const picks = [];
  const remaining = scored.sort((a, b) => b.score - a.score);
  const directorCount = new Map();
  const collections = new Set();
  while (picks.length < 36 && remaining.length) {
    let bestIndex = -1;
    let bestValue = -Infinity;
    for (let index = 0; index < Math.min(remaining.length, 60); index += 1) {
      const candidate = remaining[index];
      const directorId = candidate.directors[0]?.id;
      const collection = candidate.detail.belongs_to_collection?.id;
      if ((collection && collections.has(collection)) || (directorId && (directorCount.get(directorId) || 0) >= 2)) continue;
      const repeat = picks.reduce((max, pick) => Math.max(max, filmOverlap(candidate.features, pick.features, profile.idf)), 0);
      const value = candidate.score - 0.3 * repeat;
      if (value > bestValue) { bestValue = value; bestIndex = index; }
    }
    if (bestIndex < 0) break;
    const [pick] = remaining.splice(bestIndex, 1);
    picks.push(pick);
    const directorId = pick.directors[0]?.id;
    if (directorId) directorCount.set(directorId, (directorCount.get(directorId) || 0) + 1);
    if (pick.detail.belongs_to_collection?.id) collections.add(pick.detail.belongs_to_collection.id);
  }
  // films that came in through discover have no liked film pointing at them; name the liked
  // film they share the most with, when the overlap is real
  const likedSeeds = seeds.filter((seed) => seed.weight > 0.3);
  const nearest = (candidate) => {
    if (candidate.entry.links?.length) return null;
    let best = null;
    for (const seed of likedSeeds) {
      const overlap = filmOverlap(candidate.features, seed.features, profile.idf);
      if (!best || overlap * (1 + seed.weight / 4) > best.value) best = { seed, overlap, value: overlap * (1 + seed.weight / 4) };
    }
    return best && best.overlap >= nearMin ? best.seed : null;
  };
  const context = { directorName, nearest };
  const recs = picks.map((candidate) => describe(candidate, context));

  // 5. what's on in Seoul theatres right now, scored the same way
  let theater = [];
  if (theaterIds.length) {
    theater = (await Promise.all(theaterIds.slice(0, 60).map(async (id) => {
      const detail = await get(`/movie/${id}`, { language: "ko-KR", append_to_response: "credits,keywords" }).catch(() => null);
      if (!detail || isSeen(detail, keys, ratedIds)) return null;
      const features = filmFeatures(detail);
      const directors = directorsOf(detail);
      const director = directors.find((person) => favouriteDirectorIds.has(person.id));
      const taste = similarity(blockSimilarity(profile, features, detail.vote_count), scale);
      return { detail, entry: { links: [] }, taste, director, directors, features, score: taste * 0.25 + (director ? 0.2 : 0) + (bayesQuality(detail) - 6.2) / 6 };
    }))).filter((candidate) => candidate && (candidate.taste > 0.15 || candidate.director)).sort((a, b) => b.score - a.score).slice(0, 4).map((candidate) => describe(candidate, context));
  }

  return { stats, seeds, recs, theater };
}

const regionNames = (() => {
  try { return new Intl.DisplayNames(["ko"], { type: "region" }); } catch { return null; }
})();
// Intl's Korean names are formal ("홍콩(중국 특별행정구)"); film listings use the short ones
const shortRegion = { HK: "홍콩", MO: "마카오", KR: "한국", KP: "북한", US: "미국", GB: "영국", PS: "팔레스타인", SU: "소련", XC: "체코슬로바키아", YU: "유고슬라비아", XG: "동독" };

function countryName(country) {
  return shortRegion[country.iso_3166_1] || regionNames?.of(country.iso_3166_1) || country.name;
}

function stars(rating) {
  return `★${Number.isInteger(rating) ? rating : rating.toFixed(1)}`;
}

function describe(candidate, { directorName, nearest }) {
  const { detail } = candidate;
  // the liked films that lead here, strongest first
  const leads = [];
  for (const link of [...(candidate.entry.links || [])].sort((a, b) => b.value - a.value)) {
    if (leads.some((lead) => lead.id === link.seed.id)) continue;
    // the title as the person wrote it in their own records
    leads.push({ id: link.seed.id, title: link.seed.item.title || link.seed.detail.title, rating: link.seed.rating });
    if (leads.length === 2) break;
  }
  const near = leads.length ? null : nearest(candidate);
  if (near) leads.push({ id: near.id, title: near.item.title || near.detail.title, rating: near.rating });
  const year = releaseYear(detail);
  const directors = candidate.directors || [];
  return {
    id: detail.id,
    title: detail.title || detail.original_title,
    originalTitle: detail.original_title && detail.original_title !== detail.title ? detail.original_title : "",
    year,
    runtime: detail.runtime || null,
    poster: detail.poster_path || "",
    overview: detail.overview || "",
    genres: (detail.genres || []).map((genre) => genre.name).slice(0, 2),
    director: directors.map((person) => directorName.get(person.id) || person.name).slice(0, 2).join(", "),
    favouriteDirector: candidate.director ? directorName.get(candidate.director.id) || candidate.director.name : "",
    leads: leads.map((lead) => ({ title: lead.title, stars: stars(lead.rating) })),
    countries: (detail.production_countries || []).slice(0, 2).map(countryName),
    voteAverage: detail.vote_average ? Math.round(detail.vote_average * 10) / 10 : null,
    voteCount: detail.vote_count || 0,
    score: candidate.score,
    where: candidate.where || null
  };
}
