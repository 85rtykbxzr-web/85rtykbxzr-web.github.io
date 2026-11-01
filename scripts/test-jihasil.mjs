import assert from "node:assert/strict";
import { parseJihasilCatalog } from "./jihasil.mjs";

// The shape of 지하실's catalog rows (trimmed from the live page, 2026-11-01): a category group
// with its title link, then one swiper-slide per film.
const card = (id, slug, title, publishedAt) => `<swiper-slide data-card="video_${id}" data-published-at="${publishedAt}">
  <a class="card-image-container" href="/programs/${slug}?category_id=301188">
    <img loading="lazy" alt="${title}" decoding="async" src="https://alpha.uscreencdn.com/images/programs/${id}/horizontal/a.png?auto=webp&width=350" />
  </a>
  <div class="card-title" title="${title}">${title}</div>
</swiper-slide>`;
const html = `
<div class="category-group" data-category-id="301188">
  <a class="category-title truncate" data-turbo="true" href="/categories/category-yu8sd8pszb0">헤븐 노우즈 왓 특별전</a>
  ${card(1, "close-up-1990", "클로즈 업", "2026-10-13T21:24:16+09:00")}
  ${card(2, "nitram-2021", "니트람", "2026-10-13T21:25:47+09:00")}
  ${card(1, "close-up-1990", "클로즈 업", "2026-10-13T21:24:16+09:00")}
</div>
<div class="category-group" data-category-id="9">
  <a class="category-title" href="/categories/membership">멤버십 전용</a>
  ${card(3, "x-2000", "멤버십 영화", "2026-10-01T00:00:00+09:00")}
</div>`;

const collections = parseJihasilCatalog(html);
assert.equal(collections.length, 1, "membership shelves are not programmes");
const [heaven] = collections;
assert.equal(heaven.title, "헤븐 노우즈 왓 특별전");
assert.equal(heaven.url, "https://jihasil.com/categories/category-yu8sd8pszb0");
assert.deepEqual(heaven.films.map((film) => film.title), ["클로즈 업", "니트람"], "a film listed twice is counted once");
assert.equal(heaven.films[0].year, "1990");
assert.equal(heaven.films[0].url, "https://jihasil.com/programs/close-up-1990");
assert.match(heaven.films[0].image, /width=700$/, "card images are asked for at a usable width");
assert.equal(heaven.publishedAt, "2026-10-13T21:25:47+09:00", "a collection opens with its latest film");
assert.deepEqual(parseJihasilCatalog("<html>changed layout</html>"), [], "an unknown layout parses to nothing, so the last copy is kept");

console.log("지하실 catalog checks passed (collections, films, membership rows, unknown layout).");
