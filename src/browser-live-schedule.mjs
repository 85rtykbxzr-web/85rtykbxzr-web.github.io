const companyGuid = "FE8EF4D2-F22D-4802-A39A-D58F23A29C1E";
export const browserLiveConfigs = [
  { venueId: "momo", sourceId: "momo-dtryx-showtimes", name: "아트하우스 모모", brandCd: "indieart", cinemaCd: "000067", dateGuid: "324A2914-AB19-42A3-BDFE-58A08B2DC35D", workGuid: "37E0BA0F-DA5F-4376-9BA4-B5D27286AB87", minimum: 20, minimumDates: 3, officialUrl: "https://arthousemomo.co.kr/showtimes" },
  { venueId: "emu", sourceId: "emu-dtryx-showtimes", name: "에무시네마", brandCd: "indieart", cinemaCd: "000069", workGuid: "37E0BA0F-DA5F-4376-9BA4-B5D27286AB87", minimum: 10, minimumDates: 2, officialUrl: "http://www.emuartspace.com/main/emuartspace/" },
  { venueId: "arirang", sourceId: "arirang-dtryx-showtimes", name: "아리랑시네센터", brandCd: "etc", cinemaCd: "000088", workGuid: "ADF5F3D5-BF7B-4449-9AA2-16858E197DDA", minimum: 4, minimumDates: 1, officialUrl: "https://cine.arirang.go.kr:8443/arirang/index.do" },
  { venueId: "artnine", sourceId: "artnine-dtryx-showtimes", name: "아트나인", brandCd: "etc", cinemaCd: "000162", workGuid: "ADF5F3D5-BF7B-4449-9AA2-16858E197DDA", minimum: 10, minimumDates: 2, officialUrl: "https://litt.ly/artnine" },
  { venueId: "laika", sourceId: "laika-dtryx-showtimes", name: "라이카시네마", brandCd: "spacedog", cinemaCd: "000072", workGuid: companyGuid, minimum: 20, minimumDates: 3, officialUrl: "https://www.dtryx.com/cinema/main.do?BrandCd=spacedog&CinemaCd=000072" },
  { venueId: "forest", sourceId: "forest-schedule", name: "더숲아트시네마", brandCd: "indieart", cinemaCd: "000065", workGuid: "81630DDE-489C-4034-A6FB-9AD54E055E5B", minimum: 10, minimumDates: 2, officialUrl: "https://www.dtryx.com/cinema/main.do?BrandCd=indieart&CinemaCd=000065" },
  { venueId: "heyri", sourceId: "heyri-dtryx-showtimes", name: "헤이리시네마", brandCd: "indieart", cinemaCd: "000071", workGuid: companyGuid, minimum: 8, minimumDates: 2, reserveBaseUrl: "https://scinema.org", officialUrl: "https://scinema.org/cinema/main.do?BrandCd=indieart&CinemaCd=000071" }
];
export const browserLiveSourceIds = new Set(browserLiveConfigs.map((config) => config.sourceId));
const venueIds = new Set(browserLiveConfigs.map((config) => config.venueId));
export const browserApiOrigin = "https://api.dtryx.com:30443";
export const browserCollectionMode = "browser-live";

export function usesBrowserLive(schedule) {
  return schedule?.meta?.collectionMode === browserCollectionMode;
}
export function isBrowserLiveVenue(schedule, venueId) {
  return usesBrowserLive(schedule) && venueIds.has(venueId);
}

export function prepareBrowserLiveSchedule(schedule) {
  return {
    ...schedule,
    meta: { ...schedule.meta, collectionMode: browserCollectionMode, browserLiveVenueIds: [...venueIds] },
    // Server snapshots never retain a frozen timetable for a browser-owned venue.
    sessions: schedule.sessions.filter((session) => !venueIds.has(session.venueId)),
    sources: schedule.sources.map((source) => browserLiveSourceIds.has(source.id)
      ? { ...source, collectionMode: "browser", lastOk: null, lastCheckedAt: null, lastSeatCheckedAt: null, lastSeatOk: null, liveSessionCount: 0, liveDateCount: 0 }
      : source)
  };
}

export function deferredBrowserHealth(checkedAt) {
  return browserLiveConfigs.map((config) => ({
    sourceId: config.sourceId, url: config.officialUrl, ok: null, status: null,
    blocking: false, deferredToBrowser: true, checkedAt,
    parserStatus: "browser-api", liveSessionCount: 0,
    note: "Official timetable and seats are fetched in the visitor browser; no server verification is claimed."
  }));
}

