// Hidden check page (?dtryx-scan): the cinemas' timetable API only answers visitors' browsers,
// so cinema codes for new venues are confirmed by running this once in a real browser. It walks
// a range of cinema codes per brand and lists every code that has a timetable, with the screen
// and film names that tell which cinema it is.
import { browserApiOrigin } from "./browser-live-schedule.mjs";

const companyGuid = "FE8EF4D2-F22D-4802-A39A-D58F23A29C1E";
const brands = ["indieart", "etc", "spacedog", "scinema"];

async function rows(path, brandCd, cinemaCd, values) {
  const params = new URLSearchParams({ BrandCd: brandCd, CinemaCd: cinemaCd, ChannelCd: "homepage", WorkGuID: companyGuid, EngVerYn: "N", MovieCd: "", ...values });
  const response = await fetch(`${browserApiOrigin}/dtryx/cms/thirdparty/movie/${path}?${params}`, { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return Array.isArray(payload?.Recordset) ? payload.Recordset : null;
}

async function probe(brandCd, cinemaCd) {
  const dates = (await rows("third-party-type2-timetable-play-date-list", brandCd, cinemaCd, {}))?.filter((row) => row.HiddenYn !== "Y") || [];
  if (!dates.length) return null;
  const date = String(dates[0].PlaySDT || "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
  const shows = (await rows("third-party-type2-timetable-list", brandCd, cinemaCd, { PlaySDT: date, ImgSize: "small" })) || [];
  const first = shows[0] || {};
  const cinemaName = first.CinemaNm || first.CinemaName || first.BrandNm || "";
  return {
    brandCd, cinemaCd, dates: dates.length, shows: shows.length, cinemaName,
    screens: [...new Set(shows.map((show) => show.ScreenNm).filter(Boolean))].slice(0, 3).join(", "),
    films: [...new Set(shows.map((show) => show.MovieNm).filter(Boolean))].slice(0, 3).join(", "),
    keys: Object.keys(first).filter((key) => /cinema|brand|theater|addr/i.test(key)).join(",")
  };
}

export async function runDtryxScan(target, { from = 1, to = 200, concurrency = 6 } = {}) {
  const jobs = [];
  for (const brandCd of brands) for (let n = from; n <= to; n += 1) jobs.push([brandCd, String(n).padStart(6, "0")]);
  const found = [];
  let done = 0;
  const paint = () => {
    target.textContent = [`디트릭스 영화관 코드 점검 · ${done}/${jobs.length}`, ...found.map((row) => `${row.brandCd} ${row.cinemaCd} | ${row.cinemaName || "-"} | 날짜 ${row.dates} · 오늘 ${row.shows}회 | ${row.screens} | ${row.films}${row.keys ? ` | ${row.keys}` : ""}`)].join("\n");
  };
  paint();
  const queue = [...jobs];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        const hit = await probe(...job);
        if (hit) found.push(hit);
      } catch { /* a code with no cinema */ }
      done += 1;
      found.sort((a, b) => `${a.brandCd}${a.cinemaCd}`.localeCompare(`${b.brandCd}${b.cinemaCd}`));
      paint();
    }
  }));
  target.textContent += "\n끝";
}
