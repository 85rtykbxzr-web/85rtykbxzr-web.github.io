// Festival planner logic: where each screening is, how long the walk between them takes,
// and what a day of picked screenings looks like (overlaps, tight walks, free time).
// Pure functions; the sheet that shows them lives in festival-planner-ui.mjs.

// BIFF venues cluster around Centum City. Walking minutes are estimates from the street
// layout (door to door, a little slack for lifts and crossings); the UI says so and links
// to a Kakao Map route for the exact walk.
export const biffPlaces = [
  { id: "bcc", short: "영화의전당", name: "영화의전당", match: /^영화의전당/, map: "영화의전당" },
  { id: "cgv", short: "CGV", name: "CGV 센텀시티", match: /^CGV센텀시티|^신세계백화점 센텀시티/, map: "신세계센텀시티" },
  { id: "lotte", short: "롯데시네마", name: "롯데시네마 센텀시티", match: /^롯데시네마 센텀시티/, map: "롯데백화점 센텀시티점" },
  { id: "kofic", short: "영진위", name: "영화진흥위원회", match: /^영화진흥위원회/, map: "영화진흥위원회" },
  { id: "bmc", short: "미디어센터", name: "부산시청자미디어센터", match: /^부산시청자미디어센터/, map: "부산시청자미디어센터" },
  { id: "sohyang", short: "소향씨어터", name: "소향씨어터", match: /^소향씨어터/, map: "소향씨어터" },
  { id: "dongseo", short: "동서대", name: "동서대 센텀캠퍼스", match: /^동서대학교/, map: "동서대학교 센텀캠퍼스" }
];

const walkMinutes = {
  "bcc-cgv": 7, "bcc-lotte": 9, "bcc-kofic": 10, "bcc-bmc": 10, "bcc-sohyang": 12, "bcc-dongseo": 12,
  "cgv-lotte": 5, "cgv-kofic": 9, "cgv-bmc": 9, "cgv-sohyang": 9, "cgv-dongseo": 10,
  "lotte-kofic": 10, "lotte-bmc": 10, "lotte-sohyang": 10, "lotte-dongseo": 11,
  "kofic-bmc": 5, "kofic-sohyang": 6, "kofic-dongseo": 5,
  "bmc-sohyang": 6, "bmc-dongseo": 6, "sohyang-dongseo": 5
};
// halls inside one place: 영화의전당's halls sit in separate buildings
const sameVenueMinutes = { bcc: 4, cgv: 2, lotte: 2 };

export const ENTRY_BUFFER = 5; // find the seat, buy water
export const GV_MINUTES = 30;
export const FREE_GAP = 80; // a gap this long is worth filling
const DEFAULT_RUNTIME = 100;

export function placeOf(venue, places = biffPlaces) {
  return places.find((place) => place.match.test(String(venue || ""))) || { id: "other", short: String(venue || "").split(" ")[0] || "기타", name: String(venue || "").split(" ")[0] || "기타", map: String(venue || "") };
}

export function hallOf(venue, place) {
  const rest = String(venue || "").replace(/^(영화의전당|CGV센텀시티|롯데시네마 센텀시티)\s*/, "");
  return place.id === "bcc" || place.id === "cgv" || place.id === "lotte" ? rest : "";
}

export function walkBetween(fromVenue, toVenue, places = biffPlaces) {
  const from = placeOf(fromVenue, places);
  const to = placeOf(toVenue, places);
  if (fromVenue === toVenue) return { minutes: 0, from, to, same: true };
  if (from.id === to.id) return { minutes: sameVenueMinutes[from.id] ?? 3, from, to, same: true };
  const minutes = walkMinutes[`${from.id}-${to.id}`] ?? walkMinutes[`${to.id}-${from.id}`] ?? 15;
  return { minutes, from, to, same: false };
}

export function toMinutes(time) {
  const [hours, minutes] = String(time || "0:0").split(":").map(Number);
  return hours * 60 + minutes;
}

export function formatMinutes(total) {
  const hours = Math.floor(total / 60) % 24;
  return `${String(hours).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function durationLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}시간${rest ? ` ${rest}분` : ""}` : `${rest}분`;
}

export function screeningSpan(session, films = {}) {
  const runtime = Number(films[session.filmId]?.runtime) || 0;
  const start = toMinutes(session.time);
  return { start, end: start + (runtime || DEFAULT_RUNTIME), runtimeKnown: Boolean(runtime), runtime: runtime || DEFAULT_RUNTIME };
}

// What happens between two picked screenings on one day.
export function gapBetween(previous, next, films = {}) {
  const a = screeningSpan(previous, films);
  const b = screeningSpan(next, films);
  const walk = walkBetween(previous.venue, next.venue);
  const free = b.start - a.end;
  const need = walk.minutes + ENTRY_BUFFER;
  let status = "ok";
  if (free < 0) status = "overlap";
  else if (free < need) status = "tight";
  else if (free >= need + FREE_GAP) status = "free";
  const gvConflict = Boolean(previous.gv) && status !== "overlap" && free < need + GV_MINUTES;
  return { free, need, walk, status, gvConflict, from: a.end, to: b.start };
}

export function planDay(picked, films = {}) {
  const items = [...picked].sort((x, y) => toMinutes(x.time) - toMinutes(y.time));
  return items.map((session, index) => ({
    session,
    span: screeningSpan(session, films),
    gap: index ? gapBetween(items[index - 1], session, films) : null
  }));
}

// Screenings that fit into a free stretch, allowing for the walks on both sides.
export function fitsBetween(candidate, previous, next, films = {}) {
  const span = screeningSpan(candidate, films);
  if (previous) {
    const prev = screeningSpan(previous, films);
    if (span.start < prev.end + walkBetween(previous.venue, candidate.venue).minutes + ENTRY_BUFFER) return false;
  }
  if (next) {
    const after = screeningSpan(next, films);
    if (span.end + walkBetween(candidate.venue, next.venue).minutes + ENTRY_BUFFER > after.start) return false;
  }
  return true;
}

export function overlapsAny(candidate, picked, films = {}) {
  const span = screeningSpan(candidate, films);
  return picked.some((other) => {
    if (other.id === candidate.id || other.date !== candidate.date) return false;
    const o = screeningSpan(other, films);
    return span.start < o.end && o.start < span.end;
  });
}
