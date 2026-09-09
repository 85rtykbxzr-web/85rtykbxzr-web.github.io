import assert from "node:assert/strict";
import { validatePayloads } from "./verify-public-site-freshness.mjs";

const timestamp = "2026-09-09T01:30:00.000Z";
const nowMs = Date.parse(timestamp) + 30 * 60_000;
const limits = { schedule: 12, seats: 2, trends: 36, source: 36 };
const payload = {
  health: {
    ok: true,
    mode: "static",
    indexable: true,
    deploymentId: "12345",
    deploymentCommit: "a".repeat(40),
    builtAt: timestamp,
    scheduleGeneratedAt: timestamp,
    seatStatusVerifiedAt: timestamp,
    trendsGeneratedAt: timestamp,
    sourceHealthCheckedAt: timestamp
  },
  schedule: {
    meta: { generatedAt: timestamp, seatStatusVerifiedAt: timestamp },
    sessions: [{ id: "screening" }],
    venues: [{ id: "venue" }]
  },
  trends: { generatedAt: timestamp, items: [{}, {}, {}, {}] },
  sourceHealth: { checkedAt: timestamp, health: [{ sourceId: "source", checkedAt: timestamp }] }
};

assert.equal(validatePayloads(payload, limits, nowMs).indexable, true);
assert.throws(() => validatePayloads(payload, { ...limits, indexable: false }, nowMs), /indexable must be false/);
const preview = structuredClone(payload);
preview.health.indexable = false;
assert.equal(validatePayloads(preview, { ...limits, indexable: false }, nowMs).indexable, false);
assert.throws(() => validatePayloads(preview, limits, nowMs), /indexable must be true/);

// Preview mode must retain every production freshness limit.
for (const [target, field, maximumHours] of [
  ["schedule", "generatedAt", 12],
  ["schedule", "seatStatusVerifiedAt", 2],
  ["trends", "generatedAt", 36],
  ["sourceHealth", "checkedAt", 36]
]) {
  const stale = structuredClone(preview);
  const record = target === "schedule" ? stale.schedule.meta : stale[target];
  record[field] = new Date(nowMs - (maximumHours + 1) * 3_600_000).toISOString();
  assert.throws(() => validatePayloads(stale, { ...limits, indexable: false }, nowMs), /old; limit is/);
}

console.log("Site health checks passed for production, preview, and stale data rejection.");
