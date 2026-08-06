const dayMs = 24 * 60 * 60 * 1000;

function parseCalendarDate(dateString) {
  const match = String(dateString || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new TypeError(`Invalid calendar date: ${dateString}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function calendarDateString(date) {
  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(dateString, days) {
  const date = parseCalendarDate(dateString);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return calendarDateString(date);
}

export function calendarDaysBetween(startDateString, endDateString) {
  const diff = parseCalendarDate(endDateString).getTime() - parseCalendarDate(startDateString).getTime();
  return Math.max(0, Math.ceil(diff / dayMs));
}

export function addCalendarMonths(dateString, months) {
  const date = parseCalendarDate(dateString);
  date.setUTCMonth(date.getUTCMonth() + Number(months || 0));
  return calendarDateString(date);
}
