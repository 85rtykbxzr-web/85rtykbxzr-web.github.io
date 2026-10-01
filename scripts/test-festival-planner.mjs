import assert from "node:assert/strict";
import { fitsBetween, gapBetween, placeOf, planDay, walkBetween } from "../src/festival-planner.mjs";
import { parseBiffDay, parseBiffFilm } from "./festival-biff.mjs";

const films = { a: { runtime: 82 }, b: { runtime: 85 }, c: { runtime: 99 } };
const s = (id, time, venue, filmId, extra = {}) => ({ id, date: "2026-10-08", time, venue, filmId, ...extra });

assert.equal(placeOf("영화의전당 하늘연극장").id, "bcc");
assert.equal(placeOf("신세계백화점 센텀시티점 9층 문화홀").id, "cgv");
assert.equal(walkBetween("영화의전당 하늘연극장", "영화의전당 시네마테크").same, true);
assert.equal(walkBetween("CGV센텀시티 1관", "롯데시네마 센텀시티 3관").minutes, walkBetween("롯데시네마 센텀시티 3관", "CGV센텀시티 1관").minutes);

const first = s("1", "09:00", "영화의전당 시네마테크", "a", { gv: true });
const second = s("2", "11:00", "롯데시네마 센텀시티 9관", "b");
const third = s("3", "12:50", "CGV센텀시티 5관", "c");
const clash = s("4", "13:10", "영화의전당 하늘연극장", "a");
const late = s("5", "18:00", "영화진흥위원회 표준시사실", "a");

assert.equal(gapBetween(first, second, films).status, "ok");
assert.equal(gapBetween(first, second, films).gvConflict, true);
assert.equal(gapBetween(second, third, films).status, "ok");
assert.equal(gapBetween(second, s("6", "12:30", "CGV센텀시티 5관", "c"), films).free, 5);
assert.equal(gapBetween(second, s("6", "12:30", "CGV센텀시티 5관", "c"), films).status, "tight");
assert.equal(gapBetween(third, clash, films).status, "overlap");
assert.equal(gapBetween(clash, late, films).status, "free");
assert.deepEqual(planDay([late, first, third], films).map((item) => item.session.id), ["1", "3", "5"]);
assert.equal(fitsBetween(s("7", "15:00", "영화의전당 소극장", "b"), clash, late, films), true);
assert.equal(fitsBetween(s("8", "17:00", "영화의전당 소극장", "b"), clash, late, films), false);

const day = `<div class="sch_li"><div class="sch_li_tit">영화의전당 루프씨어터</div><div class="sch_it sch_it4"><span class="code en" data-scode="003">003</span><div class="film_tit"><p class="time en">20:00</p><div><a href = "/kor/html/program/prog_view.asp?idx=91123&c_idx=429"><span class="film_tit_kor">룩백</span><span class="film_tit_eng en">Look Back</span></a></div></div><div class="grade"> <span class="ico_grade ico_g" title="전체 관람가">ALL</span>  <span class="ico_grade ico_ke" title="KE">KE</span>  <span class="gv_1"><span class="ico_grade ico_gv" title="GV">GV</span></span></div></div></div>`;
const [parsed] = parseBiffDay(day, "2026-10-07");
assert.equal(parsed.code, "003");
assert.equal(parsed.filmId, "91123");
assert.equal(parsed.gv, true);
assert.equal(parsed.title, "룩백");
assert.equal(parseBiffFilm('<div class="breadcrumb"><a href="prog_list.asp?c_idx=429"><span>갈라 프레젠테이션</span></a></div><dt>러닝타임</dt><dd>100min</dd>').runtime, 100);

console.log("Festival planner checks passed (places, walks, gaps, overlaps, fitting, BIFF parsing).");
