const requiredEnvironment = [
  "CI_API_V4_URL",
  "CI_PROJECT_ID",
  "CI_DEFAULT_BRANCH",
  "CI_COMMIT_SHA",
  "CI_JOB_TOKEN"
];

for (const name of requiredEnvironment) {
  if (!process.env[name]) {
    throw new Error(`Missing required CI environment variable: ${name}`);
  }
}

const apiBase = process.env.CI_API_V4_URL.replace(/\/$/, "");
const branchName = process.env.CI_DEFAULT_BRANCH;
const expectedCommit = process.env.CI_COMMIT_SHA.toLowerCase();
const endpoint = new URL(
  `${apiBase}/projects/${encodeURIComponent(process.env.CI_PROJECT_ID)}/repository/branches`
);
endpoint.searchParams.set("search", `^${branchName}$`);
endpoint.searchParams.set("per_page", "100");

const response = await fetch(endpoint, {
  headers: {
    "JOB-TOKEN": process.env.CI_JOB_TOKEN
  },
  signal: AbortSignal.timeout(20_000)
});

if (!response.ok) {
  throw new Error(`GitLab branch check failed with HTTP ${response.status}.`);
}

const branches = await response.json();
const branch = Array.isArray(branches)
  ? branches.find((candidate) => candidate?.name === branchName)
  : null;
const remoteCommit = String(branch?.commit?.id || "").toLowerCase();

if (!/^[0-9a-f]{40}$/.test(remoteCommit)) {
  throw new Error("GitLab branch check returned an invalid commit SHA.");
}

if (remoteCommit !== expectedCommit) {
  throw new Error(
    `${branchName} moved to ${remoteCommit.slice(0, 8)} while this pipeline targets ${expectedCommit.slice(0, 8)}. Refusing an out-of-order deployment.`
  );
}

console.log(`${branchName} still points to ${remoteCommit.slice(0, 8)}; deployment order is safe.`);
