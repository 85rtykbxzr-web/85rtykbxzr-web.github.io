import { fetchWithTransientRetry } from "./http-retry.mjs";

const baseUrl = String(process.env.PAGES_VERIFY_URL || "").replace(/\/+$/, "");
const expectedDeploymentId = String(process.env.EXPECTED_DEPLOYMENT_ID || "");
const timeoutMs = positiveNumber("PAGES_VERIFY_TIMEOUT_MS", 300_000);
const intervalMs = positiveNumber("PAGES_VERIFY_INTERVAL_MS", 10_000);
const requestTimeoutMs = positiveNumber("PAGES_VERIFY_REQUEST_TIMEOUT_MS", 15_000);

function positiveNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function assertConfigured() {
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("PAGES_VERIFY_URL must be an absolute HTTP(S) URL");
  if (!expectedDeploymentId) throw new Error("EXPECTED_DEPLOYMENT_ID is required");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(path) {
  const response = await fetchWithTransientRetry(
    `${baseUrl}${path}`,
    { cache: "no-store", headers: { accept: "text/html,application/json;q=0.9,*/*;q=0.8" } },
    { attempts: 2, requestTimeoutMs, retryDelayMs: 500 }
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return text;
}

async function readDeployment() {
  const [homepage, healthText, scheduleText, trendsText] = await Promise.all([
    fetchText("/"),
    fetchText("/healthz.json"),
    fetchText("/data/schedule.json"),
    fetchText("/data/community-trends.json")
  ]);
  const health = JSON.parse(healthText);
  const schedule = JSON.parse(scheduleText);
  const trends = JSON.parse(trendsText);

  if (!/서울독립영화관|CINE SEOUL/i.test(homepage)) throw new Error("homepage marker is missing");
  if (health?.ok !== true || health?.mode !== "static") throw new Error("healthz.json is not a valid static health payload");
  if (!Array.isArray(schedule?.sessions) || schedule.sessions.length < 1) throw new Error("deployed schedule has no sessions");
  if (!Array.isArray(trends?.items) || trends.items.length < 4) throw new Error("deployed recommendations are incomplete");
  if (health.scheduleGeneratedAt !== schedule.meta?.generatedAt) throw new Error("deployed health and schedule timestamps differ");
  if (health.seatStatusVerifiedAt !== schedule.meta?.seatStatusVerifiedAt) {
    throw new Error("deployed health and seat-status timestamps differ");
  }

  const liveDeploymentId = String(health.deploymentId || "");
  let superseded = false;
  if (liveDeploymentId !== expectedDeploymentId) {
    const numericIds = /^\d+$/.test(liveDeploymentId) && /^\d+$/.test(expectedDeploymentId);
    superseded = numericIds && BigInt(liveDeploymentId) > BigInt(expectedDeploymentId);
    if (!superseded) {
      throw new Error(`deployment ${liveDeploymentId || "(missing)"} is live; expected ${expectedDeploymentId}`);
    }
  }

  return { health, sessions: schedule.sessions.length, recommendations: trends.items.length, superseded };
}

async function main() {
  assertConfigured();
  const deadline = Date.now() + timeoutMs;
  let lastError;

  do {
    try {
      const result = await readDeployment();
      console.log(
        JSON.stringify(
          {
            ok: true,
            baseUrl,
            expectedDeploymentId,
            deploymentId: result.health.deploymentId,
            superseded: result.superseded,
            deploymentCommit: result.health.deploymentCommit,
            builtAt: result.health.builtAt,
            scheduleGeneratedAt: result.health.scheduleGeneratedAt,
            seatStatusVerifiedAt: result.health.seatStatusVerifiedAt,
            sessions: result.sessions,
            recommendations: result.recommendations
          },
          null,
          2
        )
      );
      return;
    } catch (error) {
      lastError = error;
      if (Date.now() + intervalMs > deadline) break;
      console.log(`Pages deployment is not current yet: ${error.message}`);
      await sleep(intervalMs);
    }
  } while (Date.now() < deadline);

  throw new Error(`Pages deployment verification timed out after ${timeoutMs}ms: ${lastError?.message || "unknown error"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
