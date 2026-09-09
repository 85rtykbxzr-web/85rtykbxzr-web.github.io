import { fileURLToPath } from "node:url";
import { fetchWithTransientRetry } from "./http-retry.mjs";

const minute = 60_000;
const offset = 7 * minute;
const active = (runs) => runs.some((run) => run.status !== "completed");

function currentSlot(value, period, now) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp) || timestamp > now + 5 * minute) return -Infinity;
  return Math.floor((timestamp - offset) / period);
}

export function refreshPlan({ health, pagesRuns = [], healthRuns = [], now = Date.now() }) {
  if (active(pagesRuns)) return { mode: null, healthDue: false, reason: "A Pages refresh or deployment is already running" };
  const kst = new Date(now + 9 * 60 * minute);
  const hour = kst.getUTCHours();
  let mode = null;
  if (health?.ok !== true || currentSlot(health.scheduleGeneratedAt, 180 * minute, now) < Math.floor((now - offset) / (180 * minute))) mode = "full";
  else if (hour >= 8 && currentSlot(health.seatStatusVerifiedAt, 15 * minute, now) < Math.floor((now - offset) / (15 * minute))) mode = "seats";
  const target = Date.parse(`${kst.toISOString().slice(0, 10)}T09:43:00+09:00`);
  const checkedToday = healthRuns.some((run) => Date.parse(run.created_at) >= target && (run.status !== "completed" || run.conclusion === "success"));
  const healthDue = now >= target && !active(healthRuns) && !checkedToday;
  return { mode, healthDue, reason: mode ? "A new refresh interval is due" : "Published data is current for this interval" };
}

export function assertClockWait(start, minimumMinutes, now = Date.now()) {
  const minutes = Number(minimumMinutes);
  const elapsed = now - Date.parse(start || "");
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60 || !Number.isFinite(elapsed) || elapsed < minutes * minute) {
    throw new Error("The GitHub environment wait timer was not observed. Stopping the clock to prevent rapid recursive runs.");
  }
  return elapsed / minute;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || "") || !token) throw new Error("A repository-scoped GitHub Actions token is required");
  async function api(path, body) {
    const response = await fetchWithTransientRetry(`https://api.github.com/repos/${repo}/${path}`, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
      ...(body ? { body: JSON.stringify(body) } : {})
    }, { attempts: 3, requestTimeoutMs: 15_000, retryDelayMs: 2_000 });
    if (!response.ok) throw new Error(`GitHub ${path}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  const dispatch = (workflow, inputs) => api(`actions/workflows/${workflow}/dispatches`, { ref: "main", ...(inputs ? { inputs } : {}) });
  if (process.argv[2] === "next") {
    const waitedMinutes = assertClockWait(process.env.CLOCK_WAIT_STARTED_AT, process.env.CLOCK_MIN_WAIT_MINUTES || "14");
    await dispatch("refresh-clock.yml");
    console.log(JSON.stringify({ nextRunDispatched: true, waitedMinutes }));
    return;
  }
  if (process.argv[2] !== "tick") throw new Error("Expected tick or next");
  const [pages, checks, health] = await Promise.all([
    api("actions/workflows/pages.yml/runs?per_page=30"),
    api("actions/workflows/site-health.yml/runs?per_page=30"),
    fetchWithTransientRetry(`https://seoulcinemaschedule.com/healthz.json?clock=${process.env.GITHUB_RUN_ID}`, { cache: "no-store" }, { attempts: 3, requestTimeoutMs: 15_000 })
      .then((response) => response.ok ? response.json() : null).catch(() => null)
  ]);
  if (!Array.isArray(pages.workflow_runs) || !Array.isArray(checks.workflow_runs)) throw new Error("GitHub run status is unavailable");
  const plan = refreshPlan({ health, pagesRuns: pages.workflow_runs, healthRuns: checks.workflow_runs });
  console.log(JSON.stringify(plan));
  if (plan.mode) await dispatch("pages.yml", { mode: plan.mode });
  if (plan.healthDue) await dispatch("site-health.yml");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
