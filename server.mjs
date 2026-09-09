import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { timingSafeEqual } from "node:crypto";
import { constants as zlibConstants, createBrotliCompress, createGzip } from "node:zlib";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const betaUser = process.env.BETA_USER || "beta";
const betaPassword = process.env.BETA_PASSWORD || "";
const refreshToken = process.env.REFRESH_TOKEN || "";
const exposeHealthDetails = /^(1|true|yes)$/i.test(process.env.HEALTH_DETAILS || "");
const manualFullRefreshCooldownMinutes = Number(process.env.MANUAL_FULL_REFRESH_COOLDOWN_MINUTES || 30);
const manualSeatRefreshCooldownSeconds = Number(process.env.MANUAL_SEAT_REFRESH_COOLDOWN_SECONDS || 60);
const fullRefreshIntervalMinutes = Number(process.env.FULL_REFRESH_INTERVAL_MINUTES || 360);
const seatRefreshIntervalMinutes = Number(process.env.SEAT_REFRESH_INTERVAL_MINUTES || 5);
const staleRefreshCooldownMinutes = Number(process.env.STALE_REFRESH_COOLDOWN_MINUTES || 30);
const staleRequestRefreshEnabled = !/^(0|false|no)$/i.test(process.env.STALE_REFRESH_ON_REQUEST ?? "true");
const configuredRefreshProcessTimeoutMinutes = Number(process.env.REFRESH_PROCESS_TIMEOUT_MINUTES ?? 30);
const refreshProcessTimeoutMinutes = Number.isFinite(configuredRefreshProcessTimeoutMinutes)
  ? configuredRefreshProcessTimeoutMinutes
  : 30;
const canonicalPublicBaseUrl = "https://seoulcinemaschedule.com";
const canonicalHostnames = new Set(["seoulcinemaschedule.com", "www.seoulcinemaschedule.com"]);
const publicBaseUrl = normalizePublicBaseUrl(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "");
const fullRefreshIntervalMs =
  Number.isFinite(fullRefreshIntervalMinutes) && fullRefreshIntervalMinutes > 0
    ? fullRefreshIntervalMinutes * 60 * 1000
    : 0;
const seatRefreshIntervalMs =
  Number.isFinite(seatRefreshIntervalMinutes) && seatRefreshIntervalMinutes > 0
    ? seatRefreshIntervalMinutes * 60 * 1000
    : 0;
const manualFullRefreshCooldownMs =
  Number.isFinite(manualFullRefreshCooldownMinutes) && manualFullRefreshCooldownMinutes > 0
    ? manualFullRefreshCooldownMinutes * 60 * 1000
    : 0;
const manualSeatRefreshCooldownMs =
  Number.isFinite(manualSeatRefreshCooldownSeconds) && manualSeatRefreshCooldownSeconds > 0
    ? manualSeatRefreshCooldownSeconds * 1000
    : 0;
const staleRefreshCooldownMs =
  Number.isFinite(staleRefreshCooldownMinutes) && staleRefreshCooldownMinutes > 0
    ? staleRefreshCooldownMinutes * 60 * 1000
    : 0;
const refreshProcessTimeoutMs =
  Number.isFinite(refreshProcessTimeoutMinutes) && refreshProcessTimeoutMinutes > 0
    ? refreshProcessTimeoutMinutes * 60 * 1000
    : 0;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const securityHeaders = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-dns-prefetch-control": "off",
  "cross-origin-opener-policy": "same-origin",
  "origin-agent-cluster": "?1",
  // Site is served over HTTPS (Render); enforce it. Browsers ignore this header on
  // plain-HTTP/localhost responses, so it is safe to send unconditionally.
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' 'sha256-urg7e3GLu2OmmcC/P19X7mQgt0AhIRQJw+h637P88S0=' https://www.googletagmanager.com",
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
    "frame-ancestors 'none'",
    "upgrade-insecure-requests"
  ].join("; ")
};

function responseHeaders(headers = {}) {
  return {
    ...securityHeaders,
    ...headers
  };
}

function isCompressibleResponse(contentType, size) {
  return Number(size || 0) >= 1024 && /(?:text\/|javascript|json|xml|svg)/i.test(String(contentType || ""));
}

