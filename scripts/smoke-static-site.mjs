import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { brotliDecompress, gunzip } from "node:zlib";
import { safePublicUrl } from "../src/public-url-policy.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputDirectory = resolve(root, process.env.STATIC_PUBLISH_DIR || "dist");
const indexable = /^(1|true|yes)$/i.test(process.env.STATIC_SITE_INDEXABLE || "");
const expectedTopLevelEntries = new Set([
  "_redirects",
  "api",
  "assets",
  "data",
  "favicon.ico",
  "healthz",
  "healthz.json",
  "index.html",
  "iphone.html",
  "mobile.html",
  "robots.txt",
  "sitemap.xml"
]);
const allowedDataFiles = new Set(["community-trends.json", "record-posters.json", "schedule.json", "source-health.json"]);
const compressibleExtensions = new Set([".css", ".html", ".js", ".json", ".svg", ".txt", ".xml"]);
const minimumCompressionSize = 256;
const brotliDecompressAsync = promisify(brotliDecompress);
const gunzipAsync = promisify(gunzip);
const allowedTrendTopLevelFields = new Set(["generatedAt", "items"]);
const allowedTrendItemFields = new Set([
  "nextDate",
  "nextTime",
  "posterSourceUrl",
  "posterUrl",
  "rank",
  "title",
  "trailerUrl",
  "url"
]);
const excludedPublicAssetPaths = [
  "festival-marks/siwff.png",
  "horse-rider-sprite.png",
  "site-icon.png"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertFile(path, label) {
  const fileStat = await stat(path);
  assert(fileStat.isFile(), `${label} is not a file`);
}

function fileExtension(path) {
  const name = path.split("/").pop() || "";
  return name.includes(".") ? `.${name.split(".").pop().toLowerCase()}` : "";
}

function compressionSourceName(name) {
  if (name.endsWith(".br")) return name.slice(0, -3);
  if (name.endsWith(".gz")) return name.slice(0, -3);
  return "";
}

async function collectCompressibleFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectCompressibleFiles(path)));
      continue;
    }
    if (!entry.isFile() || !compressibleExtensions.has(fileExtension(path))) continue;
    const fileStat = await stat(path);
    if (fileStat.size >= minimumCompressionSize) files.push(path);
  }
  return files;
}

async function assertCompressedSidecars(directory) {
  const files = await collectCompressibleFiles(directory);
  for (const path of files) {
    const source = await readFile(path);
    const [brotli, gzipped] = await Promise.all([readFile(`${path}.br`), readFile(`${path}.gz`)]);
    const [brotliSource, gzipSource] = await Promise.all([
      brotliDecompressAsync(brotli),
      gunzipAsync(gzipped)
    ]);
    assert(brotliSource.equals(source), `Brotli sidecar does not match ${path}`);
    assert(gzipSource.equals(source), `gzip sidecar does not match ${path}`);
    assert(brotli.length < source.length, `Brotli sidecar is not smaller than ${path}`);
    assert(gzipped.length < source.length, `gzip sidecar is not smaller than ${path}`);
  }
  return files.length;
}

const topLevelEntries = await readdir(outputDirectory);
for (const entry of topLevelEntries) {
  const sourceName = compressionSourceName(entry);
  const allowedSidecar = sourceName && expectedTopLevelEntries.has(sourceName) && compressibleExtensions.has(fileExtension(sourceName));
  assert(expectedTopLevelEntries.has(entry) || allowedSidecar, `unexpected top-level publish entry: ${entry}`);
}
for (const entry of expectedTopLevelEntries) {
  assert(topLevelEntries.includes(entry), `missing top-level publish entry: ${entry}`);
}

const dataFiles = await readdir(join(outputDirectory, "data"));
for (const file of dataFiles) {
  const sourceName = compressionSourceName(file);
  assert(allowedDataFiles.has(file) || (sourceName && allowedDataFiles.has(sourceName)), `private data file leaked into static output: data/${file}`);
}
for (const file of ["schedule.json", "community-trends.json", "source-health.json"]) {
  assert(dataFiles.includes(file), `required public data file is missing: data/${file}`);
}

