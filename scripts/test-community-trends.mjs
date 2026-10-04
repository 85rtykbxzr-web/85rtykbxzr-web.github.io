import assert from "node:assert/strict";
import { candidateMatches, countWeightedTerms, reviewSignal, stripFilmTitle, titleAliases } from "./update-community-trends.mjs";
import {
  activeLineupFestivals,
  buildFestivalDays,
  festivalAliasesFor,
  festivalCandidates,
  festivalMatches,
  mergeFestivalDays,
  parseBiffLineup,
  rankFestivalPicks
} from "./festival-picks.mjs";

const groups = [{ label: "strong", weight: 6, terms: ["강추", "최고"] }];

// Repeating one term must not outweigh distinct reactions.
assert.equal(countWeightedTerms("강추 ".repeat(20), groups).score, 3 * 6, "repeats are capped at three");
assert.equal(countWeightedTerms("강추 최고", groups).score, 12, "distinct terms both count");

// The film's own title is not a reaction.
assert.equal(stripFilmTitle("최악의 하루 재밌다", "최악의 하루").trim(), "재밌다");
assert.equal(stripFilmTitle("최악 의하루 재밌다", "최악의 하루").trim(), "재밌다", "spacing variants are removed");
assert.equal(stripFilmTitle("아무 글", "A"), "아무 글", "one-character titles are left alone");
assert.equal(stripFilmTitle("가격(할인)?", "가격(할인)?"), " ", "regex characters in a title are treated literally");

// A "?" or a sentiment word that belongs to the title must not change the verdict.
const question = reviewSignal({ title: "어떻게 해야 했을까? 재밌더라", body: "", comments: [] }, { filmTitle: "어떻게 해야 했을까?" });
assert.equal(question.questionLike, false, "a title's question mark is not a question");
assert(question.net > 0, "the real reaction still scores");
const own = reviewSignal({ title: "최고의 하루 봤음", body: "", comments: [] }, { filmTitle: "최고의 하루" });
assert.equal(own.net, 0, "a sentiment word inside the film title scores nothing");
const real = reviewSignal({ title: "최고의 하루 진짜 최고", body: "", comments: [] }, { filmTitle: "최고의 하루" });
assert(real.net > 0, "praise outside the title still scores");

// Real questions are still discounted.
assert.equal(reviewSignal({ title: "이거 볼만함?", body: "", comments: [] }).net, 0, "plain questions do not score");

// Gallery shorthand finds the film.
const film = (title) => ({ title, normalized: title.replace(/\([^)]*\)/g, "").replace(/[^\p{Letter}\p{Number}]+/gu, "").toLowerCase(), aliases: titleAliases(title) });
const pool = [film("셀린느와 줄리 배 타러 가다(2D)"), film("가능한 사랑"), film("사탄탱고(기획전)"), film("꿈꾸던 모험"), film("룩백(2D)"), film("나의 사적인 예술가")];
const hit = (text) => candidateMatches(text, pool).map((item) => item.title);
assert.deepEqual(hit("셀줄배 재밌네"), ["셀린느와 줄리 배 타러 가다(2D)"], "initials of each word");
assert.deepEqual(hit("가능사 어디서 함?"), ["가능한 사랑"], "first word plus the next initial");
assert.deepEqual(hit("사탱이나 또 볼까"), ["사탄탱고(기획전)"], "two-syllable short form as its own word");
assert.deepEqual(hit("꿈꾸모험 이런내용임?"), ["꿈꾸던 모험"], "a shortened first word");
assert.deepEqual(hit("사적인 예술가 봤음"), ["나의 사적인 예술가"], "a curated short title");
assert.deepEqual(hit("룩백 재관람"), ["룩백(2D)"], "two-letter titles as a word");
assert.deepEqual(hit("플룩백스 신곡"), [], "two-letter titles not inside other words");
assert.deepEqual(hit("노래 가사 좋다"), [], "no two-letter initials from two-word titles");

