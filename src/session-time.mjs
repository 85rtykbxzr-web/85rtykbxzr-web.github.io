export function kstSessionStartMs(item) {
  const date = String(item?.date || "").trim();
  const time = String(item?.timeSort || item?.time || "").match(/\b\d{1,2}:\d{2}\b/)?.[0] || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return null;
  }
  const timestamp = Date.parse(`${date}T${time}:00+09:00`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isPastKstSession(item, nowMs = Date.now()) {
  const timestamp = kstSessionStartMs(item);
  return timestamp == null ? false : timestamp < nowMs;
}

export function isUpcomingKstSession(item, nowMs = Date.now()) {
  const timestamp = kstSessionStartMs(item);
  return timestamp != null && timestamp >= nowMs;
}