function acceptedEncodingQuality(header, encoding) {
  let wildcard = 0;
  for (const entry of String(header || "").toLowerCase().split(",")) {
    const [name, ...parameters] = entry.trim().split(";");
    if (!name) continue;
    const qualityParameter = parameters.map((value) => value.trim()).find((value) => value.startsWith("q="));
    const parsedQuality = qualityParameter ? Number(qualityParameter.slice(2)) : 1;
    const quality = Number.isFinite(parsedQuality) ? Math.max(0, Math.min(1, parsedQuality)) : 0;
    if (name === encoding) return quality;
    if (name === "*") wildcard = quality;
  }
  return wildcard;
}

function responseCompression(req, contentType, size) {
  if (!isCompressibleResponse(contentType, size)) return "";
  const accepted = req.headers["accept-encoding"] || "";
  const brotliQuality = acceptedEncodingQuality(accepted, "br");
  const gzipQuality = acceptedEncodingQuality(accepted, "gzip");
  if (brotliQuality > 0 && brotliQuality >= gzipQuality) return "br";
  if (gzipQuality > 0) return "gzip";
  return "";
}

function compressionHeaders(encoding, varyByEncoding = Boolean(encoding)) {
  return {
    ...(encoding ? { "content-encoding": encoding } : {}),
    ...(varyByEncoding ? { vary: "Accept-Encoding" } : {})
  };
}

function pipeResponse(stream, res, encoding) {
  if (encoding === "br") {
    const compressor = createBrotliCompress({
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 }
    });
    compressor.on("error", (error) => res.destroy(error));
    stream.pipe(compressor).pipe(res);
    return;
  }
  if (encoding === "gzip") {
    const compressor = createGzip({ level: 6 });
    compressor.on("error", (error) => res.destroy(error));
    stream.pipe(compressor).pipe(res);
    return;
  }
  stream.pipe(res);
}

function normalizePublicBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.username = "";
    url.password = "";
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

const refreshState = {
  running: false,
  startedAt: "",
  finishedAt: "",
  ok: null,
  exitCode: null,
  message: "",
  error: ""
};

const seatRefreshState = {
  running: false,
  startedAt: "",
  finishedAt: "",
  ok: null,
  exitCode: null,
  message: "",
  error: ""
};

let activeRefreshKind = "";
const manualRefreshLastRequestedAt = {
  full: 0,
  seats: 0
};
let staleFullRefreshLastTriggeredAt = 0;
const autoRefreshSchedule = {
  fullNextAt: "",
  seatsNextAt: ""
};
const requestUrlBase = "http://seoul-cinema-schedule.local";
const maxCredentialByteLength = 4096;

function sendJson(res, status, payload, options = {}) {
  res.writeHead(status, responseHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow, noarchive"
  }));
  if (options.head) {
    res.end();
    return;
  }
  res.end(JSON.stringify(payload, null, 2));
}

function methodNotAllowed(res, allow) {
  res.writeHead(405, responseHeaders({
    allow,
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow, noarchive"
  }));
  res.end("method not allowed");
}

function constantTimeEquals(left, right) {
  const leftText = String(left);
  const rightText = String(right);
  if (Buffer.byteLength(leftText) > maxCredentialByteLength || Buffer.byteLength(rightText) > maxCredentialByteLength) {
    return false;
  }

  const leftBuffer = Buffer.from(leftText);
  const rightBuffer = Buffer.from(rightText);
  const sameLength = leftBuffer.length === rightBuffer.length;
  const comparableRightBuffer = sameLength ? rightBuffer : Buffer.alloc(leftBuffer.length);
  return timingSafeEqual(leftBuffer, comparableRightBuffer) && sameLength;
}

function betaAuthorized(req) {
  if (!betaPassword) return true;

  const header = req.headers.authorization || "";
  if (typeof header !== "string" || Buffer.byteLength(header) > maxCredentialByteLength) return false;
  if (!header.startsWith("Basic ")) return false;

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  if (Buffer.byteLength(decoded) > maxCredentialByteLength) return false;
  const separator = decoded.indexOf(":");
  if (separator === -1) return false;

  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  const userMatches = constantTimeEquals(user, betaUser);
  const passwordMatches = constantTimeEquals(password, betaPassword);
  return userMatches && passwordMatches;
}

