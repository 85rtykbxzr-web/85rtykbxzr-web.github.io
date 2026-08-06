import { chooseSeatSnapshot, scheduleIdentity } from "./preserve-deployed-seat-snapshot.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fixture({ generatedAt, seatStatusVerifiedAt, status = "confirmed", title = "같은 영화" }) {
  return {
    meta: { generatedAt, seatStatusVerifiedAt, title: "CINE SEOUL Schedule" },
    venues: [{ id: "venue", name: "극장" }],
    sources: [{ id: "source", lastSeatCheckedAt: seatStatusVerifiedAt }],
    sessions: [{ id: "session", date: "2026-08-06", time: "12:00", venueId: "venue", title, status }]
  };
}

const nowMs = Date.parse("2026-08-06T04:00:00.000Z");
const generatedAt = "2026-08-06T03:00:00.000Z";
const committed = fixture({ generatedAt, seatStatusVerifiedAt: "2026-08-06T03:00:00.000Z" });
const publicNewer = fixture({ generatedAt, seatStatusVerifiedAt: "2026-08-06T03:45:00.000Z", status: "soldout" });
const selectedPublic = chooseSeatSnapshot({ localSchedule: committed, publicSchedule: publicNewer, nowMs });

assert(selectedPublic.source === "public" && selectedPublic.changed, "newer matching public snapshot must win");
assert(selectedPublic.schedule.sessions[0].status === "soldout", "public seat status must be preserved");
assert(scheduleIdentity(committed, nowMs) === scheduleIdentity(publicNewer, nowMs), "seat-only fields must not change schedule identity");

const differentSchedule = fixture({
  generatedAt,
  seatStatusVerifiedAt: "2026-08-06T03:50:00.000Z",
  title: "다른 영화"
});
const selectedCommitted = chooseSeatSnapshot({ localSchedule: committed, publicSchedule: differentSchedule, nowMs });
assert(selectedCommitted.source === "committed", "different public schedule must not replace committed data");

const staleCommitted = fixture({ generatedAt, seatStatusVerifiedAt: "2026-08-06T00:00:00.000Z" });
let rejectedStale = false;
try {
  chooseSeatSnapshot({ localSchedule: staleCommitted, publicSchedule: differentSchedule, nowMs });
} catch (error) {
  rejectedStale = /limit is 120 minutes/.test(error.message);
}
assert(rejectedStale, "stale committed data must block deployment when public snapshot is unsafe");

const afterMidnightMs = Date.parse("2026-08-06T15:30:00.000Z");
const beforeMidnightSession = {
  id: "past-session",
  date: "2026-08-06",
  time: "23:30",
  venueId: "venue",
  title: "어제 영화",
  status: "confirmed"
};
const afterMidnightLocal = {
  ...fixture({ generatedAt, seatStatusVerifiedAt: "2026-08-06T15:00:00.000Z" }),
  meta: {
    generatedAt,
    seatStatusVerifiedAt: "2026-08-06T15:00:00.000Z",
    rangeStart: "2026-08-06",
    rangeEnd: "2026-08-07",
    rangeLabel: "2026.08.06 - 08.07"
  },
  sessions: [
    beforeMidnightSession,
    {
      id: "session",
      date: "2026-08-07",
      time: "12:00",
      venueId: "venue",
      title: "같은 영화",
      status: "confirmed"
    }
  ],
  festivals: [
    { id: "past-festival", date: "2026-08-06", title: "어제 영화제" },
    { id: "current-festival", date: "2026-08-07", title: "오늘 영화제" }
  ]
};
const afterMidnightPublic = {
  ...afterMidnightLocal,
  meta: {
    ...afterMidnightLocal.meta,
    seatStatusVerifiedAt: "2026-08-06T15:20:00.000Z",
    rangeStart: "2026-08-07",
    rangeEnd: "2026-08-07",
    rangeLabel: "2026.08.07 - 08.07"
  },
  sessions: [{ ...afterMidnightLocal.sessions[1], status: "soldout" }],
  festivals: [afterMidnightLocal.festivals[1]]
};
const selectedAfterMidnight = chooseSeatSnapshot({
  localSchedule: afterMidnightLocal,
  publicSchedule: afterMidnightPublic,
  nowMs: afterMidnightMs
});
assert(selectedAfterMidnight.source === "public", "a newer post-midnight public snapshot must be reusable");
assert(selectedAfterMidnight.schedule.sessions.length === 1, "past sessions must remain pruned after midnight");
assert(selectedAfterMidnight.schedule.meta.rangeStart === "2026-08-07", "range metadata must follow the pruned schedule");

console.log("Seat snapshot selection tests passed.");
