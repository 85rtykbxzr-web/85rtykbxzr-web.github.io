// Independent and art-house cinemas outside Seoul. They all sell through dtryx, whose timetable
// API answers visitors' browsers but not our servers, so these venues never enter the server
// schedule: the page fetches them itself when the 지역 view or the map needs them. Cinema codes
// were confirmed with the ?dtryx-scan page on 2026-10-03; coordinates and addresses come from
// Kakao Map search.
const companyGuid = "FE8EF4D2-F22D-4802-A39A-D58F23A29C1E";

export const regionalVenues = [
  { id: "motungi", name: "모퉁이극장", area: "부산 중구", address: "부산 중구 광복중앙로 13", coords: [35.1006, 129.0309], brandCd: "etc", cinemaCd: "000097", mark: "모퉁이" },
  { id: "ohoh", name: "오오극장", area: "대구 중구", address: "대구 중구 국채보상로 537", coords: [35.87066, 128.58945], brandCd: "indieart", cinemaCd: "000059", mark: "오오" },
  { id: "gwangjucine", name: "광주극장", area: "광주 동구", address: "광주 동구 충장로46번길 10", coords: [35.14993, 126.91231], brandCd: "indieart", cinemaCd: "000066", mark: "광주극장" },
  { id: "cineindieu", name: "씨네인디U", area: "대전 중구", address: "대전 중구 계백로 1712", coords: [36.32125, 127.40987], brandCd: "etc", cinemaCd: "000098", mark: "인디U" },
  { id: "jeonjuindie", name: "전주디지털독립영화관", area: "전주 완산구", address: "전북 전주시 완산구 전주객사3길 22", coords: [35.81835, 127.1427], brandCd: "indieart", cinemaCd: "000061", mark: "전주독립" },
  { id: "rhizome", name: "씨네아트 리좀", area: "창원 마산", address: "경남 창원시 마산합포구 동서북14길 24", coords: [35.20608, 128.57577], brandCd: "indieart", cinemaCd: "000053", mark: "리좀" },
  { id: "indiepohang", name: "인디플러스 포항", area: "포항 북구", address: "경북 포항시 북구 서동로 83", coords: [36.04086, 129.36721], brandCd: "indieart", cinemaCd: "000057", mark: "인디+포항" },
  { id: "indiecheonan", name: "인디플러스 천안", area: "천안 동남구", address: "충남 천안시 동남구 중앙로 111", coords: [36.80859, 127.15227], brandCd: "indieart", cinemaCd: "000068", mark: "인디+천안" },
  { id: "mokpoart", name: "목포아트시네마", area: "목포", address: "전남 목포시 영산로59번길 30", coords: [34.79058, 126.38388], brandCd: "indieart", cinemaCd: "000166", mark: "목포아트" },
  { id: "cinemamm", name: "시네마엠엠", area: "목포", address: "전남 목포시 백년대로 394", coords: [34.80786, 126.42959], brandCd: "etc", cinemaCd: "000146", mark: "MM" }
].map((venue) => ({
  ...venue,
  region: "regional",
  type: "독립·예술영화관",
  url: `https://www.dtryx.com/cinema/main.do?cgid=${companyGuid}&BrandCd=${venue.brandCd}&CinemaCd=${venue.cinemaCd}`,
  accent: "teal"
}));

export const regionalVenueIds = new Set(regionalVenues.map((venue) => venue.id));

// Venues the server schedule already carries that sit outside Seoul: they keep their own
// collection and only move to the 지역 view.
export const serverVenuesOutsideSeoul = new Set(["heyri"]);

// Small single-screen houses: a day with one screening is normal, so one session on one date
// is enough to trust an answer.
export const regionalLiveConfigs = regionalVenues.map((venue) => ({
  venueId: venue.id,
  sourceId: `${venue.id}-dtryx-showtimes`,
  name: venue.name,
  brandCd: venue.brandCd,
  cinemaCd: venue.cinemaCd,
  workGuid: companyGuid,
  minimum: 1,
  minimumDates: 1,
  // a week ahead keeps the requests from ten venues modest
  maxDates: 7,
  officialUrl: venue.url
}));