function manualRefreshAuthorized(req) {
  if (!refreshToken) return false;

  const token = req.headers["x-refresh-token"];
  if (typeof token !== "string" || Buffer.byteLength(token) > maxCredentialByteLength) return false;
  return constantTimeEquals(token, refreshToken);
}

function denyManualRefresh(res) {
  sendJson(res, 403, {
    ok: false,
    error: "manual refresh is disabled"
  });
}

function manualRefreshCooldownOk(kind, cooldownMs, res) {
  if (!cooldownMs) return true;

  const now = Date.now();
  const elapsedMs = now - (manualRefreshLastRequestedAt[kind] || 0);
  if (elapsedMs < cooldownMs) {
    sendJson(res, 429, {
      ok: false,
      error: "manual refresh cooldown active",
      retryAfterSeconds: Math.ceil((cooldownMs - elapsedMs) / 1000)
    });
    return false;
  }

  manualRefreshLastRequestedAt[kind] = now;
  return true;
}

function sendRefreshAlreadyRunning(res, state) {
  sendJson(res, 202, {
    ok: true,
    refresh: state
  });
}

function sendRefreshConflict(res) {
  sendJson(res, 409, {
    ok: false,
    error: "refresh already running",
    activeRefreshKind: activeRefreshKind || null
  });
}

function sendRefreshDidNotStart(res, state) {
  sendJson(res, 409, {
    ok: false,
    error: state.message || "refresh did not start",
    refresh: state,
    activeRefreshKind: activeRefreshKind || null
  });
}

function startManualRefresh({ res, activeKind, cooldownKind, cooldownMs, state, run }) {
  if (activeRefreshKind) {
    if (activeRefreshKind === activeKind && state.running) {
      sendRefreshAlreadyRunning(res, state);
      return;
    }

    sendRefreshConflict(res);
    return;
  }

  if (state.running) {
    sendRefreshAlreadyRunning(res, state);
    return;
  }

  if (!manualRefreshCooldownOk(cooldownKind, cooldownMs, res)) return;

  const nextState = run();
  if (!nextState.running) {
    sendRefreshDidNotStart(res, nextState);
    return;
  }

  sendJson(res, 202, {
    ok: true,
    refresh: nextState
  });
}

function requestBetaPassword(res) {
  res.writeHead(401, responseHeaders({
    "www-authenticate": 'Basic realm="seoul-cinema-schedule-beta", charset="UTF-8"',
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow, noarchive"
  }));
  res.end("베타 테스트 비밀번호가 필요합니다.");
}

function redirect(res, location) {
  res.writeHead(302, responseHeaders({
    location,
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow, noarchive"
  }));
  res.end();
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) return value[0] || "";
  return String(value || "").split(",")[0].trim();
}

function escapeHtmlAttribute(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeRequestHost(value) {
  const host = firstHeaderValue(value).toLowerCase();
  if (!host || host.length > 253) return "";
  if (!/^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?::\d{1,5})?$/i.test(host)) {
    return "";
  }

  const port = host.includes(":") ? Number(host.split(":").pop()) : 0;
  if (port && (port < 1 || port > 65535)) return "";

  return host;
}

function requestHostname(req) {
  const forwardedHost = safeRequestHost(req.headers["x-forwarded-host"]);
  const host = forwardedHost || safeRequestHost(req.headers.host);
  if (!host) return "";
  return host.split(":")[0].toLowerCase();
}

function indexableRequest(req) {
  if (betaPassword) return false;
  return canonicalHostnames.has(requestHostname(req));
}

function robotsHeaderFor(req) {
  return indexableRequest(req) ? {} : {
    "x-robots-tag": "noindex, nofollow, noarchive"
  };
}

function requestBaseUrl(req) {
  if (publicBaseUrl) return publicBaseUrl;

  const forwardedHost = safeRequestHost(req.headers["x-forwarded-host"]);
  const host = forwardedHost || safeRequestHost(req.headers.host);
  if (!host) return "";

  const forwardedProto = firstHeaderValue(req.headers["x-forwarded-proto"]).toLowerCase();
  const proto = forwardedProto === "http" || forwardedProto === "https"
    ? forwardedProto
    : host === "localhost" || host.startsWith("localhost:") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  return `${proto}://${host}`;
}

