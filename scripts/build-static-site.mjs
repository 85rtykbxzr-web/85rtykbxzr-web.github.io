import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";
import { isTrustedPublicUrl, safePublicUrl } from "../src/public-url-policy.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const publishRoot = join(root, "dist");
const outputDirectory = resolve(root, process.env.STATIC_PUBLISH_DIR || "dist");
const canonicalPublicBaseUrl = "https://seoulcinemaschedule.com";
const indexable = /^(1|true|yes)$/i.test(process.env.STATIC_SITE_INDEXABLE || "");
const deploymentId = process.env.STATIC_DEPLOYMENT_ID || null;
const deploymentCommit = process.env.STATIC_DEPLOYMENT_COMMIT || null;
const optionalDataFiles = ["record-posters.json"];
const allowedAssetExtensions = new Set([".css", ".gif", ".jpeg", ".jpg", ".js", ".png", ".svg", ".txt", ".webp"]);
const excludedPublicAssetPaths = [
  "festival-marks/siwff.png",
  "horse-rider-sprite.png",
  "site-icon.png"
];
const compressibleExtensions = new Set([".css", ".html", ".js", ".json", ".svg", ".txt", ".xml"]);
const minimumCompressionSize = 256;
const inputByteBudgets = {
  index: 500_000,
  schedule: 5_000_000,
  trends: 1_000_000,
  sourceHealth: 2_000_000,
  optionalData: 1_000_000
};
const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

function assertSafeOutputDirectory() {
  const relativePath = relative(publishRoot, outputDirectory);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Refusing to replace unsafe static publish directory: ${outputDirectory}`);
  }
}

function escapeHtmlAttribute(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function assertByteBudget(label, text, maximumBytes) {
  const bytes = Buffer.byteLength(text);
  if (bytes > maximumBytes) throw new Error(`${label} exceeds the ${maximumBytes}-byte publish budget (${bytes} bytes)`);
}

async function assertFileByteBudget(label, path, maximumBytes) {
  const fileStat = await stat(path);
  if (!fileStat.isFile()) throw new Error(`${label} is not a regular file`);
  if (fileStat.size > maximumBytes) {
    throw new Error(`${label} exceeds the ${maximumBytes}-byte input budget (${fileStat.size} bytes)`);
  }
}

function validateTrustedUrls(value, label, path = label) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateTrustedUrls(item, label, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => validateTrustedUrls(item, label, `${path}.${key}`));
    return;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (/^https?:/i.test(normalized) && !isTrustedPublicUrl(normalized)) {
      throw new Error(`${label} contains an untrusted public URL at ${path}`);
    }
  }
}

function publicCommunityTrends(trends) {
  return {
    generatedAt: trends.generatedAt || null,
    items: trends.items.slice(0, 4).map((item, index) => ({
      rank: Number(item.rank) || index + 1,
      title: String(item.title || ""),
      posterUrl: String(item.localPosterUrl || item.posterUrl || ""),
      posterSourceUrl: String(item.posterSourceUrl || ""),
      url: String(item.url || ""),
      trailerUrl: String(item.trailerUrl || ""),
      nextDate: String(item.nextDate || ""),
      nextTime: String(item.nextTime || "")
    }))
  };
}

function contentSecurityPolicy(structuredData) {
  const structuredDataHash = `sha256-${createHash("sha256").update(structuredData).digest("base64")}`;
  return [
    "default-src 'self'",
    `script-src 'self' '${structuredDataHash}' https://www.googletagmanager.com`,
    "style-src 'self'",
    "style-src-attr 'none'",
    "script-src-attr 'none'",
    "font-src 'self' data:",
    "img-src 'self' data: https:",
    "connect-src 'self' https://www.google-analytics.com https://analytics.google.com https://region1.google-analytics.com",
    "object-src 'none'",
    "worker-src 'none'",
    "media-src 'none'",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'none'",
    "upgrade-insecure-requests"
  ].join("; ");
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function validateAssetTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const publicPath = relative(root, path);
    if (entry.name.startsWith(".")) throw new Error(`Refusing to publish hidden asset: ${publicPath}`);
    if (entry.isSymbolicLink()) throw new Error(`Refusing to publish symbolic-link asset: ${publicPath}`);
    if (entry.isDirectory()) {
      await validateAssetTree(path);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Refusing to publish non-file asset: ${publicPath}`);
    const extension = entry.name.includes(".") ? `.${entry.name.split(".").pop().toLowerCase()}` : "";
    if (!allowedAssetExtensions.has(extension)) throw new Error(`Refusing to publish unsupported asset: ${publicPath}`);
  }
}

async function writeJsonToOutput(destinationPath, value) {
  const destination = join(outputDirectory, destinationPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(value)}\n`);
}