// Festival interest ranking.
const biffHtml = `
<div class="list_sec"><h3><strong> 경쟁 </strong><small>설명</small></h3><table><tbody>
<tr><th><b onclick="location.href='/kor/html/program/prog_view.asp?idx=1&c_idx=442&sp_idx=&QueryStep=2' ">라 그라디바 / La Gradiva</b></th></tr>
<tr><th><b onclick="location.href='/kor/html/program/prog_view.asp?idx=2&c_idx=442&sp_idx=&QueryStep=2' ">여름 / Summer</b></th></tr>
<tr><th><b onclick="location.href='/kor/html/program/prog_view.asp?idx=3&c_idx=442&sp_idx=&QueryStep=2' ">가능한 사랑 / Possible Love</b></th></tr>
</tbody></table></div>
<div class="list_sec"><h3><strong>오픈 시네마</strong></h3><table><tbody>
<tr><th><b onclick="location.href='/kor/html/program/prog_view.asp?idx=4&c_idx=437&sp_idx=&QueryStep=2' ">스파이럴 / The Spiral</b></th></tr>
</tbody></table></div>`;
const films = parseBiffLineup(biffHtml, "https://www.biff.kr/kor/html/program/prog_all_list.asp?allYear=2026");
assert.deepEqual(films.map((film) => film.title), ["라 그라디바", "여름", "가능한 사랑", "스파이럴"], "BIFF lineup titles are parsed");
assert.equal(films[0].section, "경쟁", "BIFF section is kept");
assert.equal(films[3].section, "오픈 시네마");
assert.equal(films[0].url, "https://www.biff.kr/kor/html/program/prog_view.asp?idx=1&c_idx=442&sp_idx=&QueryStep=2", "film link is absolute");

const biff = { id: "biff-2026", name: "부산국제영화제", startDate: "2026-10-06", endDate: "2026-10-15", lineup: { url: "https://www.biff.kr/", format: "biff" } };
assert.equal(activeLineupFestivals([biff], "2026-09-21").length, 0, "too early: more than two weeks before");
assert.equal(activeLineupFestivals([biff], "2026-09-22").length, 1, "two weeks before the start");
assert.equal(activeLineupFestivals([biff], "2026-10-16").length, 0, "after the end");

const aliases = festivalAliasesFor(biff);
const candidates = festivalCandidates(films).map((film) => ({ ...film, requiresAlias: film.title === "가능한 사랑" }));
const titles = (text) => festivalMatches(text, candidates, aliases).map((film) => film.title);
assert.deepEqual(titles("금요일 라그라디바 먹으면 만족"), ["라 그라디바"], "spacing differences still match");
assert.deepEqual(titles("올 여름 너무 덥다"), [], "a short title needs the festival named");
assert.deepEqual(titles("부국제 여름 표 구함"), ["여름"], "a short title counts next to the festival name");
assert.deepEqual(titles("가능한 사랑 재밌네"), [], "a film playing in Seoul needs the festival named");
assert.deepEqual(titles("부국제 가능한 사랑 GV"), ["가능한 사랑"]);

const window = { start: "2026-09-22", end: "2026-10-15" };
const posts = [
  { title: "라그라디바 양도", date: "2026-09-30", comments: [{}, {}] },
  { title: "라 그라디바 vs 스파이럴", date: "2026-09-30", comments: [] },
  { title: "스파이럴 야외상영 풀림", date: "2026-10-01", comments: [] },
  { title: "부국제 여름 구함", date: "2026-10-01", comments: [] },
  { title: "라그라디바 예전 글", date: "2026-09-01", comments: [] }
];
const days = buildFestivalDays(posts, candidates, aliases, window);
assert.equal(days["2026-09-30"]["라그라디바"].mentionCount, 2, "mentions are counted per post");
assert(!days["2026-09-01"], "posts before the window are ignored");
const merged = mergeFestivalDays({ "2026-09-29": { 여름: { title: "여름", mentionCount: 1, commentCount: 0 } }, "2026-09-10": {} }, days, ["2026-09-30", "2026-10-01"], window);
assert(!merged["2026-09-10"], "days outside the window are dropped");
assert(merged["2026-09-29"], "days not rescanned are kept");
const ranked = rankFestivalPicks(merged, candidates);
assert.deepEqual(ranked.map((item) => item.title), ["라 그라디바", "스파이럴", "여름"], "ranked by mentions");
assert.deepEqual(Object.keys(ranked[0]).sort(), ["englishTitle", "mentionCount", "rank", "section", "title", "url"]);

console.log("Community trend scoring tests passed (repeat cap, film-title stripping, question handling, festival interest ranking).");
