import { strict as assert } from "node:assert";
import { isPastKstSession, isUpcomingKstSession, kstSessionStartMs } from "../src/session-time.mjs";

const nowMs = Date.parse("2026-08-19T06:30:00.000Z");

assert.equal(kstSessionStartMs({ date: "2026-08-19", time: "15:29" }), Date.parse("2026-08-19T06:29:00.000Z"));
assert.equal(kstSessionStartMs({ date: "2026-08-19", timeSort: "15:31", time: "09:00" }), Date.parse("2026-08-19T06:31:00.000Z"));
assert.equal(kstSessionStartMs({ date: "2026-02-30", time: "15:30" }), null);
assert.equal(kstSessionStartMs({ date: "2026-08-19", time: "24:00" }), null);
assert.equal(isPastKstSession({ date: "2026-08-19", time: "15:29" }, nowMs), true);
assert.equal(isPastKstSession({ date: "2026-08-19", time: "15:30" }, nowMs), false);
assert.equal(isUpcomingKstSession({ date: "2026-08-19", time: "15:30" }, nowMs), true);
assert.equal(isUpcomingKstSession({ date: "2026-08-19", time: "15:29" }, nowMs), false);

console.log("Session time checks passed.");
