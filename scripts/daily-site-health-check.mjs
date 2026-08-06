import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fetchWithTransientRetry } from "./http-retry.mjs";
import { isNonBlockingSourceHealthWarning } from "./source-health-status.mjs";

const primaryOrigin = trimTrailingSlash(process.env.SEOUL_CINEMA_SITE_URL || "https://seoulcinemaschedule.com");
const pagesOrigin = trimTrailingSlash(
  process.env.SEOUL_CINEMA_PAGES_ORIGIN || "https://seoul-cinema-schedule-b580e1.gitlab.io"
);
const secondaryOrigin = trimTrailingSlash(
  process.env.SEOUL_CINEMA_SECONDARY_URL ||
    process.env.CI_PAGES_URL ||
    pagesOrigin
);
const secondaryLabel = process.env.SEOUL_CINEMA_SECONDARY_LABEL || "GitLab Pages";
const maxScheduleAgeHours = numberEnv("SEOUL_CINEMA_MAX_SCHEDULE_AGE_HOURS", 36);
const maxSeatAgeHours = numberEnv("SEOUL_CINEMA_MAX_SEAT_AGE_HOURS", 2);
const maxTrendAgeHours = numberEnv("SEOUL_CINEMA_MAX_TREND_AGE_HOURS", 36);
const maxHealthAgeHours = numberEnv("SEOUL_CINEMA_MAX_HEALTH_AGE_HOURS", 36);
const staleRangeGraceUntilHourKst = numberEnv("SEOUL_CINEMA_STALE_RANGE_GRACE_UNTIL_HOUR_KST", 11);
const requestTimeoutMs = numberEnv("SEOUL_CINEMA_HEALTH_REQUEST_TIMEOUT_MS", 8000);
const requestAttempts = Math.floor(numberEnv("SEOUL_CINEMA_HEALTH_REQUEST_ATTEMPTS", 3));
const requestRetryDelayMs = numberEnv("SEOUL_CINEMA_HEALTH_RETRY_DELAY_MS", 750);
const posterConcurrency = numberEnv("SEOUL_CINEMA_POSTER_CONCURRENCY", 8);
const posterRequestAttempts = Math.floor(numberEnv("SEOUL_CINEMA_POSTER_REQUEST_ATTEMPTS", 2));
const probeSchedulePosters = process.env.SEOUL_CINEMA_PROBE_SCHEDULE_POSTERS !== "0";
const strictSchedulePosters =
  process.argv.includes("--strict-schedule-posters") || process.env.SEOUL_CINEMA_STRICT_SCHEDULE_POSTERS === "1";
const jsonOutput = process.argv.includes("--json");
const parserQualityScript = fileURLToPath(new URL("./audit-parser-quality.mjs", import.meta.url));
const minimumHstsMaxAgeSeconds = 2_592_000;

const failures = [];
const warnings = [];
const checks = [];

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function pass(name, detail = "") {
  checks.push({ status: "PASS", name, detail });
}

function warn(name, detail = "") {
  warnings.push(detail ? `${name}: ${detail}` : name);
  checks.push({ status: "WARN", name, detail });
}

function fail(name, detail = "") {
  failures.push(detail ? `${name}: ${detail}` : name);
  checks.push({ status: "FAIL", name, detail });
}

function nowKstParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })
    .formatToParts(new Date())
    .reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function parseDate(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : null;
}

function ageHours(value) {
  const time = parseDate(value);
  if (!time) return null;
  return (Date.now() - time) / 36e5;
}

function formatAge(hours) {
  return `${hours.toFixed(1)}h`;
}

