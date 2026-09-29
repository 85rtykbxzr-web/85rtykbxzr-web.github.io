import assert from "node:assert/strict";
import { countWeightedTerms, reviewSignal, stripFilmTitle } from "./update-community-trends.mjs";

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

console.log("Community trend scoring tests passed (repeat cap, film-title stripping, question handling).");
