// One cinema's trouble should cost that cinema, not the whole site. When a single source fails
// or comes back thinner than its safety floor, the refresh keeps that cinema's stored sessions,
// says so in the source health, and publishes everything else. Only when a large share of the
// cinemas go wrong at once (a network outage, a shared booking system change) is the refresh
// treated as broken and nothing is published.
export const maxDegradedShare = 1 / 3;

export function isSystemicDegradation(degradedCount, totalCount) {
  const total = Number(totalCount) || 0;
  const degraded = Number(degradedCount) || 0;
  if (total <= 0) return degraded > 0;
  return degraded / total > maxDegradedShare;
}
