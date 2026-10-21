import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isSystemicDegradation } from "./refresh-isolation.mjs";

// the rule: up to a third of the cinemas may be degraded, more is an outage
assert.equal(isSystemicDegradation(0, 8), false);
assert.equal(isSystemicDegradation(1, 8), false, "one cinema failing must not stop the refresh");
assert.equal(isSystemicDegradation(2, 8), false);
assert.equal(isSystemicDegradation(3, 8), true, "three of eight at once is an outage");
assert.equal(isSystemicDegradation(1, 0), true, "failures with nothing expected are never fine");

// The audits on the committed data: one thin cinema passes with a warning, three emptied
// cinemas fail. Past dates are dropped first so the result doesn't depend on the clock.
const root = fileURLToPath(new URL("..", import.meta.url));
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const baseSchedule = JSON.parse(readFileSync(join(root, "data/schedule.json"), "utf8"));
baseSchedule.sessions = baseSchedule.sessions.filter((session) => !session.date || session.date >= today);
const health = readFileSync(join(root, "data/source-health.json"), "utf8");

function audits(schedule) {
  const dir = mkdtempSync(join(tmpdir(), "isolation-"));
  try {
    mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "data/schedule.json"), JSON.stringify(schedule));
    writeFileSync(join(dir, "data/source-health.json"), health);
    return ["audit-schedule.mjs", "audit-parser-quality.mjs"].map((script) => {
      try {
        execFileSync(process.execPath, [join(root, "scripts", script)], { cwd: dir, stdio: "pipe" });
        return true;
      } catch {
        return false;
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (audits(baseSchedule).every(Boolean)) {
  const count = (venueId) => baseSchedule.sessions.filter((session) => session.venueId === venueId).length;
  const [biggest, second, third] = [...new Set(baseSchedule.sessions.map((session) => session.venueId))].sort((a, b) => count(b) - count(a));
  const oneThin = {
    ...baseSchedule,
    sessions: [
      ...baseSchedule.sessions.filter((session) => session.venueId !== biggest),
      baseSchedule.sessions.find((session) => session.venueId === biggest)
    ]
  };
  assert.deepEqual(audits(oneThin), [true, true], `one cinema (${biggest}) below its floor must not fail the audits`);
  const threeEmpty = { ...baseSchedule, sessions: baseSchedule.sessions.filter((session) => ![biggest, second, third].includes(session.venueId)) };
  assert.deepEqual(audits(threeEmpty), [false, false], "three cinemas emptied at once must fail the audits");
  console.log("Refresh isolation checks passed (rule, one thin cinema passes, three empty fail).");
} else {
  console.log("Refresh isolation rule checks passed; scenario skipped because the committed data doesn't pass the audits as is.");
}
