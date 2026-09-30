import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./write-file-atomic.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const indexPath = `${root}/index.html`;
const assetPaths = [`${root}/assets/app.css`, `${root}/assets/app.js`, `${root}/assets/map.css`, `${root}/assets/map.js`];
const assets = await Promise.all(assetPaths.map((path) => readFile(path)));
const hash = createHash("sha256");
assets.forEach((asset) => hash.update(asset));
const version = hash.digest("hex").slice(0, 12);
const indexHtml = await readFile(indexPath, "utf8");
const cssMarker = /\/assets\/app\.css\?v=[A-Za-z0-9._-]+/g;
const jsMarker = /\/assets\/app\.js\?v=[A-Za-z0-9._-]+/g;
if ([...indexHtml.matchAll(cssMarker)].length !== 1 || [...indexHtml.matchAll(jsMarker)].length !== 1) {
  throw new Error("index.html must contain exactly one CSS and one JS asset version marker");
}
const versionMarker = /<meta name="asset-version" content="[A-Za-z0-9._-]+" \/>/g;
if ([...indexHtml.matchAll(versionMarker)].length !== 1) {
  throw new Error("index.html must contain exactly one asset-version meta marker");
}
const stampedHtml = indexHtml
  .replace(versionMarker, `<meta name="asset-version" content="${version}" />`)
  .replace(cssMarker, `/assets/app.css?v=${version}`)
  .replace(jsMarker, `/assets/app.js?v=${version}`);

if (stampedHtml !== indexHtml) await writeFileAtomic(indexPath, stampedHtml, "utf8");
console.log(`Stamped frontend assets: ${version}`);