export function assertBrowserCollectionContract(schedule, health) {
  if (!usesBrowserLive(schedule)) {
    if ((health?.health || []).some((row) => row.deferredToBrowser)) throw new Error("Browser sources require explicit browser-live collection mode");
    return;
  }
  const configured = schedule.meta.browserLiveVenueIds;
  if (!Array.isArray(configured) || configured.length !== venueIds.size || new Set(configured).size !== venueIds.size || configured.some((id) => !venueIds.has(id))) {
    throw new Error("Browser-live venue contract is incomplete");
  }
  if (schedule.sessions.some((session) => venueIds.has(session.venueId))) throw new Error("Server payload contains unverified browser-owned sessions");
  for (const config of browserLiveConfigs) {
    if (!schedule.venues.some((venue) => venue.id === config.venueId) || !schedule.sources.some((source) => source.id === config.sourceId && source.venueId === config.venueId && source.collectionMode === "browser")) throw new Error("Browser-live source configuration is missing");
  }
  const deferred = (health?.health || []).filter((row) => row.deferredToBrowser);
  if (deferred.length !== browserLiveConfigs.length || new Set(deferred.map((row) => row.sourceId)).size !== browserLiveConfigs.length) throw new Error("Browser-live health contract is incomplete");
  for (const row of deferred) {
    if (!browserLiveSourceIds.has(row.sourceId) || row.ok !== null || row.status !== null || row.blocking !== false || row.liveSessionCount !== 0) throw new Error("Deferred source claims server verification");
  }
}

function todayKst(now) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function dateValue(value) {
  const text = String(value || "");
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  const date = compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("공식 날짜 형식을 확인할 수 없습니다.");
  return date;
}

export function browserSession(config, item, date) {
  const time = String(item.StartTime || "").match(/^(\d{1,2}):(\d{2})/)?.slice(1).map((part) => part.padStart(2, "0")).join(":");
  if (!time || Number(time.slice(0, 2)) > 29 || Number(time.slice(3)) > 59 || !item.MovieNm || !item.MovieCd || !item.ScreenCd || item.ShowSeq == null) throw new Error("공식 상영회차의 필수 정보가 누락됐습니다.");
  if (item.PlaySDT && dateValue(item.PlaySDT) !== date) throw new Error("공식 상영회차의 날짜가 요청과 다릅니다.");
  const remaining = item.SeatRemainCnt ?? item.RemainSeatCnt;
  if (item.CinemaCd && String(item.CinemaCd) !== config.cinemaCd) throw new Error("공식 상영회차의 영화관이 요청과 다릅니다.");
  if (remaining != null && (!Number.isFinite(Number(remaining)) || Number(remaining) < 0)) throw new Error("공식 잔여 좌석 수를 확인할 수 없습니다.");
  const reserve = String(item.NextSkipYn || "").toUpperCase() !== "N";
  const program = item.PlayTimeTypeNm || item.ScreeningInfo || "상영시간표";
  const params = new URLSearchParams({ MovieCd: String(item.MovieCd), PlaySDT: date, ScreenCd: String(item.ScreenCd), ShowSeq: String(item.ShowSeq) });
  let bookingUrl;
  if (config.venueId === "momo") bookingUrl = `https://arthousemomo.co.kr/pages/ti.php?${params}`;
  else {
    params.set("BrandCd", config.brandCd);
    params.set("CinemaCd", config.cinemaCd);
    params.set("cgid", config.venueId === "forest" ? config.workGuid : companyGuid);
    bookingUrl = `${config.reserveBaseUrl || "https://www.dtryx.com"}/reserve/movie.do?${params}`;
  }
  return {
    id: `live-${config.venueId}-${date.replaceAll("-", "")}-${item.MovieCd}-${item.ScreenCd}-${item.ShowSeq}`,
    date, time, timeSort: time, title: item.MovieNm, venueId: config.venueId,
    screen: item.ScreenNm || config.name, program,
    kind: /영화제/.test(program) ? "festival" : /GV|관객과의 대화|톡|토크|강연/.test(program) ? "talk" : "program",
    status: !reserve ? "needs-check" : remaining != null && Number(remaining) === 0 ? "soldout" : "confirmed",
    tags: [item.RatingNm, item.RunningTime ? `${item.RunningTime}분` : "", item.ScreeningInfo].filter(Boolean),
    summary: reserve ? `${item.ScreenNm || config.name} · 잔여 ${remaining ?? "?"}/${item.TotalSeatCnt ?? "?"}석` : "공식 예매 가능 여부 확인 필요",
    bookingUrl, bookingType: reserve ? "booking" : "official", actionLabel: reserve ? "예매" : "공식 확인",
    sourceId: config.sourceId, posterUrl: item.PosterUrl || item.ImgUrl || item.Url || ""
  };
}