function yesterday(dateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function fetchText(url) {
  const response = await fetchWithTransientRetry(
    url,
    {
      cache: "no-store",
      headers: { accept: "text/html,application/javascript,application/json;q=0.9,*/*;q=0.8" }
    },
    {
      attempts: requestAttempts,
      requestTimeoutMs,
      retryDelayMs: requestRetryDelayMs
    }
  );
  const text = await response.text();
  return { response, text };
}

async function fetchJson(url) {
  const { response, text } = await fetchText(url);
  try {
    return { response, json: JSON.parse(text) };
  } catch (error) {
    throw new Error(`${url} did not return valid JSON: ${error.message}`);
  }
}

async function fetchHead(url, { headers = {}, cache = "no-store" } = {}) {
  return fetchWithTransientRetry(
    url,
    { method: "HEAD", cache, headers },
    {
      attempts: requestAttempts,
      requestTimeoutMs,
      retryDelayMs: requestRetryDelayMs
    }
  );
}

function validateHeader(response, name, expected) {
  const value = response.headers.get(name) || "";
  const valid = typeof expected === "string" ? value.toLowerCase() === expected.toLowerCase() : expected(value);
  if (valid) pass(`custom domain ${name}`, value);
  else fail(`custom domain ${name}`, value || "missing");
}

async function validatePrimaryEdge() {
  const root = await fetchHead(`${primaryOrigin}/`);
  validateHeader(root, "server", (value) => /cloudflare/i.test(value));
  validateHeader(root, "cf-ray", (value) => Boolean(value));
  validateHeader(root, "content-security-policy", (value) =>
    ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"].every((token) => value.includes(token))
  );
  validateHeader(root, "x-content-type-options", "nosniff");
  validateHeader(root, "x-frame-options", "DENY");
  validateHeader(root, "referrer-policy", "strict-origin-when-cross-origin");
  validateHeader(root, "permissions-policy", (value) =>
    ["camera=()", "microphone=()", "geolocation=()", "payment=()", "usb=()"].every((token) => value.includes(token))
  );
  validateHeader(root, "strict-transport-security", (value) => {
    const maxAge = Number(value.match(/(?:^|;)\s*max-age=(\d+)/i)?.[1] || 0);
    return maxAge >= minimumHstsMaxAgeSeconds;
  });

  const compressed = await fetchHead(`${primaryOrigin}/data/schedule.json`, {
    headers: { "accept-encoding": "br" }
  });
  validateHeader(compressed, "content-encoding", "br");

  const cachedAsset = await fetchHead(`${primaryOrigin}/assets/app.js`, {
    headers: { "accept-encoding": "br" },
    cache: "default"
  });
  validateHeader(cachedAsset, "cf-cache-status", (value) => /^(?:HIT|MISS|EXPIRED|REVALIDATED|STALE|UPDATING)$/i.test(value));

  const acmeProbe = await fetchWithTransientRetry(
    `${primaryOrigin}/.well-known/acme-challenge/codex-health-probe`,
    { cache: "no-store", redirect: "follow" },
    {
      attempts: requestAttempts,
      requestTimeoutMs,
      retryDelayMs: requestRetryDelayMs
    }
  );
  await acmeProbe.body?.cancel?.();
  if (acmeProbe.status === 403 || acmeProbe.status === 429 || acmeProbe.status >= 500) {
    fail("custom domain ACME path", `HTTP ${acmeProbe.status}`);
  } else {
    pass("custom domain ACME path", `HTTP ${acmeProbe.status}`);
  }
}

async function validatePagesCanonicalRedirect() {
  const response = await fetchWithTransientRetry(
    `${pagesOrigin}/`,
    { cache: "no-store", redirect: "manual" },
    {
      attempts: requestAttempts,
      requestTimeoutMs,
      retryDelayMs: requestRetryDelayMs
    }
  );
  await response.body?.cancel?.();
  const location = response.headers.get("location") || "";
  let locationOrigin = "";
  try {
    locationOrigin = new URL(location, pagesOrigin).origin;
  } catch {
    // The failure below reports the malformed or missing Location value.
  }
  const expectedOrigin = new URL(primaryOrigin).origin;
  if (response.status === 308 && locationOrigin === expectedOrigin) {
    pass("GitLab Pages canonical redirect", `HTTP 308 -> ${location}`);
  } else {
    fail("GitLab Pages canonical redirect", `HTTP ${response.status}; Location ${location || "missing"}`);
  }
}

async function checkImageUrl(url, label) {
  if (!isHttpUrl(url)) return { ok: false, label, url, detail: "not an http(s) URL" };
  try {
    const response = await fetchWithTransientRetry(
      url,
      {
        cache: "no-store",
        headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.1" }
      },
      {
        attempts: posterRequestAttempts,
        requestTimeoutMs,
        retryDelayMs: requestRetryDelayMs
      }
    );
    const contentType = response.headers.get("content-type") || "";
    await response.body?.cancel?.();
    if (!response.ok) return { ok: false, label, url, detail: `HTTP ${response.status}` };
    if (!/^image\//i.test(contentType)) return { ok: false, label, url, detail: `content-type ${contentType || "missing"}` };
    return { ok: true, label, url, detail: `${response.status} ${contentType}` };
  } catch (error) {
    return { ok: false, label, url, detail: error.message || String(error) };
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function isRecommendationPosterUrl(value) {
  return isHttpUrl(value) || /^\/assets\/recommendation-posters\/[A-Za-z0-9._-]+\.webp$/i.test(String(value || ""));
}

function runCommand(command, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: error.message }));
  });
}