function fileExtension(path) {
  const name = path.split("/").pop() || "";
  return name.includes(".") ? `.${name.split(".").pop().toLowerCase()}` : "";
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

async function writeCompressedSidecars(directory) {
  const files = await collectCompressibleFiles(directory);
  for (const path of files) {
    const source = await readFile(path);
    const [brotli, gzipped] = await Promise.all([
      brotliCompressAsync(source, {
        params: {
          [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
          [zlibConstants.BROTLI_PARAM_QUALITY]: 9
        }
      }),
      gzipAsync(source, { level: 9 })
    ]);
    await Promise.all([writeFile(`${path}.br`, brotli), writeFile(`${path}.gz`, gzipped)]);
  }
  return files.length;
}

function recommendationPosterPreloadMarkup(trends) {
  const rawUrl = String(trends.items?.[0]?.posterUrl || "").replace(/\.small\.jpg(?=$|[?#])/i, ".thumb.jpg");
  if (/^\/assets\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/i.test(rawUrl)) {
    return `    <link rel="preload" as="image" href="${escapeHtmlAttribute(rawUrl)}" fetchpriority="high" />`;
  }

  const trustedUrl = safePublicUrl(rawUrl, "");
  if (!trustedUrl.startsWith("https://")) return "";

  try {
    const posterUrl = new URL(trustedUrl);
    const safeOrigin = escapeHtmlAttribute(posterUrl.origin);
    const safePosterUrl = escapeHtmlAttribute(posterUrl.toString());
    return [
      `    <link rel="preconnect" href="${safeOrigin}" crossorigin />`,
      `    <link rel="preload" as="image" href="${safePosterUrl}" fetchpriority="high" />`
    ].join("\n");
  } catch {
    return "";
  }
}

function sitemapXml(schedule) {
  const stamp = schedule?.meta?.lastVerifiedAt || schedule?.meta?.generatedAt || "";
  const parsed = Date.parse(stamp);
  if (Number.isNaN(parsed)) throw new Error("schedule.json is missing a valid generated timestamp");

  const lastmod = new Date(parsed).toISOString().slice(0, 10);
  const loc = escapeXml(`${canonicalPublicBaseUrl}/`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url>",
    `    <loc>${loc}</loc>`,
    `    <lastmod>${escapeXml(lastmod)}</lastmod>`,
    "    <changefreq>daily</changefreq>",
    "    <priority>1.0</priority>",
    "  </url>",
    "</urlset>",
    ""
  ].join("\n");
}

function redirectHtml(destination) {
  const safeDestination = escapeHtmlAttribute(destination);
  return [
    "<!doctype html>",
    '<html lang="ko">',
    "  <head>",
    '    <meta charset="utf-8" />',
    `    <meta http-equiv="refresh" content="0;url=${safeDestination}" />`,
    `    <link rel="canonical" href="${escapeHtmlAttribute(`${canonicalPublicBaseUrl}${destination}`)}" />`,
    "    <title>서울독립영화관시간표로 이동</title>",
    "  </head>",
    `  <body><a href="${safeDestination}">서울독립영화관시간표로 이동</a></body>`,
    "</html>",
    ""
  ].join("\n");
}

function validatePublicData(schedule, trends, sourceHealth) {
  if (!Array.isArray(schedule?.sessions) || schedule.sessions.length === 0) {
    throw new Error("schedule.json has no sessions");
  }
  if (!Array.isArray(trends?.items) || trends.items.length < 4) {
    throw new Error("community-trends.json has fewer than four recommendations");
  }
  if (!Array.isArray(sourceHealth?.health) || sourceHealth.health.length === 0) {
    throw new Error("source-health.json has no source health rows");
  }
  if (schedule.sessions.length > 5_000) throw new Error("schedule.json exceeds the 5,000-session publish budget");
  if ((schedule.venues || []).length > 100) throw new Error("schedule.json exceeds the 100-venue publish budget");
  if (trends.items.length > 100) throw new Error("community-trends.json exceeds the 100-item publish budget");
  if (sourceHealth.health.length > 500) throw new Error("source-health.json exceeds the 500-row publish budget");
}

assertSafeOutputDirectory();

const indexPath = join(root, "index.html");
const schedulePath = join(root, "data/schedule.json");
const trendsPath = join(root, "data/community-trends.json");
const sourceHealthPath = join(root, "data/source-health.json");
await Promise.all([
  assertFileByteBudget("index.html", indexPath, inputByteBudgets.index),
  assertFileByteBudget("schedule.json", schedulePath, inputByteBudgets.schedule),
  assertFileByteBudget("community-trends.json", trendsPath, inputByteBudgets.trends),
  assertFileByteBudget("source-health.json", sourceHealthPath, inputByteBudgets.sourceHealth)
]);

const [indexHtml, scheduleText, trendsText, sourceHealthText] = await Promise.all([
  readFile(indexPath, "utf8"),
  readFile(schedulePath, "utf8"),
  readFile(trendsPath, "utf8"),
  readFile(sourceHealthPath, "utf8")
]);
const schedule = JSON.parse(scheduleText);
const trends = JSON.parse(trendsText);
const sourceHealth = JSON.parse(sourceHealthText);
validatePublicData(schedule, trends, sourceHealth);
assertByteBudget("schedule.json", scheduleText, inputByteBudgets.schedule);
assertByteBudget("community-trends.json", trendsText, inputByteBudgets.trends);
assertByteBudget("source-health.json", sourceHealthText, inputByteBudgets.sourceHealth);
const publicTrends = publicCommunityTrends(trends);
validateTrustedUrls(schedule, "schedule.json");
validateTrustedUrls(publicTrends, "community-trends.json");
validateTrustedUrls(sourceHealth, "source-health.json");

const preloadMarkup = recommendationPosterPreloadMarkup(publicTrends);
if (!preloadMarkup) throw new Error("community-trends.json does not provide a safe recommendation poster preload URL");
if (!indexHtml.includes("<head>") || !indexHtml.includes("  </head>")) {
  throw new Error("index.html is missing the expected head markers");
}
const structuredData = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] || "";
if (!structuredData) throw new Error("index.html is missing structured data");
const securityMarkup = [
  `    <meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(contentSecurityPolicy(structuredData))}" />`,
  '    <meta name="referrer" content="strict-origin-when-cross-origin" />'
].join("\n");
const robotsContent = indexable ? "index,follow" : "noindex,nofollow,noarchive";
const renderedIndex = indexHtml
  .replace(/(<meta name="robots" content=")[^"]*(" \/>)/, `$1${robotsContent}$2`)
  .replace("<head>", `<head>\n${securityMarkup}`)
  .replace("  </head>", `${preloadMarkup}\n  </head>`);
const robotsText = indexable
  ? `User-agent: *\nAllow: /\n\nSitemap: ${canonicalPublicBaseUrl}/sitemap.xml\n`
  : "User-agent: *\nDisallow: /\n";
const redirectsText = [
  "/healthz /healthz.json 200",
  "/api/schedule /data/schedule.json 200",
  "/favicon.ico /assets/favicon-32.png 302",
  "/iphone.html / 301",
  "/mobile.html / 301",
  ""
].join("\n");
const builtAt = new Date().toISOString();
const healthPayload = {
  ok: true,
  mode: "static",
  indexable,
  builtAt,
  deploymentId,
  deploymentCommit,
  scheduleGeneratedAt: schedule.meta?.generatedAt || null,
  seatStatusVerifiedAt: schedule.meta?.seatStatusVerifiedAt || null,
  trendsGeneratedAt: publicTrends.generatedAt || null,
  sourceHealthCheckedAt: sourceHealth.checkedAt || null
};

await validateAssetTree(join(root, "assets"));
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await cp(join(root, "assets"), join(outputDirectory, "assets"), { recursive: true });
await Promise.all(excludedPublicAssetPaths.map((path) => rm(join(outputDirectory, "assets", path), { force: true })));
await Promise.all([
  writeFile(join(outputDirectory, "index.html"), renderedIndex),
  writeFile(join(outputDirectory, "_redirects"), redirectsText),
  writeFile(join(outputDirectory, "sitemap.xml"), sitemapXml(schedule)),
  writeJsonToOutput("healthz.json", healthPayload),
  writeJsonToOutput("healthz", healthPayload),
  writeJsonToOutput("api/schedule", schedule),
  cp(join(outputDirectory, "assets", "favicon-32.png"), join(outputDirectory, "favicon.ico")),
  writeFile(join(outputDirectory, "iphone.html"), redirectHtml("/")),
  writeFile(join(outputDirectory, "mobile.html"), redirectHtml("/")),
  writeFile(join(outputDirectory, "robots.txt"), robotsText),
  writeJsonToOutput("data/schedule.json", schedule),
  writeJsonToOutput("data/community-trends.json", publicTrends),
  writeJsonToOutput("data/source-health.json", sourceHealth)
]);

for (const file of optionalDataFiles) {
  const sourcePath = join(root, "data", file);
  if (await pathExists(sourcePath)) {
    await assertFileByteBudget(file, sourcePath, inputByteBudgets.optionalData);
    const value = JSON.parse(await readFile(sourcePath, "utf8"));
    validateTrustedUrls(value, file);
    await writeJsonToOutput(`data/${file}`, value);
  }
}

const compressedFileCount = await writeCompressedSidecars(outputDirectory);

console.log(
  `Static site built at ${relative(root, outputDirectory)} (${schedule.sessions.length} sessions, ${publicTrends.items.length} recommendations, ${compressedFileCount} precompressed files).`
);