async function apiRows(path, config, values, fetchImpl) {
  const params = new URLSearchParams({ BrandCd: config.brandCd, CinemaCd: config.cinemaCd, ChannelCd: "homepage", WorkGuID: config.workGuid, EngVerYn: "N", ...values });
  const response = await fetchImpl(`${browserApiOrigin}/dtryx/cms/thirdparty/movie/${path}?${params}`, {
    credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`공식 시간표 응답 오류 (${response.status})`);
  const payload = await response.json();
  if (String(payload.RetCode).toLowerCase() !== "success" || !Array.isArray(payload.Recordset)) throw new Error("공식 시간표 응답을 확인하지 못했습니다.");
  return payload.Recordset;
}

export async function fetchBrowserVenue(config, { fetchImpl = fetch, now = new Date() } = {}) {
  const today = todayKst(now);
  const dates = (await apiRows("third-party-type2-timetable-play-date-list", config, { MovieCd: "", WorkGuID: config.dateGuid || config.workGuid }, fetchImpl))
    .filter((row) => row.HiddenYn !== "Y").map((row) => dateValue(row.PlaySDT)).filter((date) => date >= today).slice(0, 14);
  if (!dates.length || new Set(dates).size !== dates.length) throw new Error("공식 상영 날짜를 확인하지 못했습니다.");
  const sessions = [];
  for (const date of dates) {
    const rows = await apiRows("third-party-type2-timetable-list", config, { PlaySDT: date, ImgSize: "small" }, fetchImpl);
    sessions.push(...rows.map((item) => browserSession(config, item, date)));
  }
  if (new Set(sessions.map((session) => session.id)).size !== sessions.length) throw new Error("공식 상영회차가 중복됐습니다.");
  const naturalKeys = sessions.map((session) => `${session.date}|${session.time}|${session.screen}|${session.title}`);
  if (new Set(naturalKeys).size !== sessions.length) throw new Error("공식 상영회차가 중복됐습니다.");
  const activeDates = new Set(sessions.map((session) => session.date));
  if (sessions.length < config.minimum || activeDates.size < config.minimumDates) throw new Error("공식 시간표가 평소보다 적어 추가 확인이 필요합니다.");
  return { venueId: config.venueId, sourceId: config.sourceId, sessions, checkedAt: new Date().toISOString(), status: "ok" };
}

export async function refreshBrowserLiveSchedule(base, { fetchImpl = fetch, onProgress = () => {}, now = new Date() } = {}) {
  if (!usesBrowserLive(base)) return base;
  let result = { ...base, meta: { ...base.meta, browserLive: browserLiveConfigs.map((config) => ({ venueId: config.venueId, status: "pending" })) } };
  onProgress(result);
  // One timetable request per cinema at a time; seven small independent streams.
  await Promise.all(browserLiveConfigs.map(async (config) => {
    let outcome;
    try { outcome = await fetchBrowserVenue(config, { fetchImpl, now }); }
    catch (error) { outcome = { venueId: config.venueId, status: "error", message: error.message }; }
    const sessions = result.sessions.filter((session) => session.venueId !== config.venueId);
    if (outcome.status === "ok") sessions.push(...outcome.sessions);
    sessions.sort((a, b) => `${a.date} ${a.timeSort} ${a.id}`.localeCompare(`${b.date} ${b.timeSort} ${b.id}`));
    const browserLive = result.meta.browserLive.map((row) => row.venueId === config.venueId ? { venueId: outcome.venueId, status: outcome.status, checkedAt: outcome.checkedAt || null, message: outcome.message || "", sessions: outcome.sessions?.length || 0 } : row);
    result = { ...result, sessions, meta: { ...result.meta, browserLive } };
    onProgress(result);
  }));
  return result;
}
