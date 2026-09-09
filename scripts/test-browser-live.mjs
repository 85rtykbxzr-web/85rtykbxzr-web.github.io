import assert from "node:assert/strict";
import { readCafe24Challenge } from "./cafe24-challenge.mjs";
import { browserLiveConfigs, prepareBrowserLiveSchedule, deferredBrowserHealth, assertBrowserCollectionContract, fetchBrowserVenue, refreshBrowserLiveSchedule } from "../src/browser-live-schedule.mjs";

const fixture = {
  meta: { generatedAt: "2026-09-09T02:00:00Z" },
  venues: [...browserLiveConfigs.map((config) => ({ id: config.venueId })), { id: "cinecube" }],
  sources: browserLiveConfigs.map((config) => ({ id: config.sourceId, venueId: config.venueId })),
  sessions: [{ id: "old-momo", venueId: "momo" }, { id: "core", venueId: "cinecube", date: "2026-09-12", timeSort: "10:00" }]
};
const prepared = prepareBrowserLiveSchedule(fixture);
assert.deepEqual(prepared.sessions.map((session) => session.id), ["core"]);
assert.equal(fixture.sessions.length, 2, "Preparing cloud data must not mutate the original");
const health = { health: deferredBrowserHealth("2026-09-09T02:00:00Z") };
assertBrowserCollectionContract(prepared, health);
assert.throws(() => assertBrowserCollectionContract({ ...prepared, sessions: fixture.sessions }, health), /unverified/);
assert.throws(() => assertBrowserCollectionContract(prepared, { health: health.health.slice(1) }), /incomplete/);
assert.throws(() => assertBrowserCollectionContract(fixture, health), /explicit/);
const falseHealth = structuredClone(health);
falseHealth.health[0].ok = true;
assert.throws(() => assertBrowserCollectionContract(prepared, falseHealth), /claims server verification/);

const now = new Date("2026-09-09T02:00:00Z");
const requests = [];
const fetchImpl = async (url, options) => {
  assert.equal(options.credentials, "omit");
  const parsed = new URL(url);
  requests.push(parsed);
  const date = parsed.searchParams.get("PlaySDT");
  const dates = ["2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15"];
  const Recordset = date ? Array.from({ length: 8 }, (_, index) => ({
    PlaySDT: date, StartTime: `${10 + index}:00`, MovieNm: `Film ${index}`, MovieCd: `movie${index}`, ScreenCd: "01", ShowSeq: index + 1, NextSkipYn: "Y", SeatRemainCnt: index, TotalSeatCnt: 50
  })) : [...dates.map((PlaySDT) => ({ PlaySDT, HiddenYn: "N", RestYn: "Y" })), { PlaySDT: "2026-09-16", HiddenYn: "Y", RestYn: "N" }];
  return { ok: true, json: async () => ({ RetCode: "success", Recordset }) };
};
const momo = await fetchBrowserVenue(browserLiveConfigs[0], { fetchImpl, now });
assert.equal(momo.sessions.length, 32, "Published holiday dates must not disappear");
assert(!requests.some((url) => url.searchParams.get("PlaySDT") === "2026-09-16"), "Hidden dates must not be queried");
assert.equal(momo.sessions[0].status, "soldout");
assert.equal(momo.sessions[1].status, "confirmed");
await assert.rejects(() => fetchBrowserVenue(browserLiveConfigs[0], { now, fetchImpl: async () => ({ ok: true, json: async () => ({ RetCode: "failed", Recordset: [] }) }) }), /응답/);
await assert.rejects(() => fetchBrowserVenue(browserLiveConfigs[0], { now, fetchImpl: async (url, options) => {
  const result = await fetchImpl(url, options);const body = await result.json();
  if (new URL(url).searchParams.has("PlaySDT")) body.Recordset.push(body.Recordset[0]);
  return { ok: true, json: async () => body };
} }), /중복/);
const partial = await refreshBrowserLiveSchedule(prepared, { now, fetchImpl: (url, options) => {
  if (new URL(url).searchParams.get("CinemaCd") === "000065") throw new Error("offline");
  return fetchImpl(url, options);
} });
assert.equal(partial.meta.browserLive.filter((row) => row.status === "ok").length, 6);
assert.equal(partial.meta.browserLive.find((row) => row.venueId === "forest").checkedAt, null);
assert(!partial.sessions.some((session) => session.venueId === "forest"));
assert(partial.sessions.some((session) => session.id === "core"));
assert.equal(partial.meta.generatedAt, fixture.meta.generatedAt, "Browser fetch must not falsify the server verification timestamp");

const url = "https://www.cinematheque.seoul.kr/bbs/content.php?co_id=timetable";
const challenge = `<script src="/cupid.js"></script><script>var a=toNumbers("2b7e151628aed2a6abf7158809cf4f3c"),b=toNumbers("000102030405060708090a0b0c0d0e0f"),c=toNumbers("7649abac8119b246cee98e9b12e9197d");document.cookie="CUPID=";location.href="${url}&ckattempt=1";</script>`;
assert.equal(readCafe24Challenge(challenge, url).cookie, "CUPID=6bc1bee22e409f96e93d7e117393172a");
assert.equal(readCafe24Challenge(challenge, "https://example.com/"), null);
assert.throws(() => readCafe24Challenge(challenge.replace(`${url}&ckattempt=1`, "https://example.com/?ckattempt=1"), url), /outside/);
assert.equal(readCafe24Challenge("<html>normal timetable</html>", url), null);
console.log("Browser-live contract, holiday coverage, failure isolation, freshness, and host challenge checks passed.");