const [
  indexHtml,
  scheduleText,
  trendsText,
  sourceHealthText,
  healthText,
  healthAliasText,
  scheduleAliasText,
  iphoneRedirect,
  mobileRedirect,
  sitemap,
  robots,
  redirects,
  renderBlueprint
] = await Promise.all([
  readFile(join(outputDirectory, "index.html"), "utf8"),
  readFile(join(outputDirectory, "data/schedule.json"), "utf8"),
  readFile(join(outputDirectory, "data/community-trends.json"), "utf8"),
  readFile(join(outputDirectory, "data/source-health.json"), "utf8"),
  readFile(join(outputDirectory, "healthz.json"), "utf8"),
  readFile(join(outputDirectory, "healthz"), "utf8"),
  readFile(join(outputDirectory, "api", "schedule"), "utf8"),
  readFile(join(outputDirectory, "iphone.html"), "utf8"),
  readFile(join(outputDirectory, "mobile.html"), "utf8"),
  readFile(join(outputDirectory, "sitemap.xml"), "utf8"),
  readFile(join(outputDirectory, "robots.txt"), "utf8"),
  readFile(join(outputDirectory, "_redirects"), "utf8"),
  readFile(join(root, "render.yaml"), "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  })
]);
const schedule = JSON.parse(scheduleText);
const trends = JSON.parse(trendsText);
const sourceHealth = JSON.parse(sourceHealthText);
const health = JSON.parse(healthText);
assert(healthAliasText === healthText, "extensionless health alias differs from healthz.json");
assert(scheduleAliasText === scheduleText, "extensionless schedule API alias differs from schedule.json");
assert(iphoneRedirect.includes('http-equiv="refresh"') && iphoneRedirect.includes('href="/"'), "iphone redirect alias is invalid");
assert(mobileRedirect.includes('http-equiv="refresh"') && mobileRedirect.includes('href="/"'), "mobile redirect alias is invalid");

for (const [label, text, value] of [
  ["schedule", scheduleText, schedule],
  ["community trends", trendsText, trends],
  ["source health", sourceHealthText, sourceHealth],
  ["health", healthText, health]
]) {
  assert(text === `${JSON.stringify(value)}\n`, `${label} JSON is not compact and deterministic`);
}

assert(Buffer.byteLength(scheduleText) <= 2_000_000, "published schedule JSON exceeds 2 MB");
assert(Buffer.byteLength(trendsText) <= 50_000, "published community trends JSON exceeds 50 KB");
assert(Buffer.byteLength(sourceHealthText) <= 1_000_000, "published source health JSON exceeds 1 MB");
assert(schedule.sessions.length <= 5_000, "published schedule exceeds 5,000 sessions");
assert(Object.keys(trends).every((key) => allowedTrendTopLevelFields.has(key)), "community trends exposes an unexpected top-level field");
for (const item of trends.items) {
  assert(Object.keys(item).every((key) => allowedTrendItemFields.has(key)), "community trends exposes an unexpected item field");
}
assert(!trends.sourceInternal, "community trends exposes internal source metadata");
assert(trends.items.every((item) => !item.evidence), "community trends exposes source evidence");
assert(safePublicUrl("https://evil.example/ticket/collect", "") === "", "untrusted public link host was accepted");
assert(safePublicUrl("  https://evil.example/ticket/collect", "") === "", "whitespace-prefixed untrusted URL was accepted");
assert(safePublicUrl("https:\\evil.example/ticket/collect", "") === "", "backslash URL was accepted");
assert(safePublicUrl("https://user@www.dtryx.com/ticket", "") === "", "public link userinfo was accepted");
assert(
  safePublicUrl("https://www.dtryx.com/reserve/movie.do", "") === "https://www.dtryx.com/reserve/movie.do",
  "trusted booking host was rejected"
);
assert(
  safePublicUrl("https://a.ltrbxd.com/resized/film-poster/example.jpg", "") ===
    "https://a.ltrbxd.com/resized/film-poster/example.jpg",
  "trusted Letterboxd poster host was rejected"
);
assert(
  safePublicUrl("https://upload.wikimedia.org/wikipedia/en/example.jpg", "") ===
    "https://upload.wikimedia.org/wikipedia/en/example.jpg",
  "trusted Wikimedia poster host was rejected"
);

assert(indexHtml.includes('rel="canonical" href="https://seoulcinemaschedule.com/"'), "canonical URL is missing");
assert(/rel="preload" as="image" href="(?:https:\/\/|\/assets\/)/.test(indexHtml), "poster preload is missing");
const structuredData = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] || "";
const structuredDataHash = `sha256-${createHash("sha256").update(structuredData).digest("base64")}`;
assert(structuredData, "structured data is missing");
if (renderBlueprint) {
  assert(renderBlueprint.includes(`'${structuredDataHash}'`), "Render CSP does not allow the structured-data script hash");
}
assert(
  indexHtml.includes(`script-src 'self' '${structuredDataHash}' https://www.googletagmanager.com`),
  "static CSP meta does not allow the structured-data script hash"
);
const cspPosition = indexHtml.indexOf('http-equiv="Content-Security-Policy"');
const firstProtectedResourcePosition = Math.min(
  ...[indexHtml.indexOf("<script"), indexHtml.indexOf('<link rel="stylesheet"')].filter((position) => position >= 0)
);
assert(cspPosition >= 0 && cspPosition < firstProtectedResourcePosition, "static CSP meta must precede scripts and stylesheets");
assert(indexHtml.includes('name="referrer" content="strict-origin-when-cross-origin"'), "static referrer policy is missing");
assert(Array.isArray(schedule.sessions) && schedule.sessions.length > 0, "schedule output has no sessions");
assert(Array.isArray(trends.items) && trends.items.length >= 4, "trend output has fewer than four recommendations");
assert(Array.isArray(sourceHealth.health) && sourceHealth.health.length > 0, "source health output has no rows");
assert(health.ok === true && health.mode === "static", "static health payload is invalid");
assert(health.indexable === indexable, "static health indexability does not match the build mode");
assert(!Number.isNaN(Date.parse(health.builtAt)), "static health build timestamp is invalid");
assert(health.deploymentId === (process.env.STATIC_DEPLOYMENT_ID || null), "static health deployment ID is invalid");
assert(health.deploymentCommit === (process.env.STATIC_DEPLOYMENT_COMMIT || null), "static health deployment commit is invalid");
assert(health.scheduleGeneratedAt === schedule.meta?.generatedAt, "health schedule timestamp does not match output data");
assert(health.seatStatusVerifiedAt === schedule.meta?.seatStatusVerifiedAt, "health seat timestamp does not match output data");
assert(sitemap.includes("<loc>https://seoulcinemaschedule.com/</loc>"), "sitemap production URL is missing");
for (const rule of [
  "/healthz /healthz.json 200",
  "/api/schedule /data/schedule.json 200",
  "/favicon.ico /assets/favicon-32.png 302",
  "/iphone.html / 301",
  "/mobile.html / 301"
]) {
  assert(redirects.includes(rule), `static redirect rule is missing: ${rule}`);
}
if (indexable) {
  assert(indexHtml.includes('name="robots" content="index,follow"'), "indexable build has no index meta directive");
  assert(robots.includes("Sitemap: https://seoulcinemaschedule.com/sitemap.xml"), "robots sitemap URL is missing");
  assert(robots.includes("Allow: /"), "indexable robots output does not allow crawling");
} else {
  assert(indexHtml.includes('name="robots" content="noindex,nofollow,noarchive"'), "preview build is indexable");
  assert(robots.includes("Disallow: /"), "preview robots output does not block crawling");
}

const localReferences = [...indexHtml.matchAll(/(?:href|src)="(\/[^"]+)"/g)]
  .map((match) => match[1].split(/[?#]/)[0])
  .filter((path) => path && path !== "/");
for (const path of new Set(localReferences)) {
  await assertFile(join(outputDirectory, path), `referenced asset ${path}`);
}

const runtimeReferenceFiles = await collectCompressibleFiles(outputDirectory);
const runtimeAssetReferences = new Set();
for (const path of runtimeReferenceFiles) {
  const source = await readFile(path, "utf8");
  for (const match of source.matchAll(/\/assets\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:css|gif|jpe?g|js|png|svg|txt|webp)/gi)) {
    runtimeAssetReferences.add(match[0]);
  }
}
for (const path of runtimeAssetReferences) {
  await assertFile(join(outputDirectory, path), `runtime-referenced asset ${path}`);
}
for (const path of excludedPublicAssetPaths) {
  try {
    await stat(join(outputDirectory, "assets", path));
    assert(false, `unused asset leaked into static output: assets/${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const compressedFileCount = await assertCompressedSidecars(outputDirectory);
const publicDataFileCount = dataFiles.filter((file) => allowedDataFiles.has(file)).length;

console.log(
  `Static site smoke passed (${schedule.sessions.length} sessions, ${trends.items.length} recommendations, ${publicDataFileCount} public data files, ${compressedFileCount} precompressed files).`
);
