import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    body = JSON.parse(text);
  }
  return { response, body, text };
}

async function waitForServer(baseUrl) {
  let lastError = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const { response, body } = await fetchJson(`${baseUrl}/healthz`);
      if (response.ok && body?.ok === true) return;
    } catch (error) {
      lastError = error;
    }
    await wait(100);
  }
  throw lastError || new Error("server did not become ready");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function headerIncludes(response, name, expected) {
  return String(response.headers.get(name) || "").toLowerCase().includes(String(expected).toLowerCase());
}

function expectSecurityHeaders(response, context) {
  assert(headerIncludes(response, "x-content-type-options", "nosniff"), `${context} missing nosniff header`);
  assert(headerIncludes(response, "x-frame-options", "DENY"), `${context} missing frame denial header`);
  assert(headerIncludes(response, "strict-transport-security", "max-age="), `${context} missing HSTS header`);
  assert(headerIncludes(response, "referrer-policy", "strict-origin-when-cross-origin"), `${context} missing referrer policy`);
  assert(headerIncludes(response, "content-security-policy", "default-src 'self'"), `${context} missing CSP default-src`);
  assert(headerIncludes(response, "content-security-policy", "frame-ancestors 'none'"), `${context} missing CSP frame-ancestors`);
  assert(headerIncludes(response, "content-security-policy", "style-src 'self'"), `${context} allows external styles`);
  assert(headerIncludes(response, "content-security-policy", "style-src-attr 'none'"), `${context} allows inline style attributes`);
  assert(!headerIncludes(response, "content-security-policy", "'unsafe-inline'"), `${context} CSP still allows unsafe-inline`);
  assert(!headerIncludes(response, "content-security-policy", "fonts.googleapis.com"), `${context} CSP still allows remote font styles`);
  assert(headerIncludes(response, "cross-origin-opener-policy", "same-origin"), `${context} missing opener isolation`);
  assert(headerIncludes(response, "origin-agent-cluster", "?1"), `${context} missing origin agent isolation`);
}

function expectNoStore(response, context) {
  assert(headerIncludes(response, "cache-control", "no-store"), `${context} should not be cached`);
}

function expectRevalidated(response, context) {
  assert(headerIncludes(response, "cache-control", "no-cache"), `${context} should be revalidated`);
  assert(!headerIncludes(response, "cache-control", "no-store"), `${context} should remain bfcache eligible`);
}

function expectCacheable(response, context, immutable = false) {
  assert(headerIncludes(response, "cache-control", "max-age="), `${context} should have a cache lifetime`);
  assert(!headerIncludes(response, "cache-control", "no-store"), `${context} should be cacheable`);
  if (immutable) assert(headerIncludes(response, "cache-control", "immutable"), `${context} should be immutable`);
}

function expectNoIndex(response, context) {
  assert(headerIncludes(response, "x-robots-tag", "noindex"), `${context} should not be indexed`);
}

function expectIndexable(response, context) {
  assert(!headerIncludes(response, "x-robots-tag", "noindex"), `${context} should be indexable`);
}

async function expectStatus(baseUrl, pathname, expectedStatus, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  assert(
    response.status === expectedStatus,
    `${options.method || "GET"} ${pathname} expected ${expectedStatus}, got ${response.status}`
  );
  return response;
}

