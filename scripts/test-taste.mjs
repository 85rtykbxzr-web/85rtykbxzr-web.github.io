import assert from "node:assert/strict";
import { availability, parseCsv, pickMatch, ratingStats, readRatings } from "../src/taste-engine.mjs";

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

console.log("Taste checks passed (CSV formats, matching, providers, stats).");
