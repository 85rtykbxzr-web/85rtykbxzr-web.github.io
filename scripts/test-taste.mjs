import assert from "node:assert/strict";
import { availability, parseCsv, pickMatch, ratingStats, readRatings, runTaste } from "../src/taste-engine.mjs";

// CSV: quotes, doubled quotes, CRLF, BOM
assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n'), [["a", "b"], ["x, y", 'say "hi"']]);

// 왓챠피디아 (WatchaPedia Ratings Exporter)
const pedia = readRatings("type,title,year,rating,rated_at,genres,countries,content_code\nmovie,옵세션,2025,5,2026-09-22T20:00:44+09:00,공포|스릴러|로맨스,미국,m5mYj6B\nseries,나의 아저씨,2018,4.5,2025-01-01,드라마,한국,s1\n");
assert.equal(pedia.format, "watchapedia");
assert.deepEqual(pedia.items[0], { title: "옵세션", originalTitle: "", year: 2025, rating: 5, type: "movie", directors: [], genres: ["공포", "스릴러", "로맨스"], countries: ["미국"], date: "2026-09-22", code: "m5mYj6B" });
assert.equal(pedia.items[1].type, "tv");

// 왓챠피디아 (console script: ID,URL,Title,Type,Year,Directors,…)
const script = readRatings('ID,URL,Title,Type,Year,Directors,WatchedAt,Rating,Review,Spoiler,\n"m1","https://pedia.watcha.com/ko-KR/contents/m1","하나 그리고 둘","MOVIE","2000","에드워드 양","2024-03-01","5","","",\n');
assert.equal(script.items[0].title, "하나 그리고 둘");
assert.deepEqual(script.items[0].directors, ["에드워드 양"]);
assert.equal(script.items[0].rating, 5);

// Letterboxd ratings.csv
const lb = readRatings("Date,Name,Year,Letterboxd URI,Rating\n2024-01-02,Close-Up,1990,https://boxd.it/x,4.5\n");
assert.equal(lb.format, "letterboxd");
assert.equal(lb.items[0].title, "Close-Up");
assert.equal(lb.items[0].rating, 4.5);

// 10-point exports are halved
assert.equal(readRatings("title,rating\nA,8\nB,10\n").items[0].rating, 4);

// a file without a title column is refused with a clear message
assert.throws(() => readRatings("foo,bar\n1,2\n"), /제목 열/);

// TMDB matching: exact title within a year; a lone same-year top hit needs some votes
assert.equal(pickMatch([{ id: 1, title: "마더", original_title: "마더", release_date: "2009-05-28", vote_count: 3000 }], { title: "마더", year: 2009 })?.id, 1);
assert.equal(pickMatch([{ id: 2, title: "마더!", original_title: "mother!", release_date: "2017-09-13", vote_count: 6000 }], { title: "마더", year: 2009 }), null, "a different film with a similar title is not taken");

// providers: subscription first, rent only when asked
const detail = { "watch/providers": { results: { KR: { link: "https://x", flatrate: [{ provider_id: 97 }], rent: [{ provider_id: 356 }] } } } };
assert.deepEqual(availability(detail, ["watcha", "wavve"], false).services.map((service) => service.id), ["watcha"]);
assert.deepEqual(availability(detail, ["watcha", "wavve"], true).services.map((service) => `${service.id}:${service.mode}`), ["watcha:구독", "wavve:대여"]);
assert.deepEqual(availability(detail, ["netflix"], true).services, []);

// the average the ratings are weighed against
const stats = ratingStats(readRatings("title,year,rating\nA,1950,5\nB,1960,4\nC,2000,2\nD,2010,3\n").items);
assert.equal(stats.avg, 3.5);

// The whole run against a small made-up TMDB: six liked films and one disliked one.
// X is what the liked films point at; Y and Y2 are the same film twice over, except that the
// disliked film also points at Y, so Y has to come out below Y2. U isn't on the chosen
// service and S was already rated, so neither may appear.
{
  const drama = [{ id: 18, name: "드라마" }];
  const film = (id, title, extra = {}) => ({
    id, title, original_title: title, release_date: "2001-01-01", runtime: 110, vote_count: 700, vote_average: 7.6,
    genres: drama, production_countries: [{ iso_3166_1: "JP" }], original_language: "ja",
    keywords: { keywords: [{ id: 500 }, { id: 501 }] },
    credits: { crew: [{ id: 900 + id, job: "Director", name: `감독${id}` }], cast: [] },
    recommendations: { results: [] }, similar: { results: [] },
    "watch/providers": { results: { KR: { link: `https://tmdb.test/${id}`, flatrate: [{ provider_id: 8 }] } } },
    ...extra
  });
  const summary = (detail) => ({ id: detail.id, title: detail.title, original_title: detail.original_title, release_date: detail.release_date, vote_count: detail.vote_count, vote_average: detail.vote_average, genre_ids: [18] });
  const X = film(10, "엑스");
  const Y = film(11, "와이");
  const Y2 = film(12, "와이투");
  const U = film(13, "유", { "watch/providers": { results: { KR: { flatrate: [{ provider_id: 97 }] } } } });
  const S = film(14, "본 영화");
  const liked = Array.from({ length: 6 }, (_, index) => film(index + 1, `좋아한 영화 ${index + 1}`, {
    recommendations: { results: [X, U, S, ...(index === 5 ? [Y, Y2] : [])].map(summary) }
  }));
  const disliked = film(7, "별로인 영화", {
    genres: [{ id: 28, name: "액션" }], production_countries: [{ iso_3166_1: "US" }], original_language: "en",
    keywords: { keywords: [{ id: 700 }] }, recommendations: { results: [Y].map(summary) }
  });
  const all = [...liked, disliked, X, Y, Y2, U, S];
  const get = async (path, params = {}) => {
    if (path === "/search/movie") return { results: all.filter((entry) => entry.title === params.query).map(summary) };
    if (path === "/discover/movie") return { results: [] };
    const found = all.find((entry) => path === `/movie/${entry.id}`);
    if (!found) throw new Error(`unexpected ${path}`);
    return found;
  };
  const csv = ["title,year,rating", ...liked.map((entry) => `${entry.title},2001,5`), "별로인 영화,2001,1", "본 영화,2001,3"].join("\n");
  const { recs } = await runTaste({ items: readRatings(csv).items, selected: ["netflix"], get });
  const ids = recs.map((rec) => rec.id);
  assert.ok(ids.includes(X.id), "the film the liked ones point at is picked");
  assert.ok(!ids.includes(U.id), "a film not on the chosen service is left out");
  assert.ok(!ids.includes(S.id), "an already rated film is left out");
  assert.ok(ids.includes(Y2.id), "the twin with no disliked link is picked");
  assert.ok(!ids.includes(Y.id) || ids.indexOf(Y.id) > ids.indexOf(Y2.id), "a link from a disliked film counts against");
  assert.ok(recs.every((rec) => rec.where.services.some((service) => service.id === "netflix")));
  assert.equal(recs.find((rec) => rec.id === X.id).leads[0].stars, "★5");
  assert.match(recs.find((rec) => rec.id === X.id).leads[0].title, /^좋아한 영화 \d$/);
}

console.log("Taste checks passed (CSV formats, matching, providers, stats, a full run).");