async function main() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      PUBLIC_BASE_URL: "https://example.test",
      HEALTH_DETAILS: "true",
      FULL_REFRESH_INTERVAL_MINUTES: "0",
      SEAT_REFRESH_INTERVAL_MINUTES: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-4000);
  });
  child.stderr.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-4000);
  });
  const exitPromise = once(child, "exit");

  try {
    await waitForServer(baseUrl);

    const { response: healthResponse, body: health } = await fetchJson(`${baseUrl}/healthz`);
    assert(health?.ok === true, "healthz did not return ok true");
    expectSecurityHeaders(healthResponse, "healthz");
    expectNoStore(healthResponse, "healthz");
    expectNoIndex(healthResponse, "healthz");
    assert(
      health?.autoRefresh?.full?.requestTriggered === true,
      "request-triggered source refresh should be enabled by default"
    );

    await expectStatus(baseUrl, "/healthz", 200, { method: "HEAD" });
    const rootResponse = await expectStatus(baseUrl, "/", 200);
    expectSecurityHeaders(rootResponse, "index");
    expectRevalidated(rootResponse, "index");
    expectNoIndex(rootResponse, "index");
    const robotsResponse = await expectStatus(baseUrl, "/robots.txt", 200);
    expectSecurityHeaders(robotsResponse, "robots");
    expectNoStore(robotsResponse, "robots");
    expectNoIndex(robotsResponse, "robots");
    assert((await robotsResponse.text()).includes("Disallow: /"), "non-canonical robots.txt should disallow crawling");
    await expectStatus(baseUrl, "/sitemap.xml", 404);
    const appAssetResponse = await expectStatus(baseUrl, "/assets/app.js?v=smoke", 200);
    expectSecurityHeaders(appAssetResponse, "application asset");
    expectCacheable(appAssetResponse, "application asset", true);
    const assetResponse = await expectStatus(baseUrl, "/assets/og-image.png", 200);
    expectSecurityHeaders(assetResponse, "static asset");
    expectCacheable(assetResponse, "static asset");
    expectNoIndex(assetResponse, "static asset");
    await expectStatus(baseUrl, "/app.js", 404);
    await expectStatus(baseUrl, "/analytics.js", 404);
    await expectStatus(baseUrl, "/styles.css", 404);
    await expectStatus(baseUrl, "/data.js", 404);
    await expectStatus(baseUrl, "/package.json", 404);
    await expectStatus(baseUrl, "/.env", 404);
    await expectStatus(baseUrl, "/data/source-snapshots/kofa-program.html", 404);
    const { response: sourceHealthResponse, body: sourceHealth } = await fetchJson(`${baseUrl}/data/source-health.json`);
    assert(sourceHealthResponse.ok, "source-health.json did not return 200");
    expectSecurityHeaders(sourceHealthResponse, "source health data");
    expectRevalidated(sourceHealthResponse, "source health data");
    expectNoIndex(sourceHealthResponse, "source health data");
    assert(Array.isArray(sourceHealth?.health), "source-health.json has no health rows");
    const { response: trendsResponse, body: trends } = await fetchJson(`${baseUrl}/data/community-trends.json`);
    assert(trendsResponse.ok, "community-trends.json did not return 200");
    expectSecurityHeaders(trendsResponse, "community trends data");
    expectRevalidated(trendsResponse, "community trends data");
    expectNoIndex(trendsResponse, "community trends data");
    assert(
      Object.keys(trends || {}).every((key) => ["generatedAt", "items"].includes(key)),
      "community trends exposes an unexpected top-level field"
    );
    assert(Array.isArray(trends?.items) && trends.items.length === 4, "community trends does not expose four picks");
    assert(!trends.sourceInternal, "community trends exposes internal source metadata");
    assert(trends.items.every((item) => !item.evidence), "community trends exposes source evidence");
    assert(
      trends.items.every((item) =>
        Object.keys(item).every((key) =>
          ["nextDate", "nextTime", "posterSourceUrl", "posterUrl", "rank", "title", "trailerUrl", "url"].includes(key)
        )
      ),
      "community trends exposes an unexpected item field"
    );
    const trendsEtag = trendsResponse.headers.get("etag");
    assert(trendsEtag, "community trends data is missing an ETag");
    const revalidatedTrendsResponse = await fetch(`${baseUrl}/data/community-trends.json`, {
      headers: { "if-none-match": trendsEtag }
    });
    assert(revalidatedTrendsResponse.status === 304, "matching community trends ETag did not return 304");
    const deniedRefresh = await expectStatus(baseUrl, "/api/refresh", 403, { method: "POST" });
    expectSecurityHeaders(deniedRefresh, "denied refresh");
    expectNoStore(deniedRefresh, "denied refresh");
    expectNoIndex(deniedRefresh, "denied refresh");
    await expectStatus(baseUrl, "/api/refresh-status", 403);
    await expectStatus(baseUrl, "/api/seat-refresh", 403, { method: "POST" });
    await expectStatus(baseUrl, "/api/seat-refresh-status", 403);

    const { response: scheduleResponse, body: schedule } = await fetchJson(`${baseUrl}/data/schedule.json`);
    assert(scheduleResponse.ok, "schedule.json did not return 200");
    expectSecurityHeaders(scheduleResponse, "schedule data");
    expectRevalidated(scheduleResponse, "schedule data");
    expectNoIndex(scheduleResponse, "schedule data");
    assert(Array.isArray(schedule?.sessions) && schedule.sessions.length > 0, "schedule.json has no sessions");
    const scheduleEtag = scheduleResponse.headers.get("etag");
    assert(scheduleEtag, "schedule data is missing an ETag");
    const revalidatedScheduleResponse = await fetch(`${baseUrl}/data/schedule.json`, {
      headers: { "if-none-match": scheduleEtag }
    });
    assert(revalidatedScheduleResponse.status === 304, "matching schedule ETag did not return 304");
    const compressedScheduleResponse = await fetch(`${baseUrl}/data/schedule.json`, {
      headers: { "accept-encoding": "br" }
    });
    assert(compressedScheduleResponse.ok, "compressed schedule did not return 200");
    assert(headerIncludes(compressedScheduleResponse, "content-encoding", "br"), "schedule did not negotiate Brotli");
    assert((await compressedScheduleResponse.json()).sessions.length > 0, "Brotli schedule body was invalid");
    const gzipScheduleResponse = await fetch(`${baseUrl}/data/schedule.json`, {
      headers: { "accept-encoding": "br;q=0, gzip;q=1" }
    });
    assert(headerIncludes(gzipScheduleResponse, "content-encoding", "gzip"), "schedule ignored encoding q-values");
    assert((await gzipScheduleResponse.json()).sessions.length > 0, "gzip schedule body was invalid");
    const uncompressedScheduleResponse = await fetch(`${baseUrl}/data/schedule.json`, {
      headers: { "accept-encoding": "br;q=0, gzip;q=0" }
    });
    assert(!uncompressedScheduleResponse.headers.get("content-encoding"), "schedule used an explicitly rejected encoding");
    assert((await uncompressedScheduleResponse.json()).sessions.length > 0, "uncompressed schedule body was invalid");

    const indexResponse = await fetch(`${baseUrl}/`);
    const indexHtml = await indexResponse.text();
    assert(/rel="preload" as="image" href="(?:https:\/\/|\/assets\/)/.test(indexHtml), "index is missing poster preload");
    const structuredData = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] || "";
    const structuredDataHash = `sha256-${createHash("sha256").update(structuredData).digest("base64")}`;
    assert(structuredData, "index is missing structured data");
    assert(
      headerIncludes(indexResponse, "content-security-policy", `'${structuredDataHash}'`),
      "CSP does not allow the exact structured-data script hash"
    );
    assert(
      indexHtml.includes('property="og:url" content="https://example.test/"'),
      "index did not use PUBLIC_BASE_URL for og:url"
    );
    assert(
      indexHtml.includes('property="og:image" content="https://example.test/assets/og-image.png"'),
      "index did not use PUBLIC_BASE_URL for og:image"
    );
    assert(
      indexHtml.includes('name="robots" content="noindex,nofollow,noarchive"'),
      "non-canonical index should keep noindex meta"
    );

    const canonicalHeaders = {
      "x-forwarded-host": "seoulcinemaschedule.com",
      "x-forwarded-proto": "https"
    };
    const canonicalIndexResponse = await fetch(`${baseUrl}/`, { headers: canonicalHeaders });
    expectSecurityHeaders(canonicalIndexResponse, "canonical index");
    expectRevalidated(canonicalIndexResponse, "canonical index");
    expectIndexable(canonicalIndexResponse, "canonical index");
    const canonicalIndexHtml = await canonicalIndexResponse.text();
    assert(
      canonicalIndexHtml.includes('name="robots" content="index,follow"'),
      "canonical index should allow indexing in meta robots"
    );
    assert(
      canonicalIndexHtml.includes('rel="canonical" href="https://seoulcinemaschedule.com/"'),
      "canonical link should point at production domain"
    );
    assert(
      canonicalIndexHtml.includes('property="og:url" content="https://seoulcinemaschedule.com/"'),
      "canonical og:url should point at production domain"
    );

    const canonicalRobotsResponse = await fetch(`${baseUrl}/robots.txt`, { headers: canonicalHeaders });
    expectSecurityHeaders(canonicalRobotsResponse, "canonical robots");
    expectNoStore(canonicalRobotsResponse, "canonical robots");
    expectIndexable(canonicalRobotsResponse, "canonical robots");
    const canonicalRobots = await canonicalRobotsResponse.text();
    assert(canonicalRobots.includes("Allow: /"), "canonical robots.txt should allow crawling");
    assert(canonicalRobots.includes("Sitemap: https://seoulcinemaschedule.com/sitemap.xml"), "canonical robots.txt should advertise sitemap");

    const sitemapResponse = await fetch(`${baseUrl}/sitemap.xml`, { headers: canonicalHeaders });
    expectSecurityHeaders(sitemapResponse, "sitemap");
    expectNoStore(sitemapResponse, "sitemap");
    expectIndexable(sitemapResponse, "sitemap");
    const sitemapXml = await sitemapResponse.text();
    assert(sitemapXml.includes("<loc>https://seoulcinemaschedule.com/</loc>"), "sitemap should include canonical homepage");

    console.log("Server smoke test passed.");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    const exit = await Promise.race([
      exitPromise,
      wait(2000).then(() => {
        child.kill("SIGKILL");
        return exitPromise;
      })
    ]);
    const [code, signal] = exit;
    if (code !== 0 && signal !== "SIGTERM") {
      throw new Error(`server exited with ${code ?? signal}${output ? `\n${output}` : ""}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