async function recommendationPosterPreloadMarkup() {
  try {
    const trends = JSON.parse(await readFile(join(root, "data/community-trends.json"), "utf8"));
    const rawUrl = String(trends.items?.[0]?.posterUrl || "").replace(/\.small\.jpg(?=$|[?#])/i, ".thumb.jpg");
    if (/^\/assets\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/i.test(rawUrl)) {
      return `    <link rel="preload" as="image" href="${escapeHtmlAttribute(rawUrl)}" fetchpriority="high" />`;
    }
    const posterUrl = new URL(rawUrl);
    if (posterUrl.protocol !== "https:") return "";
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

function renderIndexHtml(html, req, preloadMarkup = "") {
  const shouldIndex = indexableRequest(req);
  const safeRobotsContent = shouldIndex ? "index,follow" : "noindex,nofollow,noarchive";
  let nextHtml = html.replace(/(<meta name="robots" content=")[^"]*(" \/>)/, `$1${safeRobotsContent}$2`);
  if (preloadMarkup) nextHtml = nextHtml.replace("  </head>", `${preloadMarkup}\n  </head>`);
  const baseUrl = shouldIndex ? canonicalPublicBaseUrl : requestBaseUrl(req);
  if (!baseUrl) return nextHtml;

  const rootUrl = `${baseUrl}/`;
  const ogImageUrl = `${baseUrl}/assets/og-image.png`;
  const safeRootUrl = escapeHtmlAttribute(rootUrl);
  const safeOgImageUrl = escapeHtmlAttribute(ogImageUrl);

  return nextHtml
    .replace(/(<link rel="canonical" href=")[^"]*(" \/>)/, `$1${safeRootUrl}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(" \/>)/, `$1${safeRootUrl}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(" \/>)/, `$1${safeOgImageUrl}$2`)
    .replace(/(<meta property="og:image:secure_url" content=")[^"]*(" \/>)/, `$1${safeOgImageUrl}$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(" \/>)/, `$1${safeOgImageUrl}$2`);
}

function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function sitemapLastModifiedDate() {
  try {
    const schedule = JSON.parse(await readFile(join(root, "data/schedule.json"), "utf8"));
    const stamp = schedule?.meta?.lastVerifiedAt || schedule?.meta?.generatedAt || "";
    const time = Date.parse(stamp);
    if (!Number.isNaN(time)) return new Date(time).toISOString().slice(0, 10);
  } catch {
    // Fall through to today's date when schedule metadata is unavailable.
  }
  return new Date().toISOString().slice(0, 10);
}

function serveRobots(req, res, options = {}) {
  const body = indexableRequest(req)
    ? `User-agent: *\nAllow: /\n\nSitemap: ${canonicalPublicBaseUrl}/sitemap.xml\n`
    : "User-agent: *\nDisallow: /\n";

  res.writeHead(200, responseHeaders({
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...robotsHeaderFor(req)
  }));
  if (options.head) {
    res.end();
    return;
  }
  res.end(body);
}

async function serveSitemap(req, res, options = {}) {
  if (!indexableRequest(req)) {
    sendJson(res, 404, { error: "not found" }, options);
    return;
  }

  const lastmod = await sitemapLastModifiedDate();
  const loc = escapeXml(`${canonicalPublicBaseUrl}/`);
  const body = [
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

  res.writeHead(200, responseHeaders({
    "content-type": "application/xml; charset=utf-8",
    "cache-control": "no-store"
  }));
  if (options.head) {
    res.end();
    return;
  }
  res.end(body);
}

function publicPath(pathname) {
  try {
    const requested = pathname === "/" ? "/index.html" : pathname;
    const decoded = decodeURIComponent(requested.split("?")[0]);
    if (!decoded.startsWith("/") || decoded.includes("\\") || decoded.includes("\0")) return "";
    if (decoded.split("/").some((segment) => segment === "..")) return "";
    return normalize(decoded);
  } catch {
    return "";
  }
}

function isPublicAssetPath(pathname) {
  const path = publicPath(pathname);
  if (!path) return false;

  if ([
    "/index.html",
    "/robots.txt",
    "/data/schedule.json",
    "/data/community-trends.json",
    "/data/source-health.json",
    "/assets/app.css",
    "/assets/app.js"
  ].includes(path)) {
    return true;
  }

  return /^\/assets\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:png|jpe?g|svg|webp|gif|woff2?)$/i.test(path);
}

function safePath(pathname) {
  const path = publicPath(pathname);
  if (!path) return "";

  const filePath = resolve(root, `.${path}`);
  const relativePath = relative(root, filePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) return "";

  return filePath;
}

function rawRequestPathname(url = "/") {
  const path = String(url || "/").split("?")[0] || "/";
  return path.startsWith("/") ? path : "/";
}

function staticCacheControl(publicFilePath, requestUrl = "") {
  if (publicFilePath.startsWith("/data/")) return "no-cache, must-revalidate";
  const versioned = /(?:\?|&)v=[A-Za-z0-9._-]+(?:&|$)/.test(String(requestUrl));
  if (versioned && ["/assets/app.css", "/assets/app.js"].includes(publicFilePath)) {
    return "public, max-age=31536000, immutable";
  }
  if (publicFilePath.startsWith("/assets/")) return "public, max-age=86400, stale-while-revalidate=604800";
  return "no-cache, must-revalidate";
}

function isMissingFileError(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

function fileEtag(fileStat) {
  return `W/"${fileStat.size.toString(16)}-${Math.trunc(fileStat.mtimeMs).toString(16)}"`;
}

function publicCommunityTrends(trends) {
  return {
    generatedAt: trends.generatedAt || null,
    items: (trends.items || []).slice(0, 4).map((item, index) => ({
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

function requestMatchesEtag(req, etag) {
  return String(req.headers["if-none-match"] || "")
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === etag);
}

async function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    methodNotAllowed(res, "GET, HEAD");
    return;
  }

  const pathname = rawRequestPathname(req.url);
  const publicFilePath = publicPath(pathname);
  if (!isPublicAssetPath(pathname)) {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  const filePath = safePath(pathname);
  if (!filePath) {
    sendJson(res, 400, { error: "bad request" });
    return;
  }

  if (!filePath.startsWith(root)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    throw error;
  }

  if (!fileStat.isFile()) {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  if (publicFilePath === "/data/community-trends.json") {
    const trends = JSON.parse(await readFile(filePath, "utf8"));
    const body = `${JSON.stringify(publicCommunityTrends(trends))}\n`;
    const contentType = mimeTypes[".json"];
    const bodySize = Buffer.byteLength(body);
    const encoding = responseCompression(req, contentType, bodySize);
    const etag = `W/"${bodySize.toString(16)}-${Math.trunc(fileStat.mtimeMs).toString(16)}"`;
    const commonHeaders = {
      "cache-control": staticCacheControl(publicFilePath, req.url),
      etag,
      "last-modified": fileStat.mtime.toUTCString(),
      ...compressionHeaders("", isCompressibleResponse(contentType, bodySize)),
      "x-robots-tag": "noindex, nofollow, noarchive"
    };
    if (requestMatchesEtag(req, etag)) {
      res.writeHead(304, responseHeaders(commonHeaders));
      res.end();
      return;
    }
    res.writeHead(200, responseHeaders({
      "content-type": contentType,
      ...commonHeaders,
      ...(encoding ? { "content-encoding": encoding } : {})
    }));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    pipeResponse(Readable.from([body]), res, encoding);
    return;
  }

  if (staleRequestRefreshEnabled && publicFilePath === "/data/schedule.json") {
    void maybeRunStaleFullRefresh("schedule request");
  }

  if (publicFilePath === "/index.html") {
    let html;
    try {
      html = await readFile(filePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      throw error;
    }
    const preloadMarkup = await recommendationPosterPreloadMarkup();
    const body = renderIndexHtml(html, req, preloadMarkup);
    const contentType = "text/html; charset=utf-8";
    const bodySize = Buffer.byteLength(body);
    const encoding = responseCompression(req, contentType, bodySize);
    res.writeHead(200, responseHeaders({
      "content-type": contentType,
      "cache-control": "no-cache, must-revalidate",
      ...compressionHeaders(encoding, isCompressibleResponse(contentType, bodySize)),
      ...robotsHeaderFor(req)
    }));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    pipeResponse(Readable.from([body]), res, encoding);
    return;
  }

  const contentType = mimeTypes[extname(filePath)] || "application/octet-stream";
  const encoding = responseCompression(req, contentType, fileStat.size);
  const etag = fileEtag(fileStat);
  const commonHeaders = {
    "cache-control": staticCacheControl(publicFilePath, req.url),
    etag,
    "last-modified": fileStat.mtime.toUTCString(),
    ...compressionHeaders("", isCompressibleResponse(contentType, fileStat.size)),
    "x-robots-tag": "noindex, nofollow, noarchive"
  };
  if (requestMatchesEtag(req, etag)) {
    res.writeHead(304, responseHeaders(commonHeaders));
    res.end();
    return;
  }
  res.writeHead(200, responseHeaders({
    "content-type": contentType,
    ...commonHeaders,
    ...(encoding ? { "content-encoding": encoding } : {})
  }));
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on("error", (error) => {
    console.error("Static file stream failed:", error);
    if (!res.headersSent) {
      const missing = isMissingFileError(error);
      sendJson(res, missing ? 404 : 500, { error: missing ? "not found" : "internal server error" });
      return;
    }
    res.destroy(error);
  });
  pipeResponse(stream, res, encoding);
}

function runRefreshProcess({ state, kind, args, startedMessage, completedMessage, failedMessage }) {
  if (state.running) return state;
  if (activeRefreshKind) {
    return {
      ...state,
      message: `${activeRefreshKind} refresh already running`
    };
  }

  activeRefreshKind = kind;
  const startedAt = new Date().toISOString();
  Object.assign(state, {
    running: true,
    startedAt,
    finishedAt: "",
    ok: null,
    exitCode: null,
    message: startedMessage,
    error: ""
  });

  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  let errorOutput = "";
  let settled = false;
  let timedOut = false;
  let forceKillTimeout = null;
  const timeout = refreshProcessTimeoutMs
    ? setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forceKillTimeout = setTimeout(() => child.kill("SIGKILL"), 5000);
        forceKillTimeout.unref?.();
      }, refreshProcessTimeoutMs)
    : null;
  timeout?.unref?.();
  const finish = (updates) => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    if (forceKillTimeout) clearTimeout(forceKillTimeout);
    activeRefreshKind = "";
    Object.assign(state, {
      running: false,
      finishedAt: new Date().toISOString(),
      ...updates
    });
  };

  child.stdout.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-2000);
  });
  child.stderr.on("data", (chunk) => {
    errorOutput = `${errorOutput}${chunk}`.slice(-2000);
  });
  child.on("error", (error) => {
    finish({
      ok: false,
      exitCode: null,
      message: failedMessage,
      error: error.message
    });
  });
  child.on("close", (code, signal) => {
    const ok = code === 0 && !timedOut;
    finish({
      ok,
      exitCode: code,
      message: ok ? completedMessage : failedMessage,
      error: ok
        ? ""
        : timedOut
          ? `refresh timed out after ${refreshProcessTimeoutMinutes} minute(s)`
          : errorOutput || output || `exit ${code ?? "unknown"}${signal ? ` signal ${signal}` : ""}`
    });
  });

  return state;
}

function runUpdater() {
  return runRefreshProcess({
    state: refreshState,
    kind: "full",
    args: ["scripts/refresh-site-data.mjs"],
    startedMessage: "site data refresh started",
    completedMessage: "site data refresh completed",
    failedMessage: "site data refresh failed"
  });
}

function runSeatUpdater() {
  return runRefreshProcess({
    state: seatRefreshState,
    kind: "seat-status",
    args: ["scripts/update-schedule.mjs", "--seat-status"],
    startedMessage: "seat status refresh started",
    completedMessage: "seat status refresh completed",
    failedMessage: "seat status refresh failed"
  });
}

async function scheduleDataStatus() {
  try {
    const json = JSON.parse(await readFile(join(root, "data/schedule.json"), "utf8"));
    const stamp = json?.meta?.lastVerifiedAt || json?.meta?.generatedAt || "";
    const time = Date.parse(stamp);
    const ageMs = Number.isNaN(time) ? null : Date.now() - time;
    return {
      generatedAt: json?.meta?.generatedAt || "",
      lastVerifiedAt: json?.meta?.lastVerifiedAt || "",
      seatStatusVerifiedAt: json?.meta?.seatStatusVerifiedAt || "",
      ageMs,
      stale: fullRefreshIntervalMs ? ageMs === null || ageMs >= fullRefreshIntervalMs : false
    };
  } catch {
    return {
      generatedAt: "",
      lastVerifiedAt: "",
      seatStatusVerifiedAt: "",
      ageMs: null,
      stale: Boolean(fullRefreshIntervalMs)
    };
  }
}

async function maybeRunStaleFullRefresh(reason) {
  if (!fullRefreshIntervalMs || activeRefreshKind || refreshState.running) return;

  const status = await scheduleDataStatus();
  if (!status.stale) return;

  const now = Date.now();
  if (staleRefreshCooldownMs && now - staleFullRefreshLastTriggeredAt < staleRefreshCooldownMs) return;
  staleFullRefreshLastTriggeredAt = now;

  console.log(`Schedule data is stale; starting full refresh from ${reason}.`);
  runUpdater();
}

function msUntilNextAlignedMinute(intervalMinutes, nowMs = Date.now()) {
  const intervalMs = intervalMinutes * 60 * 1000;
  return (Math.floor(nowMs / intervalMs) + 1) * intervalMs - nowMs;
}

function scheduleAlignedRefresh({ key, label, intervalMinutes, run }) {
  const scheduleNext = () => {
    const delayMs = msUntilNextAlignedMinute(intervalMinutes);
    autoRefreshSchedule[`${key}NextAt`] = new Date(Date.now() + delayMs).toISOString();
    const timeout = setTimeout(() => {
      console.log(`Scheduled ${label} refresh started.`);
      run();
      scheduleNext();
    }, delayMs);
    timeout.unref?.();
  };

  scheduleNext();
}

function startAutoRefresh() {
  if (fullRefreshIntervalMs) {
    console.log(`Full schedule refresh enabled every ${fullRefreshIntervalMinutes} minute(s).`);
    scheduleAlignedRefresh({
      key: "full",
      label: "source",
      intervalMinutes: fullRefreshIntervalMinutes,
      run: runUpdater
    });

    scheduleDataStatus().then((status) => {
      if (!status.stale) return;
      console.log(`Schedule data is stale; starting immediate full refresh before aligned refresh at ${autoRefreshSchedule.fullNextAt}.`);
      staleFullRefreshLastTriggeredAt = Date.now();
      runUpdater();
    });
  }

  if (!seatRefreshIntervalMs) return;

  console.log(`Seat status refresh enabled every ${seatRefreshIntervalMinutes} minute(s).`);
  scheduleAlignedRefresh({
    key: "seats",
    label: "seat status",
    intervalMinutes: seatRefreshIntervalMinutes,
    run: runSeatUpdater
  });
}

async function healthPayload() {
  const payload = { ok: true };
  if (!exposeHealthDetails) return payload;
  const dataStatus = await scheduleDataStatus();

  return {
    ...payload,
    data: dataStatus,
    autoRefresh: {
      full: {
        enabled: Boolean(fullRefreshIntervalMs),
        intervalMinutes: fullRefreshIntervalMs ? fullRefreshIntervalMinutes : null,
        alignedToClock: Boolean(fullRefreshIntervalMs),
        requestTriggered: staleRequestRefreshEnabled,
        staleRequestCooldownMinutes: staleRequestRefreshEnabled && staleRefreshCooldownMs ? staleRefreshCooldownMinutes : null,
        nextAt: autoRefreshSchedule.fullNextAt || null,
        running: refreshState.running,
        lastFinishedAt: refreshState.finishedAt || null,
        lastOk: refreshState.ok
      },
      seats: {
        enabled: Boolean(seatRefreshIntervalMs),
        intervalMinutes: seatRefreshIntervalMs ? seatRefreshIntervalMinutes : null,
        alignedToClock: Boolean(seatRefreshIntervalMs),
        nextAt: autoRefreshSchedule.seatsNextAt || null,
        running: seatRefreshState.running,
        lastFinishedAt: seatRefreshState.finishedAt || null,
        lastOk: seatRefreshState.ok
      }
    }
  };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", requestUrlBase);

    if (url.pathname === "/healthz") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        methodNotAllowed(res, "GET, HEAD");
        return;
      }

      sendJson(res, 200, await healthPayload(), { head: req.method === "HEAD" });
      return;
    }

    if (url.pathname === "/favicon.ico") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        methodNotAllowed(res, "GET, HEAD");
        return;
      }

      redirect(res, "/assets/favicon-32.png?v=3");
      return;
    }

    if (url.pathname === "/robots.txt") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        methodNotAllowed(res, "GET, HEAD");
        return;
      }

      serveRobots(req, res, { head: req.method === "HEAD" });
      return;
    }

    if (url.pathname === "/sitemap.xml") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        methodNotAllowed(res, "GET, HEAD");
        return;
      }

      await serveSitemap(req, res, { head: req.method === "HEAD" });
      return;
    }

    if (!betaAuthorized(req)) {
      requestBetaPassword(res);
      return;
    }

    if (url.pathname === "/iphone.html" || url.pathname === "/mobile.html") {
      redirect(res, "/");
      return;
    }

    if (url.pathname === "/api/schedule") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        methodNotAllowed(res, "GET, HEAD");
        return;
      }

      if (staleRequestRefreshEnabled) void maybeRunStaleFullRefresh("api schedule request");
      const json = await readFile(join(root, "data/schedule.json"), "utf8");
      res.writeHead(200, responseHeaders({
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow, noarchive"
      }));
      if (req.method === "HEAD") {
        res.end();
        return;
      }

      res.end(json);
      return;
    }

    if (url.pathname === "/api/refresh") {
      if (req.method !== "POST") {
        methodNotAllowed(res, "POST");
        return;
      }
      if (!manualRefreshAuthorized(req)) {
        denyManualRefresh(res);
        return;
      }

      startManualRefresh({
        res,
        activeKind: "full",
        cooldownKind: "full",
        cooldownMs: manualFullRefreshCooldownMs,
        state: refreshState,
        run: runUpdater
      });
      return;
    }

    if (url.pathname === "/api/refresh-status") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        methodNotAllowed(res, "GET, HEAD");
        return;
      }
      if (!manualRefreshAuthorized(req)) {
        denyManualRefresh(res);
        return;
      }

      sendJson(res, 200, { ok: true, refresh: refreshState }, { head: req.method === "HEAD" });
      return;
    }

    if (url.pathname === "/api/seat-refresh") {
      if (req.method !== "POST") {
        methodNotAllowed(res, "POST");
        return;
      }
      if (!manualRefreshAuthorized(req)) {
        denyManualRefresh(res);
        return;
      }

      startManualRefresh({
        res,
        activeKind: "seat-status",
        cooldownKind: "seats",
        cooldownMs: manualSeatRefreshCooldownMs,
        state: seatRefreshState,
        run: runSeatUpdater
      });
      return;
    }

    if (url.pathname === "/api/seat-refresh-status") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        methodNotAllowed(res, "GET, HEAD");
        return;
      }
      if (!manualRefreshAuthorized(req)) {
        denyManualRefresh(res);
        return;
      }

      sendJson(res, 200, { ok: true, refresh: seatRefreshState }, { head: req.method === "HEAD" });
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendJson(res, 500, { error: "internal server error" });
  }
});

function getLanUrls() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${port}/`);
}

// Mitigate slow-request (Slowloris) attacks by bounding how long a client may take.
server.headersTimeout = 15000;
server.requestTimeout = 30000;
server.maxHeadersCount = 100;

server.listen(port, host, () => {
  console.log(`서울독립영화관시간표 running at http://127.0.0.1:${port}/`);
  if (betaPassword) console.log(`Beta password enabled for user "${betaUser}".`);
  startAutoRefresh();
  getLanUrls().forEach((url) => console.log(`LAN candidate: ${url}`));
});
