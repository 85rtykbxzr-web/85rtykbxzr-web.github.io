import { readFile, stat } from "node:fs/promises";

const appPath = "app.js";
const indexPath = "index.html";
const schedulePath = "data/schedule.json";
const trendsPath = "data/community-trends.json";
const ogImagePath = "assets/og-image.png";
const expectedOgSize = { width: 1200, height: 630 };
const minimumRasterSize = { width: 24, height: 24 };

function fail(message, detail = "") {
  return detail ? `${message}: ${detail}` : message;
}

async function readText(path) {
  return readFile(path, "utf8");
}

function normalizeAssetPath(raw) {
  return String(raw || "")
    .replace(/^\.?\//, "")
    .replace(/[?#].*$/, "");
}

function collectAssetReferences(...texts) {
  const refs = new Set();
  const patterns = [
    /["'(](\.?\/?assets\/[^"'()?#\s]+\.(?:png|jpe?g|svg|gif|webp|txt))/gi,
    /\b(assets\/[^"'()?#\s]+\.(?:png|jpe?g|svg|gif|webp|txt))/gi
  ];

  for (const text of texts) {
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text))) refs.add(normalizeAssetPath(match[1]));
    }
  }

  return [...refs].sort();
}

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function jpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;

    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }

    offset += 2 + length;
  }

  return null;
}

function svgSize(text) {
  const viewBox = text.match(/\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
  if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) };

  const width = text.match(/\bwidth=["']([\d.]+)/i);
  const height = text.match(/\bheight=["']([\d.]+)/i);
  if (width && height) return { width: Number(width[1]), height: Number(height[1]) };
  return null;
}

async function imageSize(path) {
  const buffer = await readFile(path);
  if (/\.png$/i.test(path)) return pngSize(buffer);
  if (/\.jpe?g$/i.test(path)) return jpegSize(buffer);
  if (/\.svg$/i.test(path)) return svgSize(buffer.toString("utf8"));
  return null;
}

function metaContent(name, html) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta\\s+(?:property|name)=["']${escapedName}["']\\s+content=["']([^"']+)["']`, "i");
  return html.match(pattern)?.[1] || "";
}

function extractStringMap(appText, objectName) {
  const escapedName = objectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = appText.match(new RegExp(`const\\s+${escapedName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\s*\\};`));
  if (!match) return {};

  const map = {};
  const rowPattern = /^\s*([A-Za-z0-9_-]+):\s*"([^"]+)"/gm;
  let row;
  while ((row = rowPattern.exec(match[1]))) map[row[1]] = row[2];
  return map;
}

function extractVenueMarkAssets(appText) {
  return Object.fromEntries(
    Object.entries(extractStringMap(appText, "venueMarkAssets")).map(([venueId, assetPath]) => [
      venueId,
      normalizeAssetPath(assetPath)
    ])
  );
}

async function main() {
  const [appText, indexHtml, schedule, trendsText] = await Promise.all([
    readText(appPath),
    readText(indexPath),
    readFile(schedulePath, "utf8").then(JSON.parse),
    readText(trendsPath)
  ]);
  const errors = [];

  const referencedAssets = collectAssetReferences(appText, indexHtml, trendsText);
  for (const assetPath of referencedAssets) {
    try {
      const info = await stat(assetPath);
      if (!info.isFile()) errors.push(fail("Asset reference is not a file", assetPath));
    } catch {
      errors.push(fail("Asset reference is missing", assetPath));
    }
  }

  const ogSize = await imageSize(ogImagePath);
  if (!ogSize) {
    errors.push(fail("OG image dimensions could not be read", ogImagePath));
  } else if (ogSize.width !== expectedOgSize.width || ogSize.height !== expectedOgSize.height) {
    errors.push(fail("OG image has unexpected dimensions", `${ogImagePath} ${ogSize.width}x${ogSize.height}`));
  }

  const metaWidth = Number(metaContent("og:image:width", indexHtml));
  const metaHeight = Number(metaContent("og:image:height", indexHtml));
  if (metaWidth !== expectedOgSize.width || metaHeight !== expectedOgSize.height) {
    errors.push(fail("OG image meta dimensions do not match expected size", `${metaWidth}x${metaHeight}`));
  }

  const venueMarkAssets = extractVenueMarkAssets(appText);
  const venueAddresses = extractStringMap(appText, "venueAddresses");
  const venueClosedDays = extractStringMap(appText, "venueClosedDays");
  const venueMarkText = extractStringMap(appText, "venueMarkText");
  const venueIds = new Set((schedule.venues || []).map((venue) => venue.id));

  for (const [mapName, map] of [
    ["venueAddresses", venueAddresses],
    ["venueClosedDays", venueClosedDays],
    ["venueMarkAssets", venueMarkAssets],
    ["venueMarkText", venueMarkText]
  ]) {
    for (const venueId of Object.keys(map)) {
      if (!venueIds.has(venueId)) errors.push(fail(`${mapName} references an unknown venue`, venueId));
    }
  }

  for (const venue of schedule.venues || []) {
    if (!venueAddresses[venue.id]) errors.push(fail("Venue is missing an address mapping", `${venue.id} ${venue.name || ""}`));
    if (!venueClosedDays[venue.id]) errors.push(fail("Venue is missing a closed-day mapping", `${venue.id} ${venue.name || ""}`));
    if (!venueMarkText[venue.id]) errors.push(fail("Venue is missing a logo text fallback", `${venue.id} ${venue.name || ""}`));

    const assetPath = venueMarkAssets[venue.id];
    if (!assetPath) {
      errors.push(fail("Venue is missing a logo asset mapping", `${venue.id} ${venue.name || ""}`));
      continue;
    }

    if (!referencedAssets.includes(assetPath)) {
      errors.push(fail("Venue logo asset is not referenced consistently", `${venue.id} ${assetPath}`));
    }

    const size = await imageSize(assetPath);
    if (!size) {
      errors.push(fail("Venue logo dimensions could not be read", `${venue.id} ${assetPath}`));
      continue;
    }
    if (size.width < minimumRasterSize.width || size.height < minimumRasterSize.height) {
      errors.push(fail("Venue logo is too small", `${venue.id} ${assetPath} ${size.width}x${size.height}`));
    }
  }

  if (errors.length) {
    console.error(`Static asset audit failed with ${errors.length} issue(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        referencedAssets: referencedAssets.length,
        venuesWithLogos: (schedule.venues || []).length,
        ogImage: `${expectedOgSize.width}x${expectedOgSize.height}`
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