async function runNpmAudit(scriptName, { label = `local ${scriptName}`, env = {} } = {}) {
  const result = await runCommand("npm", ["run", scriptName, "--silent"], env);
  recordAuditResult(label, result);
}

async function runProductionParserAudit(origin) {
  const result = await runCommand(process.execPath, [parserQualityScript], {
    SEOUL_CINEMA_AUDIT_SCHEDULE_URL: `${origin}/data/schedule.json`,
    SEOUL_CINEMA_AUDIT_SOURCE_HEALTH_URL: `${origin}/data/source-health.json`
  });
  recordAuditResult("production audit:parser-quality", result);
}

function recordAuditResult(label, result) {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (result.code === 0) {
    const summary = summarizeCommandOutput(output);
    try {
      const parsed = JSON.parse(output);
      if (Array.isArray(parsed.warnings) && parsed.warnings.length) {
        warn(label, `${summary}; ${parsed.warnings.slice(0, 3).join(" | ")}`);
        return;
      }
    } catch {
      // Non-JSON command output is summarized as a normal pass.
    }
    pass(label, summary);
  } else {
    fail(label, output.split("\n").slice(0, 8).join(" | "));
  }
}

function summarizeCommandOutput(output) {
  if (!output) return "";
  try {
    const parsed = JSON.parse(output);
    if (parsed.ok) {
      const bits = [];
      if (parsed.sessions) bits.push(`${parsed.sessions} sessions`);
      if (parsed.venues) bits.push(`${parsed.venues} venues`);
      if (parsed.grades) bits.push(`grades ${JSON.stringify(parsed.grades)}`);
      if (parsed.referencedAssets) bits.push(`${parsed.referencedAssets} assets`);
      return bits.join(", ") || "ok";
    }
  } catch {
    // Keep a compact text summary for non-JSON tools such as smoke.
  }
  return output.split("\n").at(-1)?.slice(0, 180) || "ok";
}

function validateAge(label, generatedAt, maxHours) {
  const age = ageHours(generatedAt);
  if (age === null) {
    fail(`${label} timestamp`, `missing or invalid generatedAt/checkedAt: ${generatedAt || "(empty)"}`);
    return;
  }
  if (age > maxHours) fail(`${label} freshness`, `${generatedAt} is ${formatAge(age)} old; limit ${maxHours}h`);
  else pass(`${label} freshness`, `${generatedAt} (${formatAge(age)} old)`);
}

function validateScheduleData(schedule, label) {
  const kst = nowKstParts();
  const sessions = Array.isArray(schedule.sessions) ? schedule.sessions : [];
  const venues = Array.isArray(schedule.venues) ? schedule.venues : [];
  const sources = Array.isArray(schedule.sources) ? schedule.sources : [];
  validateAge(`${label} schedule`, schedule.meta?.generatedAt, maxScheduleAgeHours);
  validateAge(`${label} seat status`, schedule.meta?.seatStatusVerifiedAt, maxSeatAgeHours);

  if (venues.length < 15) fail(`${label} venue count`, `${venues.length}/15`);
  else pass(`${label} venue count`, `${venues.length}`);

  if (sources.length < 20) fail(`${label} source count`, `${sources.length}/20`);
  else pass(`${label} source count`, `${sources.length}`);

  if (sessions.length < 500) fail(`${label} session count`, `${sessions.length}/500`);
  else pass(`${label} session count`, `${sessions.length}`);

  const rangeStart = schedule.meta?.rangeStart || "";
  const rangeEnd = schedule.meta?.rangeEnd || "";
  if (rangeEnd && rangeEnd < kst.date) fail(`${label} range`, `${rangeStart} - ${rangeEnd} does not include ${kst.date}`);
  else pass(`${label} range end`, rangeEnd || "(missing)");

  if (rangeStart && rangeStart < kst.date) {
    const onlyYesterday = rangeStart === yesterday(kst.date);
    if (onlyYesterday && kst.hour < staleRangeGraceUntilHourKst) {
      warn(`${label} range start`, `${rangeStart}; before ${staleRangeGraceUntilHourKst}:00 KST grace window`);
    } else {
      fail(`${label} range start`, `${rangeStart}; expected ${kst.date} after daily refresh`);
    }
  } else if (rangeStart) {
    pass(`${label} range start`, rangeStart);
  } else {
    fail(`${label} range start`, "missing");
  }

  const duplicateIds = duplicates(sessions.map((session) => session.id).filter(Boolean));
  if (duplicateIds.length) fail(`${label} duplicate session ids`, duplicateIds.slice(0, 5).join(", "));
  else pass(`${label} duplicate session ids`, "none");
}

