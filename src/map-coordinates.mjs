// Pin positions (WGS84), checked against OpenStreetMap (Nominatim) on 2026-09-30.
// "named" = OSM has the venue itself; "address" = OSM match for the street address;
// "area" = only the surrounding campus/village could be matched, so the pin is approximate.
// Every venue panel also links to a Naver Map address search, which stays authoritative.
export const venueCoordinates = {
  kofa: [37.58041, 126.88959], // named: 한국영상자료원
  sac: [37.56807, 126.97], // address: 정동길 3
  laika: [37.5652, 126.931], // named: Laika Cinema
  indiespace: [37.55731, 126.92499], // named: indiespace
  momo: [37.5606, 126.94824], // area: 이화여대길 52 (Ewha campus; ECC is near the main gate)
  cinecube: [37.56963, 126.97215], // address: 새문안로 68 흥국생명빌딩
  emu: [37.57209, 126.96901], // address: 경희궁1가길 7
  forest: [37.65417, 127.0613], // named: 더숲 아트시네마
  arirang: [37.60006, 127.01392], // address: 아리랑로 82
  filmforum: [37.56374, 126.94416], // address: 성산로 527 하늬솔빌딩
  sangsangmadang: [37.55099, 126.92107], // named: KT&G 상상마당 빌딩
  artnine: [37.48468, 126.98168], // address: 동작대로 89 (메가박스 이수 building)
  kucine: [37.53936, 127.07716], // area: 능동로 120 (Konkuk campus)
  movieland: [37.54416, 127.05033], // named: 무비랜드
  heyri: [37.78877, 126.69916] // area: 헤이리 예술마을
};
