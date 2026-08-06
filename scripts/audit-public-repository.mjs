import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeSourceSnapshot } from "./update-schedule.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const forbiddenPaths = new Set([
  ".claude",
  ".codex",
  ".gitlab-ci.yml",
  ".superloopy",
  "AGENTS.md",
  "docs/gitlab-pages-operations.md",
  "docs/mac-gitlab-runner.md",
  "docs/render-static-cutover.md",
  "render.yaml",
  "stitch_reference"
]);
const skippedDirectories = new Set([".git", ".npm", "dist", "node_modules"]);
const textExtensions = new Set([".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".txt", ".xml", ".yaml", ".yml"]);
const highConfidenceSecretPatterns = [
  ["GitHub token", /\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}\b/g],
  ["GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}\b/g],
  ["OpenAI key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["private key", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g]
];
const discoveredForbiddenPaths = [];

async function collectFiles(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const publicPath = relative(root, path).replaceAll("\\", "/");
    if (isForbidden(publicPath)) {
      discoveredForbiddenPaths.push(publicPath);
      continue;
    }
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    if (entry.isDirectory()) await collectFiles(path, files);
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function isForbidden(publicPath) {
  return [...forbiddenPaths].some((path) => publicPath === path || publicPath.startsWith(`${path}/`));
}

function normalizedSnapshot(text) {
  return String(text).replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "");
}

const failures = [];
const files = await collectFiles(root);
failures.push(...discoveredForbiddenPaths.map((path) => `${path}: internal-only path is present`));

for (const path of files) {
  const publicPath = relative(root, path).replaceAll("\\", "/");
  const extension = extname(publicPath).toLowerCase();
  if (!textExtensions.has(extension) && ![".gitignore", "package-lock.json", "package.json"].includes(publicPath)) continue;

  const text = await readFile(path, "utf8");
  for (const [label, pattern] of highConfidenceSecretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) failures.push(`${publicPath}: ${label} pattern is present`);
  }

  if (publicPath.startsWith("data/source-snapshots/") && extension === ".html") {
    if (sanitizeSourceSnapshot(text) !== normalizedSnapshot(text)) {
      failures.push(`${publicPath}: source snapshot still contains a redaction candidate`);
    }
  }
}

if (failures.length > 0) {
  console.error("Public repository audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Public repository audit passed (${files.length} files checked).`);
