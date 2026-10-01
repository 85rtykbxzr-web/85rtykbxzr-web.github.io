// Film titles as cinemas list them carry screening details: "(2D)", "(GV)", "[기획전]",
// "4K 리마스터링", "+ 시네토크 …". These helpers reduce a listing to the film itself, so
// the same film matches across venues and in a TMDB search.

const editionPatterns = [
  /\b(?:2D|3D|4D|4DX|IMAX|[248]K)\b/gi,
  /(?:디지털\s*)?리마스터(?:링|드)?(?:\s*(?:버전|판))?/g,
  /감독판|확장판|무삭제판?|재개봉|\d+\s*주년(?:\s*기념)?/g
];

export function filmSearchTitle(title) {
  let value = String(title || "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\s\+\s.*$/, "");
  for (const pattern of editionPatterns) value = value.replace(pattern, " ");
  value = value.replace(/\s+/g, " ").trim();
  const [head, ...rest] = value.split(/\s:\s/);
  if (rest.length && head.length >= 2) value = head.trim();
  return value;
}

export function filmTitleKey(title) {
  return filmSearchTitle(title).replace(/[^\p{Letter}\p{Number}]+/gu, "").toLowerCase();
}
