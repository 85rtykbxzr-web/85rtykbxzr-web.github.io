// 지하실 (jihasil.com) online collections for the festivals section.
// The storefront pages are blocked outside Korea, but the catalog rows it loads into the page
// (/catalog/initial_categories) are not; each row is one collection with its films.
// Writes data/jihasil.json. A failed or empty fetch keeps the last copy.
//   node scripts/jihasil.mjs
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./write-file-atomic.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(root, "data/jihasil.json");
const origin = "https://jihasil.com";
const catalogUrl = `${origin}/catalog/initial_categories?ai_recommendations=false&continue_watching=false&my_library=false&preview=false&user=false`;
const headers = { "user-agent": "Mozilla/5.0 (compatible; seoulcinemaschedule)", "accept-language": "ko-KR,ko;q=0.9", accept: "*/*" };
// rows that are a membership shelf rather than a curated programme
const skipTitle = /멤버십|이어\s*보기|내\s*라이브러리/;

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

function text(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().normalize("NFC");
}

function httpsUrl(value) {
  try {
    const url = new URL(decodeEntities(value), origin);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function parseJihasilCatalog(html) {
  const collections = [];
  for (const group of String(html || "").split('<div class="category-group" data-category-id="').slice(1)) {
    const id = group.slice(0, group.indexOf('"'));
    const head = group.match(/class="category-title[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const title = text(head?.[2]);
    if (!id || !title || skipTitle.test(title)) continue;
    const films = [];
    for (const card of group.split("<swiper-slide").slice(1)) {
      const href = card.match(/href="(\/programs\/[^"]+)"/)?.[1];
      const name = text(card.match(/class="card-title"[^>]*title="([^"]*)"/)?.[1]);
      if (!href || !name) continue;
      const slug = href.replace(/^\/programs\//, "").replace(/\?.*$/, "");
      if (films.some((film) => film.slug === slug)) continue;
      const image = card.match(/<img[^>]*\ssrc="([^"]+)"/)?.[1] || "";
      films.push({
        slug,
        title: name,
        year: slug.match(/-((?:18|19|20)\d{2})$/)?.[1] || "",
        url: httpsUrl(`/programs/${slug}`),
        image: httpsUrl(image).replace(/([?&]width=)\d+/, "$1700"),
        publishedAt: card.match(/data-published-at="([^"]+)"/)?.[1] || ""
      });
    }
    if (!films.length) continue;
    const publishedAt = films.map((film) => film.publishedAt).filter(Boolean).sort().at(-1) || "";
    collections.push({ id, title, url: httpsUrl(head[1]), publishedAt, films });
  }
  return collections;
}

async function fetchCatalog(attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(catalogUrl, { headers, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`${response.status} ${catalogUrl}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function refreshJihasil() {
  const collections = parseJihasilCatalog(await fetchCatalog());
  if (!collections.length) throw new Error("지하실: no collections parsed; keeping the last copy.");
  // checkedAt moves once a day at most, so a refresh every few hours doesn't commit a new
  // timestamp each time; the page hides the block when the copy stops being checked.
  const previous = await readFile(outputPath, "utf8").then(JSON.parse).catch(() => null);
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const same = previous && JSON.stringify(previous.collections) === JSON.stringify(collections);
  if (same && previous.checkedOn === today) {
    console.log(`지하실: ${collections.length} collections, unchanged.`);
    return;
  }
  const updatedAt = same && previous.updatedAt ? previous.updatedAt : new Date().toISOString();
  await writeFileAtomic(outputPath, `${JSON.stringify({ source: origin, updatedAt, checkedOn: today, collections })}\n`);
  console.log(`지하실: ${collections.length} collections, ${collections.reduce((sum, item) => sum + item.films.length, 0)} films.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await refreshJihasil();
}