function duplicates(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

function validateSourceHealth(health, label) {
  validateAge(`${label} source health`, health.checkedAt, maxHealthAgeHours);
  const rows = Array.isArray(health.health) ? health.health : [];
  if (!rows.length) {
    fail(`${label} source health rows`, "empty");
    return;
  }
  const blockingFailures = rows.filter((row) => row.ok === false && row.blocking !== false);
  const nonBlockingWarnings = rows.filter(isNonBlockingSourceHealthWarning);
  if (blockingFailures.length) {
    fail(`${label} blocking source failures`, blockingFailures.map((row) => `${row.sourceId}:${row.status || "fail"}`).join(", "));
  } else {
    pass(`${label} blocking source failures`, "none");
  }
  if (nonBlockingWarnings.length) {
    warn(
      `${label} non-blocking source warnings`,
      nonBlockingWarnings.map((row) => `${row.sourceId}:${row.status || "warn"}`).join(", ")
    );
  } else {
    pass(`${label} non-blocking source warnings`, "none");
  }
}

function normalizeMovieTitle(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[<〈>〉()[\]{}"'`~!@#$%^&*_=+|\\:;,.?/·ㆍ\s-]+/g, "");
}

function trendHasFutureSession(item, schedule, today) {
  const titleKey = normalizeMovieTitle(item.title);
  if (!titleKey) return false;
  return (schedule.sessions || []).some((session) => {
    if (!session.date || session.date < today) return false;
    const sessionKey = normalizeMovieTitle(session.title);
    return sessionKey === titleKey || sessionKey.includes(titleKey) || titleKey.includes(sessionKey);
  });
}

function validateTrendsData(trends, label, schedule) {
  const today = nowKstParts().date;
  validateAge(`${label} community trends`, trends.generatedAt, maxTrendAgeHours);
  const items = Array.isArray(trends.items) ? trends.items : [];
  if (items.length < 4) fail(`${label} recommendation count`, `${items.length}/4`);
  else pass(`${label} recommendation count`, `${items.length}`);
  for (const item of items.slice(0, 4)) {
    if (!item.title) fail(`${label} recommendation title`, JSON.stringify(item));
    if (!isRecommendationPosterUrl(item.posterUrl)) fail(`${label} ${item.title || "(unknown)"} poster URL`, item.posterUrl || "(missing)");
    if (!item.nextDate || item.nextDate < today) {
      const detail = `${item.nextDate || "(missing)"} ${item.nextTime || ""}`.trim();
      if (trendHasFutureSession(item, schedule, today)) {
        warn(`${label} ${item.title || "(unknown)"} stored next showing`, `${detail}; current schedule still has future sessions`);
      } else {
        fail(`${label} ${item.title || "(unknown)"} next showing`, detail);
      }
    }
  }
}

async function comparePrimaryAndSecondary() {
  const targets = [
    { origin: primaryOrigin, label: "custom domain" },
    { origin: secondaryOrigin, label: secondaryLabel }
  ];
  const loaded = [];

  for (const target of targets) {
    const root = await fetchText(`${target.origin}/`);
    if (!root.response.ok) fail(`${target.label} homepage`, `HTTP ${root.response.status}`);
    else if (!/이번 주 추천|서울독립영화관|CINE SEOUL/i.test(root.text)) warn(`${target.label} homepage content`, "expected site marker was not found");
    else pass(`${target.label} homepage`, `HTTP ${root.response.status}`);

    const schedule = await fetchJson(`${target.origin}/data/schedule.json`);
    const trends = await fetchJson(`${target.origin}/data/community-trends.json`);
    const health = await fetchJson(`${target.origin}/data/source-health.json`);
    loaded.push({ target, schedule: schedule.json, trends: trends.json, health: health.json });

    validateScheduleData(schedule.json, target.label);
    validateTrendsData(trends.json, target.label, schedule.json);
    validateSourceHealth(health.json, target.label);

  }

  const [primary, secondary] = loaded;
  if (primary && secondary) {
    compareField("schedule generatedAt", primary.schedule.meta?.generatedAt, secondary.schedule.meta?.generatedAt);
    compareField("seat status verifiedAt", primary.schedule.meta?.seatStatusVerifiedAt, secondary.schedule.meta?.seatStatusVerifiedAt);
    compareField("community trends generatedAt", primary.trends.generatedAt, secondary.trends.generatedAt);
    compareField("source health checkedAt", primary.health.checkedAt, secondary.health.checkedAt);
  }

  return loaded[0];
}

function compareField(name, left, right) {
  if (left !== right) fail(`custom/secondary ${name}`, `${left || "(missing)"} != ${right || "(missing)"}`);
  else pass(`custom/secondary ${name}`, left || "(missing)");
}

async function validateRecommendationPosters(trends, origin) {
  const items = (trends.items || []).slice(0, 4);
  const results = await Promise.all(
    items.map((item) => {
      const posterUrl = String(item.posterUrl || "").startsWith("/") ? new URL(item.posterUrl, origin).href : item.posterUrl;
      return checkImageUrl(posterUrl, item.title || "recommendation");
    })
  );
  const broken = results.filter((result) => !result.ok);
  if (broken.length) {
    fail(
      "recommendation posters",
      broken.map((result) => `${result.label}: ${result.detail} (${result.url})`).join(" | ")
    );
  } else {
    pass("recommendation posters", `${results.length} image URLs verified`);
  }
}

async function validateSchedulePosterSummary(schedule) {
  const urls = [...new Set((schedule.sessions || []).map((session) => session.posterUrl).filter(Boolean))];
  const invalidUrls = urls.filter((url) => !isHttpUrl(url));
  if (invalidUrls.length) {
    const detail = invalidUrls.slice(0, 5).join(", ");
    if (strictSchedulePosters) fail("schedule poster URL format", detail);
    else warn("schedule poster URL format", detail);
  } else {
    pass("schedule poster URL format", `${urls.length} unique URLs`);
  }

  if (!probeSchedulePosters || !urls.length) return;

  const results = await mapLimit(urls, posterConcurrency, (url) => checkImageUrl(url, "schedule poster"));
  const broken = results.filter((result) => !result.ok);
  if (broken.length) {
    const detail = broken
      .slice(0, 10)
      .map((result) => `${result.detail} (${result.url})`)
      .join(" | ");
    if (strictSchedulePosters) fail("schedule poster image probes", `${broken.length}/${urls.length}; ${detail}`);
    else warn("schedule poster image probes", `${broken.length}/${urls.length}; ${detail}`);
  } else {
    pass("schedule poster image probes", `${urls.length} image URLs verified`);
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function printReport() {
  const status = failures.length ? "FAIL" : warnings.length ? "WARN" : "PASS";
  const payload = {
    ok: failures.length === 0,
    status,
    checkedAt: new Date().toISOString(),
    primaryOrigin,
    pagesOrigin,
    secondaryOrigin,
    secondaryLabel,
    failures,
    warnings,
    checks
  };

  if (jsonOutput) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`# Seoul Cinema Daily Site Health: ${status}`);
  console.log(`Checked at: ${payload.checkedAt}`);
  console.log(`Primary: ${primaryOrigin}`);
  console.log(`GitLab Pages origin: ${pagesOrigin}`);
  console.log(`${secondaryLabel}: ${secondaryOrigin}`);
  console.log("");
  console.log("## Failures");
  if (failures.length) failures.forEach((item) => console.log(`- ${item}`));
  else console.log("- none");
  console.log("");
  console.log("## Warnings");
  if (warnings.length) warnings.forEach((item) => console.log(`- ${item}`));
  else console.log("- none");
  console.log("");
  console.log("## Checks");
  for (const check of checks) {
    console.log(`- ${check.status} ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
  }
}

async function main() {
  await runNpmAudit("audit:assets");
  await runNpmAudit("smoke");

  try {
    const primary = await comparePrimaryAndSecondary();
    await validatePagesCanonicalRedirect();
    await validatePrimaryEdge();
    await runProductionParserAudit(primary.target.origin);
    await validateRecommendationPosters(primary.trends, primary.target.origin);
    await validateSchedulePosterSummary(primary.schedule);
  } catch (error) {
    fail("live site checks", error.stack || error.message || String(error));
  }

  printReport();
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  fail("daily health check crashed", error.stack || error.message || String(error));
  printReport();
  process.exitCode = 1;
});
