import { browserLiveConfigs, usesBrowserLive, refreshBrowserLiveSchedule } from "./src/browser-live-schedule.mjs";
import { addCalendarDays, addCalendarMonths, calendarDaysBetween } from "./src/calendar-date.mjs";
import {
  isFestivalSession,
  isGenericFestivalSectionLabel,
  resolveFestivalName
} from "./src/festival-labels.mjs";
import { safePublicUrl } from "./src/public-url-policy.mjs";
import { isPastKstSession, kstSessionStartMs } from "./src/session-time.mjs";

(function () {
  const analyticsHostnames = new Set(["seoulcinemaschedule.com", "www.seoulcinemaschedule.com"]);
  if (analyticsHostnames.has(window.location.hostname) && navigator.doNotTrack !== "1") {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("config", "G-GQNT88MLH4");
    const analyticsScript = document.createElement("script");
    analyticsScript.async = true;
    analyticsScript.src = "https://www.googletagmanager.com/gtag/js?id=G-GQNT88MLH4";
    document.head.append(analyticsScript);
  }

  const state = {
    data: null,
    browserRefreshId: 0,
    query: "",
    date: null,
    linkFilter: "all",
    venueFilter: "all",
    favoriteVenueIds: new Set(),
    hashSyncKey: "",
    dataRefreshing: false,
    dataSignature: "",
    lastDataRefreshAt: 0,
    currentKstDate: "",
    lastRenderedMobileLayout: null,
    view: "today",
    communityTrends: null
  };

  const favoriteVenueStorageKey = "cineSeoulFavoriteVenues";
  const scheduleDataRefreshCooldownMs = 10 * 60 * 1000;
  const dateRolloverCheckMs = 60 * 1000;
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const venueAddresses = {
    kofa: "서울 마포구 월드컵북로 400 한국영상자료원",
    sac: "서울 중구 정동길 3 경향아트힐 2층",
    laika: "서울 서대문구 연희로8길 18 스페이스독 1층",
    indiespace: "서울 마포구 양화로 176 와이즈파크 8층",
    momo: "서울 서대문구 이화여대길 52 ECC B402",
    cinecube: "서울 종로구 새문안로 68 흥국생명빌딩 B2",
    emu: "서울 종로구 경희궁1가길 7",
    forest: "서울 노원구 노해로 480 조광빌딩 지하1층",
    arirang: "서울 성북구 아리랑로 82 아리랑시네센터",
    filmforum: "서울 서대문구 성산로 527 하늬솔빌딩 A동 지하1층",
    sangsangmadang: "서울 마포구 어울마당로 65 KT&G 상상마당 B4",
    movieland: "서울특별시 성동구 연무장길 5-5",
    artnine: "서울 동작구 동작대로 89 골든시네마타워 12층",
    kucine: "서울 광진구 능동로 120 건국대학교 예술디자인대학 B108",
    heyri: "경기 파주시 탄현면 헤이리마을길 93-119"
  };
  const venueClosedDays = {
    kofa: "일·월 휴무",
    sac: "월 휴무",
    laika: "연중무휴",
    indiespace: "연중무휴",
    momo: "연중무휴",
    cinecube: "연중무휴",
    emu: "연중무휴",
    forest: "연중무휴",
    arirang: "2·4주 월 휴무",
    filmforum: "연중무휴",
    sangsangmadang: "월 휴무",
    movieland: "월·화·수 휴무",
    artnine: "연중무휴",
    kucine: "월 휴무",
    heyri: "상영일 운영"
  };
  const venueMarkAssets = {
    kofa: "assets/venue-marks/kofa.png",
    sac: "assets/venue-marks/sac.png",
    laika: "assets/venue-marks/laika.png",
    indiespace: "assets/venue-marks/indiespace.png",
    momo: "assets/venue-marks/momo.png",
    cinecube: "assets/venue-marks/cinecube.png",
    emu: "assets/venue-marks/emu.png",
    forest: "assets/venue-marks/forest.jpg",
    arirang: "assets/venue-marks/arirang.png",
    filmforum: "assets/venue-marks/filmforum.png",
    sangsangmadang: "assets/venue-marks/sangsangmadang.svg",
    artnine: "assets/venue-marks/artnine.png",
    kucine: "assets/venue-marks/kucine.jpg",
    movieland: "assets/venue-marks/movieland.png",
    heyri: "assets/venue-marks/heyri.svg"
  };
  const venueMarkText = {
    kofa: "KOFA",
    sac: "SAC",
    laika: "LAIKA",
    indiespace: "INDIE",
    momo: "MOMO",
    cinecube: "C",
    emu: "EMU",
    forest: "THE SOOP",
    arirang: "ARIRANG",
    filmforum: "FILM FORUM",
    sangsangmadang: "KT&G",
    artnine: "ARTNINE",
    kucine: "KU",
    movieland: "MOVIE LAND",
    heyri: "HEYRI"
  };
  const knownProgramImages = {
    "p-sac-rossellini": "https://www.cinematheque.seoul.kr/data/file/program/thumb-cd350d699bb6addbeff893b0d2cf9159_5IpMwGuj_ebb50b412a6aa0d39ee6fb254d9d31640c68de5f_400x300.jpg",
    "p-sac-wiseman": "https://www.cinematheque.seoul.kr/data/file/program/thumb-cd350d699bb6addbeff893b0d2cf9159_8S1EGAHr_98b3e011c1e80809f8b95c0286931b524d7ee6a5_400x300.jpg",
    "p-laika-park": "https://cdn.imweb.me/thumbnail/20260525/4f0422dc8398c.png",
    "p-momo-trier": "https://arthousemomo.co.kr/data/editor/2606/thumb-ca88447528637a04e78b194f07b294a5_1781065501_9701_250x180.jpg",
    "p-indie-pride": "https://i1.daumcdn.net/thumb/C230x300/?fname=https%3A%2F%2Fblog.kakaocdn.net%2Fdna%2FPvkcO%2FdJMcagePITM%2FAAAAAAAAAAAAAAAAAAAAAC8fm7sNowgy1L75yKw-9tQ9tw6jVU1oVJmFYmGNnJtE%2Fimg.jpg%3Fcredential%3DyqXZFxpELC7KVnFOS48ylbz2pIh7yKj8%26expires%3D1782831599%26allow_ip%3D%26allow_referer%3D%26signature%3D27VGngaxo1A88f2L17bYMpv%252FEUo%253D"
  };

  const $ = (selector) => document.querySelector(selector);
  const iconSpritePath = "/assets/lucide-sprite.svg";

  function iconMarkup(name, className = "") {
    return `<svg class="ui-icon ${className}" aria-hidden="true"><use href="${iconSpritePath}#${name}"></use></svg>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function safeExternalUrl(value, fallback = "#") {
    return safePublicUrl(value, fallback);
  }

  function escapeHref(value, fallback = "#") {
    return escapeHtml(safeExternalUrl(value, fallback));
  }

  function safeImageUrl(value) {
    const raw = String(value || "").trim();
    if (/^\/assets\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:png|jpe?g|svg|webp|gif)$/i.test(raw)) return raw;
    const url = safeExternalUrl(raw, "");
    return url.startsWith("https://") ? url : "";
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return "";
    }
  }

  function venueOfficialUrl(venue) {
    return safeExternalUrl(venue?.url, "");
  }

  function loadFavoriteVenueIds() {
    try {
      const parsed = JSON.parse(localStorage.getItem(favoriteVenueStorageKey) || "[]");
      return new Set(Array.isArray(parsed) ? parsed.filter(Boolean) : []);
    } catch {
      return new Set();
    }
  }

  function saveFavoriteVenueIds() {
    try {
      localStorage.setItem(favoriteVenueStorageKey, JSON.stringify([...state.favoriteVenueIds]));
    } catch {
      // Ignore private browsing/storage failures; favorites still work for this render.
    }
  }

  function isFavoriteVenue(venueId) {
    return state.favoriteVenueIds.has(String(venueId || ""));
  }

  function venueNameSortBucket(venue) {
    const [firstChar = ""] = Array.from(String(venue?.name || "").trim());
    const code = firstChar.codePointAt(0) || 0;
    if ((code >= 0xac00 && code <= 0xd7a3) || (code >= 0x3131 && code <= 0x318e)) return 0;
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) return 1;
    return 2;
  }

  function compareVenueNames(a, b) {
    const bucketDiff = venueNameSortBucket(a) - venueNameSortBucket(b);
    if (bucketDiff) return bucketDiff;

    const locale = venueNameSortBucket(a) === 1 ? "en" : "ko";
    const nameDiff = String(a?.name || "").localeCompare(String(b?.name || ""), locale, {
      numeric: true,
      sensitivity: "base"
    });
    return nameDiff || String(a?.id || "").localeCompare(String(b?.id || ""), "en");
  }

  function compareFavoriteVenues(a, b) {
    const favoriteRank = Number(!isFavoriteVenue(a?.id)) - Number(!isFavoriteVenue(b?.id));
    if (favoriteRank) return favoriteRank;
    return compareVenueNames(a, b);
  }

  function sortVenuesForDisplay(venues) {
    return [...venues].sort(compareFavoriteVenues);
  }

  function venueShortcutItems(venues, createVenueItem) {
    const sortedVenues = sortVenuesForDisplay(venues);
    return sortedVenues.map(createVenueItem);
  }

  function favoriteVenueButton(venueId, venueName) {
    if (!venueId || venueId === "all") return "";
    const favorite = isFavoriteVenue(venueId);
    const title = `${venueName || "상영관"} 즐겨찾기 ${favorite ? "해제" : "추가"}`;
    return `<button class="star" type="button" data-favorite-venue="${escapeHtml(venueId)}" aria-pressed="${favorite}" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}">${iconMarkup(favorite ? "star-fill" : "star")}</button>`;
  }

  function toggleFavoriteVenue(venueId) {
    const id = String(venueId || "");
    if (!id || id === "all") return;
    const venues = venueMap();
    const venueName = venues[id]?.name || "상영관";
    if (state.favoriteVenueIds.has(id)) {
      state.favoriteVenueIds.delete(id);
      saveFavoriteVenueIds();
      render();
      showToast(`${venueName} 즐겨찾기를 해제했습니다.`);
      return;
    }

    state.favoriteVenueIds.add(id);
    saveFavoriteVenueIds();
    render();
    showToast(`${venueName} 즐겨찾기에 추가했습니다.`);
  }

  let venueMapCache = null;
  let venueMapSource = null;

  function venueMap() {
    const venues = state.data?.venues || [];
    // Rebuild only when the venues array reference changes (i.e. new data loaded).
    if (venueMapSource === venues && venueMapCache) return venueMapCache;
    venueMapSource = venues;
    venueMapCache = Object.fromEntries(venues.map((venue) => [venue.id, venue]));
    return venueMapCache;
  }

  function venueAddress(venue) {
    return venue?.address || venueAddresses[venue?.id] || venue?.area || "서울";
  }

  function naverMapUrl(venue) {
    const query = venueAddress(venue);
    return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
  }

  function venueInfoHtml(venue, fallback = "상영일 운영 · 서울") {
    if (!venue) return escapeHtml(fallback);
    const closedDay = venueClosedDays[venue.id] || "상영일 운영";
    const address = venueAddress(venue);
    const venueName = venue.name || "상영관";
    return `${escapeHtml(closedDay)}<span class="sep" aria-hidden="true">·</span><a href="${escapeHref(naverMapUrl(venue))}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`${address} · ${venueName} 네이버 지도 열기`)}" title="네이버 지도에서 주소 보기">${escapeHtml(address)}</a>`;
  }

  // For display only: parse as local midnight so calendar getters return the
  // date string's calendar values in the viewer's timezone.
  function parseLocalDate(dateString) {
    return new Date(`${dateString}T00:00:00`);
  }

  function getDates(sessions = state.data?.sessions || []) {
    return [...new Set(sessions.map((session) => session.date).filter(Boolean))].sort();
  }

  function getRemainingSessions() {
    return (state.data?.sessions || []).filter((session) => !isPastSession(session));
  }

  function kstDateString(value = new Date()) {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(value);
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  }

  function dateKeyFromParts(year, month, day) {
    const parsedYear = Number(year);
    const parsedMonth = Number(month);
    const parsedDay = Number(day);
    if (!parsedYear || !parsedMonth || !parsedDay) return "";
    return `${String(parsedYear).padStart(4, "0")}-${String(parsedMonth).padStart(2, "0")}-${String(parsedDay).padStart(2, "0")}`;
  }

  function addDays(dateString, days) {
    return addCalendarDays(dateString, days);
  }

  function daysBetween(startDateString, endDateString) {
    return calendarDaysBetween(startDateString, endDateString);
  }

  function addMonths(dateString, months) {
    return addCalendarMonths(dateString, months);
  }

  function formatPeriodLabel(startDate, endDate) {
    if (!startDate && !endDate) return "";
    const start = parseLocalDate(startDate);
    const startText = `${start.getFullYear()}.${String(start.getMonth() + 1).padStart(2, "0")}.${String(start.getDate()).padStart(2, "0")}`;
    if (!endDate || startDate === endDate) return startText;
    const end = parseLocalDate(endDate);
    const endText = `${String(end.getMonth() + 1).padStart(2, "0")}.${String(end.getDate()).padStart(2, "0")}`;
    return `${startText} - ${endText}`;
  }

  function parsePeriodRange(period, fallbackDates = []) {
    const dates = uniqueValues(fallbackDates).filter(Boolean).sort();
    const text = String(period || "");
    let yearHint = Number(kstDateString().slice(0, 4));
    const extracted = [];
    const fullDatePattern = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/g;
    const textWithoutFullDates = text.replace(fullDatePattern, (_, year, month, day) => {
      yearHint = Number(year) || yearHint;
      extracted.push(dateKeyFromParts(year, month, day));
      return " ";
    });

    for (const match of textWithoutFullDates.matchAll(/(^|[^\d])(\d{1,2})[.\/](\d{1,2})(?!\d)/g)) {
      extracted.push(dateKeyFromParts(yearHint, match[2], match[3]));
    }

    const allDates = uniqueValues([...extracted, ...dates]).filter(Boolean).sort();
    if (!allDates.length) return null;
    return {
      start: allDates[0],
      end: allDates[allDates.length - 1]
    };
  }

  function lifecycleFromRange(range) {
    if (!range?.start || !range?.end) return null;
    const today = kstDateString();
    if (range.end < today) return { expired: true };
    if (range.start > today) {
      const daysLeft = daysBetween(today, range.start);
      return { label: `D-${daysLeft}`, tone: "upcoming", expired: false, daysLeft };
    }
    const endingSoonLimit = addDays(today, 3);
    if (range.end <= endingSoonLimit) {
      return { label: "곧 종료", tone: "ending", expired: false };
    }
    return { label: "진행 중", tone: "active", expired: false };
  }

  function scheduleDataSignature(data) {
    const sessions = data?.sessions || [];
    const programs = data?.programs || [];
    const lastSession = sessions[sessions.length - 1] || {};
    return [
      data?.meta?.lastVerifiedAt || "",
      data?.meta?.generatedAt || "",
      data?.meta?.seatStatusVerifiedAt || "",
      JSON.stringify(data?.meta?.browserLive || []),
      sessions.length,
      sessions[0]?.id || "",
      lastSession.id || "",
      programs.length
    ].join("|");
  }

  function applyScheduleData(data, options = {}) {
    state.data = data;
    state.dataSignature = scheduleDataSignature(data);
    state.currentKstDate = kstDateString();
    state.lastDataRefreshAt = Date.now();
    if (options.resetDate) state.date = null;
    normalizeDateSelection();
  }

  function todayScheduleDate() {
    const dates = getUpcomingDates();
    const today = kstDateString();
    return dates.includes(today) ? today : dates[0] || today;
  }

  function isPastScheduleDate(dateString) {
    return Boolean(dateString) && dateString < kstDateString();
  }

  function getUpcomingDates() {
    const remainingDates = getDates(getRemainingSessions());
    if (remainingDates.length) return remainingDates;

    const dates = getDates();
    const today = kstDateString();
    const upcomingDates = dates.filter((date) => date >= today);
    return upcomingDates.length ? upcomingDates : dates;
  }

  function normalizeDateSelection() {
    if (!state.date) return;
    const validDates = new Set(getUpcomingDates());
    if (isPastScheduleDate(state.date) || !validDates.has(state.date)) state.date = null;
  }

  function activeDateFilter() {
    const selectedDate = state.date && !isPastScheduleDate(state.date) ? state.date : null;
    return state.view === "today" ? selectedDate || todayScheduleDate() : selectedDate;
  }

  function reconcileDateState(options = {}) {
    if (!state.data) return false;

    const today = kstDateString();
    if (state.currentKstDate === today) return false;

    state.currentKstDate = today;
    normalizeDateSelection();
    render();
    if (options.refreshData) refreshScheduleData({ force: true });
    return true;
  }

  function isTodayScheduleDate(dateString) {
    return dateString === kstDateString();
  }

  function formatDate(dateString) {
    if (!dateString) return "날짜 확인";
    const date = parseLocalDate(dateString);
    if (Number.isNaN(date.getTime())) return "날짜 확인";
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${month}.${day} ${weekdays[date.getDay()]}`;
  }

  function formatVerifiedAt(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(date);
  }

  function isSunday(dateString) {
    return parseLocalDate(dateString).getDay() === 0;
  }

  function getSourcesByVenue() {
    return groupBy(state.data?.sources || [], (source) => source.venueId || "unknown");
  }

  function sourceMap() {
    return Object.fromEntries((state.data?.sources || []).map((source) => [source.id, source]));
  }

  function updateMeta(filtered = getFilteredSessions()) {
    const activeDate = activeDateFilter();
    const title = activeDate ? longDateLabel(activeDate) : "전체 일정";
    const venueCount = new Set(filtered.map((session) => session.venueId).filter(Boolean)).size;
    const summary = filtered.length
      ? `${venueCount.toLocaleString("ko-KR")}개관에서 ${filtered.length.toLocaleString("ko-KR")}회 상영해요`
      : "조건에 맞는 회차가 없어요";
    const status = dataStatusText();

    const desktopTitle = $("#desktopScheduleTitle");
    if (desktopTitle) desktopTitle.textContent = title;
    const desktopSummary = $("#desktopMonth");
    if (desktopSummary) desktopSummary.textContent = summary;
    const dataStatus = $("#desktopDataStatus");
    if (dataStatus) {
      dataStatus.textContent = status;
      dataStatus.previousElementSibling?.classList.toggle("hidden", !status);
    }
    renderBrowserLiveStatus();
    const mobileHeading = $("#mobileScheduleHeading");
    if (mobileHeading) mobileHeading.textContent = title;
    const mobileSub = $("#mobileScheduleSub");
    if (mobileSub) mobileSub.textContent = [summary, status].filter(Boolean).join(" · ");
  }

  function startBrowserLiveRefresh(base) {
    const requestId = ++state.browserRefreshId;
    if (!usesBrowserLive(base)) return;
    refreshBrowserLiveSchedule(base, {
      onProgress(data) {
        if (requestId !== state.browserRefreshId) return;
        applyScheduleData(data);
        render();
      }
    }).catch(() => {});
  }

  function browserLiveIncomplete() {
    return usesBrowserLive(state.data) && (state.data.meta.browserLive || []).filter((row) => row.status === "ok").length < browserLiveConfigs.length;
  }

  function emptyScheduleMessage(message) {
    if (!browserLiveIncomplete()) return message;
    const rows = state.data.meta.browserLive || [];
    if (rows.some((row) => row.status === "error")) return "일부 영화관의 시간표를 확인하지 못했습니다. 위의 공식 링크에서 확인해 주세요.";
    return "영화관의 공식 시간표를 불러오는 중입니다.";
  }

  // Only surface a notice when a venue could not be checked. Successful and in-progress
  // checks stay silent; the data-status line under the page title already shows freshness.
  function renderBrowserLiveStatus() {
    const rows = usesBrowserLive(state.data) ? state.data.meta.browserLive || [] : [];
    const failures = rows.filter((row) => row.status === "error");
    const completeCount = rows.filter((row) => row.status === "ok").length;
    for (const id of ["desktop", "mobile"]) {
      let notice = document.getElementById(`${id}LiveStatus`);
      if (!failures.length) { notice?.remove(); continue; }
      if (!notice) {
        notice = document.createElement("div");
        notice.id = `${id}LiveStatus`;
        notice.className = "notice";
        notice.setAttribute("role", "status");
        notice.setAttribute("aria-live", "polite");
        document.getElementById(`${id}Schedule`).before(notice);
      }
      const links = failures.map((row) => {
        const config = browserLiveConfigs.find((item) => item.venueId === row.venueId);
        return `<a href="${escapeHtml(safePublicUrl(config.officialUrl))}" target="_blank" rel="noopener noreferrer">${escapeHtml(config.name)}</a>`;
      });
      notice.innerHTML = `${completeCount}/${browserLiveConfigs.length}개관 실시간 확인 · 연결되지 않은 영화관은 공식 시간표를 확인해 주세요: ${links.join(" · ")} <button type="button" data-retry-browser-live>다시 확인</button>`;
      notice.querySelector("button").onclick = () => refreshScheduleData({ force: true });
    }
  }

  function matchesSearch(session, venues, query) {
    if (!query) return true;
    const venue = venues[session.venueId];
    return [
      session.title,
      session.program,
      session.summary,
      session.screen,
      venue?.name,
      venue?.area,
      ...(session.tags || [])
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  }

  function getFilteredSessions(options = {}) {
    const includeLinkFilter = options.includeLinkFilter ?? true;
    const includeVenueFilter = options.includeVenueFilter ?? true;
    const includeDate = options.includeDate ?? true;
    const venues = venueMap();
    const query = state.query.trim().toLowerCase();
    const dateFilter = includeDate ? activeDateFilter() : null;
    return (state.data?.sessions || [])
      .filter((session) => !dateFilter || session.date === dateFilter)
      .filter((session) => !isPastSession(session))
      .filter((session) => !includeLinkFilter || state.linkFilter === "all" || session.bookingType === state.linkFilter)
      .filter((session) => !includeVenueFilter || state.venueFilter === "all" || session.venueId === state.venueFilter)
      .filter((session) => matchesSearch(session, venues, query))
      .sort((a, b) => `${a.date} ${a.timeSort || a.time}`.localeCompare(`${b.date} ${b.timeSort || b.time}`));
  }

  function groupBy(items, getKey) {
    return items.reduce((acc, item) => {
      const key = getKey(item);
      acc[key] ||= [];
      acc[key].push(item);
      return acc;
    }, {});
  }

  function countBy(items, getKey) {
    return items.reduce((acc, item) => {
      const key = getKey(item);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }

  function posterSource(item) {
    const src = item?.posterUrl || item?.thumbnailUrl || item?.imageUrl || "";
    return /placeholder_image/i.test(src) ? "" : src;
  }

  function optimizedPosterSource(src) {
    return String(src || "").replace(/\.small\.jpg(?=$|[?#])/i, ".thumb.jpg");
  }

  function posterFallbackHtml(title, className, kicker = "서울독립영화관시간표") {
    return `
      <div class="${className} poster-fallback">
        ${kicker ? `<span>${escapeHtml(kicker)}</span>` : ""}
        <strong>${escapeHtml(title)}</strong>
      </div>
    `;
  }

  function posterMarkup(item, title, className, kicker = "서울독립영화관시간표", options = {}) {
    const originalSrc = safeImageUrl(posterSource(item));
    if (originalSrc) {
      const src = optimizedPosterSource(originalSrc);
      const priority = Boolean(options.priority);
      const remoteFallback = optimizedPosterSource(safeImageUrl(item?.posterSourceUrl || ""));
      const fallbackSrc = src !== originalSrc ? originalSrc : remoteFallback && remoteFallback !== src ? remoteFallback : "";
      const fallbackAttribute = fallbackSrc ? ` data-poster-fallback-src="${escapeHtml(fallbackSrc)}"` : "";
      return `<img alt="${options.decorative ? "" : escapeHtml(title)}" class="${className}" src="${escapeHtml(src)}" width="400" height="600" loading="${priority ? "eager" : "lazy"}" decoding="async" ${priority ? 'fetchpriority="high"' : ""} referrerpolicy="no-referrer" data-poster-title="${escapeHtml(title)}" data-poster-kicker="${escapeHtml(kicker)}"${fallbackAttribute} />`;
    }

    return posterFallbackHtml(title, className, kicker);
  }

  function replacePosterImage(image) {
    if (!image || image.dataset.posterReplaced) return;
    const fallbackSrc = safeImageUrl(image.dataset.posterFallbackSrc || "");
    if (fallbackSrc && !image.dataset.posterFallbackTried) {
      image.dataset.posterFallbackTried = "true";
      image.addEventListener("error", () => replacePosterImage(image), { once: true });
      image.src = fallbackSrc;
      return;
    }
    image.dataset.posterReplaced = "true";
    const title = image.dataset.posterTitle || image.alt || "서울독립영화관시간표";
    const kicker = image.dataset.posterKicker ?? "서울독립영화관시간표";
    const wrapper = document.createElement("div");
    wrapper.innerHTML = posterFallbackHtml(title, image.className, kicker).trim();
    image.replaceWith(wrapper.firstElementChild);
  }

  function repairPosterImages() {
    document.querySelectorAll("img[data-poster-title]").forEach((image) => {
      image.addEventListener("error", () => replacePosterImage(image), { once: true });
      if (image.complete && image.naturalWidth === 0) replacePosterImage(image);
    });
  }

  function ratingText(session) {
    return [session.rating, session.program, session.summary, ...(session.tags || [])].filter(Boolean).join(" ");
  }

  function ratingLabel(session) {
    const text = ratingText(session);
    if (/청소년\s*관람\s*불가|청불|19\s*세|18\s*세/.test(text)) return "19";
    if (/15\s*세/.test(text)) return "15";
    if (/12\s*세/.test(text)) return "12";
    if (/전체\s*관람가|ALL\s*세|\bALL\b/i.test(text)) return "ALL";
    return "";
  }

  function ageLabel(session) {
    if (session.kind === "festival") return "FEST";
    if (session.kind === "talk") return "GV";
    if ((session.tags || []).some((tag) => /감독|GV|관객과의\s*대화/.test(tag))) return "GV";
    return ratingLabel(session) || "INFO";
  }

  function cleanTime(session) {
    return session.time || "시간 확인";
  }

  function shortDate(dateString) {
    const date = parseLocalDate(dateString);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${month}.${day}`;
  }

  function sessionSortKey(session) {
    return `${session.date || ""} ${session.timeSort || session.time || ""} ${session.venueId || ""} ${session.title || ""}`;
  }

  function sortSessions(sessions) {
    return [...sessions].sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b), "ko"));
  }

  function uniqueValues(values) {
    const seen = new Set();
    return values
      .map((value) => String(value || "").trim())
      .filter((value) => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      });
  }

  function compactValues(values, limit = 2) {
    const unique = uniqueValues(values);
    if (!unique.length) return "";
    const rest = unique.length - limit;
    return `${unique.slice(0, limit).join(" / ")}${rest > 0 ? ` 외 ${rest}` : ""}`;
  }

  function groupedSessionEntries(sessions, getKey, options = {}) {
    return Object.entries(groupBy(sortSessions(sessions), getKey))
      .map(([key, groupedSessions]) => ({ key, sessions: sortSessions(groupedSessions) }))
      .sort((a, b) => {
        if (options.sortByFavorites) {
          const favoriteRank = Number(!isFavoriteVenue(a.key)) - Number(!isFavoriteVenue(b.key));
          if (favoriteRank) return favoriteRank;
        }
        return sessionSortKey(a.sessions[0]).localeCompare(sessionSortKey(b.sessions[0]), "ko");
      });
  }

  function actionUrl(item) {
    return safeExternalUrl(item?.bookingUrl, "") || safeExternalUrl(item?.detailUrl, "") || "#";
  }

  function actionLabel(item) {
    if (item?.actionLabel) return item.actionLabel;
    if (item?.bookingType === "booking") return "예매";
    if (item?.bookingType === "guide") return "예매 안내";
    if (item?.bookingType === "detail") return "상세";
    if (item?.bookingType === "official") return "공식 확인";
    return "확인";
  }

  // Remaining seats parsed from "잔여 69/72석"; null when the source reports no seat count.
  function seatInfo(session) {
    if (!session || isSoldoutSession(session) || isPastSession(session)) return null;
    const text = [session.summary, ...(session.tags || [])].filter(Boolean).join(" ");
    const match = /잔여\s*(\d+)\s*\/\s*(\d+)\s*석/.exec(text);
    if (!match) return null;
    const left = Number(match[1]);
    const total = Number(match[2]);
    if (!total || left > total) return null;
    const ratio = left / total;
    // Quantised to tenths so the width comes from a class (inline styles are blocked by the CSP).
    const step = left === 0 ? 0 : Math.max(1, Math.round(ratio * 10));
    return { left, total, step, low: left <= 10 || ratio <= 0.2 };
  }

  function renderDateBars() {
    const dates = getUpcomingDates();
    const venues = venueMap();
    const query = state.query.trim().toLowerCase();
    const activeDate = activeDateFilter();
    const todayDate = kstDateString();
    const todayMode = state.view === "today";
    const dateCountSessions = (state.data.sessions || [])
      .filter((session) => state.linkFilter === "all" || session.bookingType === state.linkFilter)
      .filter((session) => state.venueFilter === "all" || session.venueId === state.venueFilter)
      .filter((session) => !isPastSession(session))
      .filter((session) => matchesSearch(session, venues, query));
    const sessionsByDate = countBy(dateCountSessions, (session) => session.date);
    const totalSessions = dateCountSessions.length;
    const mobileLayout = isMobileViewport();
    const target = mobileLayout ? $("#mobileDateBar") : $("#desktopDateBar");
    (mobileLayout ? $("#desktopDateBar") : $("#mobileDateBar"))?.replaceChildren();
    if (!target) return;

    const allButton = todayMode
      ? ""
      : `<button class="date is-all${activeDate ? "" : " is-on"}" type="button" data-date="" aria-pressed="${!activeDate}" aria-label="${escapeHtml(`전체 날짜 ${totalSessions.toLocaleString("ko-KR")}회`)}"><span class="wd">전체</span><span class="d">${totalSessions.toLocaleString("ko-KR")}</span><span class="c">회</span></button>`;

    // Rebuilding the strip would jump it back to the start; keep where the visitor scrolled it.
    const scrollLeft = target.scrollLeft;
    target.innerHTML = allButton + dates
      .map((date) => {
        const parsed = parseLocalDate(date);
        const active = activeDate === date;
        const today = date === todayDate;
        const count = sessionsByDate[date] || 0;
        const classes = ["date", active ? "is-on" : "", isSunday(date) ? "is-sun" : ""].filter(Boolean).join(" ");
        const label = `${parsed.getMonth() + 1}월 ${parsed.getDate()}일 ${weekdays[parsed.getDay()]}요일${today ? " 오늘" : ""}, ${count}회`;
        return `<button class="${classes}" type="button" data-date="${escapeHtml(date)}" aria-pressed="${active}" ${today ? 'aria-current="date"' : ""} aria-label="${escapeHtml(label)}"><span class="wd">${today ? "오늘" : weekdays[parsed.getDay()]}</span><span class="d">${parsed.getDate()}</span><span class="c">${count.toLocaleString("ko-KR")}회</span></button>`;
      })
      .join("");
    target.scrollLeft = scrollLeft;
  }

  function renderViewButtons() {
    document.querySelectorAll("[data-view]").forEach((button) => {
      const active = button.dataset.view === state.view;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-on", active);
    });
  }

  function isMobileViewport() {
    return window.matchMedia("(max-width: 767px)").matches;
  }

  function navOffset() {
    return isMobileViewport() ? 72 : 84;
  }

  function visibleNavIds() {
    return isMobileViewport()
      ? ["mobile-schedule", "mobile-programs", "mobile-festivals"]
      : ["schedule", "programs", "festivals"];
  }

  function activeSectionId() {
    const ids = visibleNavIds();
    const probeY = window.scrollY + navOffset() + 48;
    let active = ids[0];
    ids.forEach((id) => {
      const section = document.getElementById(id);
      if (section && section.offsetTop <= probeY) active = id;
    });
    return active;
  }

  let lastNavActiveId = null;

  function setNavActive(activeId) {
    if (activeId === lastNavActiveId) return;
    lastNavActiveId = activeId;
    document.querySelectorAll("[data-nav-target]").forEach((link) => {
      if (link.dataset.navTarget === activeId) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }

  function updateNavActive() {
    setNavActive(activeSectionId());
  }

  function currentTheme() {
    const chosen = document.documentElement.dataset.theme;
    if (chosen === "light" || chosen === "dark") return chosen;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function syncThemeControls() {
    const dark = currentTheme() === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute("aria-pressed", String(dark));
      button.setAttribute("aria-label", dark ? "야간 모드 끄기" : "야간 모드 켜기");
    });
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#1c1c21" : "#ffffff");
  }

  function toggleTheme() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Not persisted; the choice still applies to this page view.
    }
    syncThemeControls();
  }

  function scrollToSection(id, behavior = "smooth") {
    const target = document.getElementById(id);
    if (!target) return false;
    const top = target.getBoundingClientRect().top + window.scrollY - navOffset();
    window.scrollTo({ top: Math.max(0, top), behavior });
    setNavActive(id);
    return true;
  }

  function venueAnchorId(venueId, variant = isMobileViewport() ? "mobile" : "desktop") {
    const safeId = String(venueId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-");
    return `${variant}-venue-${safeId}`;
  }

  function scrollToVenue(venueId, behavior = "smooth") {
    const id = venueAnchorId(venueId);
    const target = document.getElementById(id);
    if (!target) return false;
    const offset = navOffset() + (isMobileViewport() ? 64 : 0);
    const top = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, top), behavior });
    setNavActive(isMobileViewport() ? "mobile-schedule" : "schedule");
    return true;
  }

  function jumpToVenueSchedule(venueId) {
    state.venueFilter = "all";
    state.view = "today";
    render();

    window.requestAnimationFrame(() => {
      if (venueId === "all") {
        scrollToSection(isMobileViewport() ? "mobile-schedule" : "schedule");
        return;
      }

      if (scrollToVenue(venueId)) return;

      state.view = "venue";
      state.date = null;
      render();
      window.requestAnimationFrame(() => {
        if (scrollToVenue(venueId)) {
          showToast("오늘 회차가 없어 상영관별 일정으로 이동했습니다.");
          return;
        }

        showToast("현재 조건에 맞는 상영 회차가 없습니다.");
        scrollToSection(isMobileViewport() ? "mobile-schedule" : "schedule");
      });
    });
  }

  function isPastTimedItem(item) {
    return isPastKstSession(item);
  }

  function isPastSession(session) {
    return isPastTimedItem(session);
  }

  function isSoldoutSession(session) {
    if (!session) return false;
    const text = [session.status, session.actionLabel, session.summary, ...(session.tags || [])].filter(Boolean).join(" ");
    return session.status === "soldout" || text.includes("매진") || /sold\s*out/i.test(text);
  }

  function splitSessionMetaValues(session) {
    const values = uniqueValues([session.summary, session.program, ...(session.tags || [])])
      .flatMap((value) => String(value || "").split("·").map((part) => part.trim()))
      .filter(Boolean);
    return uniqueValues(values);
  }

  function isAgeMeta(value) {
    return /^(?:ALL(?:세|관람가)?|전체(?:관람가)?|\d+\s*세(?:이상)?(?:관람가)?|청소년(?:관람불가|관람가))$/i.test(String(value || "").trim());
  }

  function isRuntimeMeta(value) {
    return /^\d+\s*분$/.test(String(value || "").trim());
  }

  function isScreenMeta(value, session, venue) {
    const text = String(value || "").trim();
    if (!text) return false;
    return (
      text === String(session.screen || "").trim() ||
      text === String(venue?.name || "").trim() ||
      text === String(session.venueName || "").trim() ||
      /^(?:\d+관|[A-Z]관|아리랑인디웨이브관|시네마테크KOFA\s*\d관)/i.test(text)
    );
  }

  function screeningTypeMeta(values) {
    return values.find((value) => /^(?:일반|조조|심야|GV|무대인사|관객과의\s*대화|시네토크|굿즈|패키지)$/i.test(value)) || "";
  }

  function formatMeta(values) {
    return values.find((value) => /^(?:2D|3D|4D|IMAX|D-Cinema|35mm|16mm|필름)(?:\([^)]*\))?$/i.test(value)) || "";
  }

  function seatMeta(values) {
    return values.find((value) => /^잔여\s*\d+\s*\/\s*\d+\s*석$/.test(value)) || "";
  }

  function runtimeMeta(values) {
    return values.find((value) => isRuntimeMeta(value)) || "";
  }

  function agendaRow(session, venues) {
    const venue = venues[session.venueId];
    const soldout = isSoldoutSession(session);
    const start = kstSessionStartMs(session);
    const gv = ageLabel(session) === "GV";
    const title = session.title || "제목 확인";
    return `
      <div class="row${soldout ? " is-soldout" : ""}"${start ? ` data-start="${start}"` : ""}>
        ${thumbMarkup(session)}
        <div class="what">
          <p class="title"><span class="t">${escapeHtml(cleanTime(session))}</span><span class="tt" title="${escapeHtml(title)}">${escapeHtml(title)}</span>${gv ? '<span class="tag-gv">GV</span>' : ""}${start ? '<span class="soon" data-soon hidden></span>' : ""}</p>
          <p class="meta">${rateBadgeMarkup(session)}${rowMetaMarkup(session, venue)}</p>
        </div>
        ${bookMarkup(session)}
      </div>`;
  }

  function agendaVenueSection(key, sessions, compact = false) {
    const venues = venueMap();
    const sorted = sortSessions(sessions);
    return venueCardMarkup(key, venues[key], `${sorted.length}회`, sorted.map((session) => agendaRow(session, venues)).join(""), compact);
  }

  function renderDesktopSchedule(filtered) {
    $("#desktopSchedule").innerHTML = scheduleMarkup(filtered, false);
  }

  function renderMobileSchedule(filtered) {
    $("#mobileSchedule").innerHTML = scheduleMarkup(filtered, true);
  }

  function longDateLabel(dateString) {
    const date = parseLocalDate(dateString);
    if (Number.isNaN(date.getTime())) return "상영시간표";
    return `${date.getMonth() + 1}월 ${date.getDate()}일 ${weekdays[date.getDay()]}요일`;
  }

  function dayLabel(dateString) {
    if (dateString === kstDateString()) return "오늘";
    const date = parseLocalDate(dateString);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getMonth() + 1}.${date.getDate()} ${weekdays[date.getDay()]}`;
  }

  function kstClockText(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "";
    if (kstDateString(date) !== kstDateString()) return formatVerifiedAt(value);
    return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  }

  function dataStatusText() {
    const meta = state.data?.meta || {};
    const seatAt = kstClockText(meta.seatStatusVerifiedAt);
    const verifiedAt = formatVerifiedAt(meta.lastVerifiedAt || meta.generatedAt);
    const base = seatAt ? `좌석 ${seatAt} 기준` : verifiedAt ? `${verifiedAt} 기준` : "";
    if (!usesBrowserLive(state.data)) return base;
    return [base, `${browserLiveConfigs.length}개관 실시간 조회`].filter(Boolean).join(" · ");
  }

  function posterIndex() {
    const sessions = state.data?.sessions || [];
    const trends = Array.isArray(state.communityTrends?.items) ? state.communityTrends.items : [];
    const cache = posterIndex.cache;
    if (cache && cache.sessions === sessions && cache.trends === trends) return cache.map;
    const map = new Map();
    for (const item of trends) {
      const key = normalizeTrendTitle(item?.title);
      if (key && posterSource(item) && !map.has(key)) map.set(key, { posterUrl: posterSource(item), posterSourceUrl: item.posterSourceUrl || "" });
    }
    for (const session of sessions) {
      const key = normalizeTrendTitle(session.title);
      if (key && posterSource(session) && !map.has(key)) map.set(key, { posterUrl: posterSource(session) });
    }
    posterIndex.cache = { sessions, trends, map };
    return map;
  }

  // A session without its own poster borrows one from another session or pick with the same title.

  function posterItemFor(session) {
    if (posterSource(session)) return session;
    return posterIndex().get(normalizeTrendTitle(session?.title)) || null;
  }

  function thumbMarkup(session) {
    const item = posterItemFor(session);
    const image = item ? posterMarkup(item, session?.title || "", "", "", { decorative: true }) : "";
    return `<span class="thumb" aria-hidden="true">${image || iconMarkup("film")}</span>`;
  }

  function rateBadgeMarkup(session) {
    const label = ratingLabel(session);
    if (!label) return "";
    const title = label === "ALL" ? "전체관람가" : label === "19" ? "청소년관람불가" : `${label}세 이상 관람가`;
    return `<span class="rate${label === "19" ? " is-19" : ""}" title="${title}">${label}</span>`;
  }

  function sessionRuntime(sessions) {
    for (const session of sessions) {
      const runtime = runtimeMeta(splitSessionMetaValues(session));
      if (runtime) return runtime.replace(/\s+/g, "");
    }
    return "";
  }

  function joinMeta(parts) {
    return parts.filter(Boolean).join('<span class="sep" aria-hidden="true">·</span>');
  }

  function rowMetaMarkup(session, venue) {
    const values = splitSessionMetaValues(session).filter((value) => {
      if (isScreenMeta(value, session, venue) || isAgeMeta(value) || seatMeta([value])) return false;
      if (isSoldoutSession(session) && (value.includes("매진") || value.includes("예매할 수 없습니다"))) return false;
      return true;
    });
    const runtime = runtimeMeta(values).replace(/\s+/g, "");
    const type = screeningTypeMeta(values);
    const seat = seatInfo(session);
    const screen = String(session.screen || "").trim();
    const parts = [
      screen && screen !== String(venue?.name || "").trim() ? escapeHtml(screen) : "",
      escapeHtml(runtime),
      type && type !== "일반" ? escapeHtml(type) : "",
      session.kind === "festival" ? "영화제" : "",
      seat ? `<span class="${seat.low ? "seat-low" : ""}">잔여 ${seat.left}석</span>` : ""
    ];
    if (!runtime && !type && !seat) {
      const extra = values.find((value) => !formatMeta([value]) && !genericProgramLabel(value) && value !== session.title);
      if (extra) parts.push(`<span class="meta-tail">${escapeHtml(extra)}</span>`);
    }
    return joinMeta(parts);
  }

  function shortActionLabel(session) {
    if (session.bookingType === "booking") return "예매";
    const label = actionLabel(session);
    if (/공식/.test(label)) return "공식";
    if (/안내/.test(label)) return "안내";
    if (/상세/.test(label)) return "상세";
    return label;
  }

  function bookMarkup(session) {
    const url = actionUrl(session);
    const title = session.title || "상영";
    if (isSoldoutSession(session)) return `<span class="book is-soldout">매진</span>`;
    if (url === "#") return `<span class="book is-off" title="링크 확인 중">확인중</span>`;
    const booking = session.bookingType === "booking";
    return `<a class="book${booking ? "" : " is-ghost"}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`${title} ${cleanTime(session)} ${actionLabel(session)}`)}">${escapeHtml(shortActionLabel(session))}</a>`;
  }

  function timeChipMarkup(session, showDate = !activeDateFilter()) {
    const time = cleanTime(session);
    const day = showDate ? dayLabel(session.date) : "";
    const dayMarkup = day ? `<span class="tc-d">${escapeHtml(day)}</span>` : "";
    const label = `${session.title || "상영"} ${day ? `${day} ` : ""}${time}`;
    const url = actionUrl(session);
    if (isSoldoutSession(session)) {
      return `<span class="tchip is-soldout" aria-label="${escapeHtml(`${label} 매진`)}" title="매진">${dayMarkup}<span>${escapeHtml(time)}</span></span>`;
    }
    if (url === "#") {
      return `<span class="tchip is-off" aria-label="${escapeHtml(`${label} 링크 확인 중`)}" title="링크 확인 중">${dayMarkup}<span>${escapeHtml(time)}</span></span>`;
    }
    const seat = seatInfo(session);
    const seatMarkup = seat ? `<span class="tc-s${seat.low ? " is-low" : ""}">${seat.left}석</span>` : "";
    const booking = session.bookingType === "booking";
    return `<a class="tchip${booking ? "" : " is-ghost"}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`${label} ${actionLabel(session)}${seat ? ` 잔여 ${seat.left}석` : ""}`)}">${dayMarkup}<span>${escapeHtml(time)}</span>${seatMarkup}</a>`;
  }

  function venueCardMarkup(key, venue, countLabel, body, compact = false) {
    const venueName = venue?.name || key || "상영관";
    const anchorId = venueAnchorId(key, compact ? "mobile" : "desktop");
    const officialUrl = venueOfficialUrl(venue);
    const nameMarkup = officialUrl
      ? `<a href="${escapeHtml(officialUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(`${venueName} 공식 사이트`)}">${escapeHtml(venueName)}</a>`
      : escapeHtml(venueName);
    return `
      <article id="${escapeHtml(anchorId)}" class="venue">
        <div class="venue-h">
          <div>
            <h3>${nameMarkup}</h3>
            <p>${venueInfoHtml(venue)}</p>
          </div>
          <div class="venue-tools">
            <span class="count">${escapeHtml(countLabel)}</span>
            ${venue ? favoriteVenueButton(key, venueName) : ""}
          </div>
        </div>
        ${body}
      </article>`;
  }

  // Venue view: one card per venue, one line per film with its times.
  function venueFilmGroupMarkup(title, sessions) {
    const first = sessions[0];
    const gv = sessions.some((session) => ageLabel(session) === "GV");
    const facts = joinMeta([escapeHtml(sessionRuntime(sessions)), `${sessions.length}회`]);
    return `
      <div class="group">
        ${thumbMarkup(first)}
        <div class="what">
          <p class="group-title"><span class="tt" title="${escapeHtml(title)}">${escapeHtml(title)}</span>${gv ? '<span class="tag-gv">GV</span>' : ""}</p>
          <p class="meta">${rateBadgeMarkup(first)}${facts}</p>
          <div class="times">${sessions.map((session) => timeChipMarkup(session)).join("")}</div>
        </div>
      </div>`;
  }

  function venueViewCard(key, sessions, compact = false) {
    const venues = venueMap();
    const filmGroups = groupedSessionEntries(sessions, (session) => session.title || "제목 확인");
    const body = filmGroups.map((group) => venueFilmGroupMarkup(group.key, group.sessions)).join("");
    return venueCardMarkup(key, venues[key], `${filmGroups.length}편 · ${sessions.length}회`, body, compact);
  }

  // Film view: one card per film, one line per venue with its times.

  function filmViewCard(title, sessions) {
    const venues = venueMap();
    const first = sessions[0];
    const venueGroups = groupedSessionEntries(sessions, (session) => session.venueId || "unknown", { sortByFavorites: true });
    const facts = joinMeta([escapeHtml(sessionRuntime(sessions)), `${venueGroups.length}개관`]);
    const rows = venueGroups
      .map((group) => {
        const venue = venues[group.key];
        const venueName = venue?.name || group.sessions[0]?.screen || "상영관";
        const officialUrl = venueOfficialUrl(venue);
        const nameMarkup = officialUrl
          ? `<a class="tt" href="${escapeHtml(officialUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(`${venueName} 공식 사이트`)}">${escapeHtml(venueName)}</a>`
          : `<span class="tt">${escapeHtml(venueName)}</span>`;
        return `
          <div class="group no-thumb">
            <div class="what">
              <p class="group-title">${nameMarkup}${isFavoriteVenue(group.key) ? iconMarkup("star-fill", "ui-icon-sm") : ""}</p>
              <div class="times">${group.sessions.map((session) => timeChipMarkup(session)).join("")}</div>
            </div>
          </div>`;
      })
      .join("");
    return `
      <article class="venue">
        <div class="venue-h">
          <div class="film-id">
            ${thumbMarkup(first)}
            <div>
              <h3 title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
              <p class="meta">${rateBadgeMarkup(first)}${facts}</p>
            </div>
          </div>
          <div class="venue-tools"><span class="count">${sessions.length}회</span></div>
        </div>
        ${rows}
      </article>`;
  }

  function emptyMarkup(message) {
    return `<p class="empty">${escapeHtml(message)}</p>`;
  }

  function scheduleMarkup(filtered, compact) {
    const activeDate = activeDateFilter();
    if (state.view === "film") {
      const entries = groupedSessionEntries(filtered, (session) => session.title || "제목 확인");
      return entries.length
        ? entries.map((group) => filmViewCard(group.key, group.sessions)).join("")
        : emptyMarkup(emptyScheduleMessage("조건에 맞는 상영 회차가 없습니다."));
    }
    const groups = groupedSessionEntries(filtered, (session) => session.venueId || "unknown", { sortByFavorites: true });
    if (!groups.length) {
      const message = state.view === "today" ? `${formatDate(activeDate)}에 맞는 상영 회차가 없습니다.` : "조건에 맞는 상영 회차가 없습니다.";
      return emptyMarkup(emptyScheduleMessage(message));
    }
    return groups
      .map((group) => (state.view === "venue" ? venueViewCard(group.key, group.sessions, compact) : agendaVenueSection(group.key, group.sessions, compact)))
      .join("");
  }

  function updateSoonBadges() {
    const now = Date.now();
    document.querySelectorAll(".row[data-start]").forEach((row) => {
      const minutes = Math.ceil((Number(row.dataset.start) - now) / 60000);
      row.classList.toggle("is-past", minutes <= 0);
      const badge = row.querySelector("[data-soon]");
      if (!badge) return;
      const show = minutes > 0 && minutes <= 60;
      badge.hidden = !show;
      badge.textContent = show ? `${minutes}분 후` : "";
    });
  }

  function festivalItemMarkup(group, venues) {
    const lifecycle = festivalGroupLifecycle(group);
    const summary = festivalGroupSummary(group, venues);
    const major = majorFestivalRow(group);
    const logo = major ? majorFestivalLogoMarkup(major) : "";
    const extra = major ? majorFestivalHighlightsMarkup(major) : festivalScheduleSectionsMarkup(group, venues);
    return `
      <div class="fest${logo ? "" : " no-logo"}">
        ${logo}
        <div class="fest-main">
          <h3>${escapeHtml(group.name)}${lifecyclePillMarkup(lifecycle)}</h3>
          <p>${escapeHtml(summary)}</p>
          ${extra}
        </div>
        ${major ? `<div class="fest-cta">${festivalActionMarkup(major)}</div>` : ""}
      </div>`;
  }

  function shortVenueName(venue) {
    const names = { cinecube: "씨네큐브", sangsangmadang: "상상마당", momo: "아트하우스 모모", kucine: "KU시네마테크", kofa: "KOFA" };
    return names[venue?.id] || venue?.name || "상영관";
  }

  // Picks are ranked from reactions in the DC Inside nouvellevague gallery (scripts/update-community-trends.mjs).
  function trendSourceLabel() {
    return "누벨바그 갤러리 반응";
  }

  function trendFactsText(item) {
    const sessions = item.sessions || [];
    const rating = sessions.map((session) => ratingLabel(session)).find(Boolean) || "";
    const ratingText = rating === "ALL" ? "전체관람가" : rating === "19" ? "청소년관람불가" : rating ? `${rating}세` : "";
    return [ratingText, sessionRuntime(sessions)].filter(Boolean).join(" · ");
  }

  function trendTimeChoices(item, limit) {
    const venues = venueMap();
    const today = kstDateString();
    const seen = new Set();
    const choices = [];
    for (const session of item.sessions || []) {
      const url = actionUrl(session);
      if (url === "#" || isSoldoutSession(session) || seen.has(session.venueId)) continue;
      seen.add(session.venueId);
      const venue = venues[session.venueId];
      choices.push({
        url,
        venueName: shortVenueName(venue),
        fullVenueName: venue?.name || "상영관",
        time: session.date === today ? cleanTime(session) : `${dayLabel(session.date)} ${cleanTime(session)}`
      });
      if (choices.length >= limit) break;
    }
    return choices;
  }

  function trendBackdropMarkup(item, className) {
    const src = safeImageUrl(item.posterUrl);
    return src ? `<img class="${className}" src="${escapeHtml(optimizedPosterSource(src))}" alt="" aria-hidden="true" loading="lazy" decoding="async" referrerpolicy="no-referrer" />` : "";
  }

  function trendHeroMarkup(item, index) {
    const posterItem = { posterUrl: item.posterUrl, posterSourceUrl: item.posterSourceUrl };
    const source = trendSourceLabel();
    const choices = trendTimeChoices(item, 3);
    const times = choices.length
      ? `<div class="hero-times">${choices
          .map(
            (choice) =>
              `<a class="glass" href="${escapeHref(choice.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`${item.title} ${choice.fullVenueName} ${choice.time} 예매`)}"><b>${escapeHtml(choice.time)}</b>${escapeHtml(choice.venueName)}</a>`
          )
          .join("")}</div>`
      : `<p class="hero-note">${escapeHtml(trendMetaText(item))}</p>`;
    return `
      <article class="hero${index > 0 ? " is-extra" : ""}">
        ${trendBackdropMarkup(item, "hero-bg")}
        <div class="hero-in">
          <a class="hero-poster" href="${escapeHref(trendTrailerUrl(item))}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(item.title)} 예고편 보기">
            ${posterMarkup(posterItem, item.title, "", "", { priority: index === 0 })}
          </a>
          <div class="hero-text">
            <p class="hero-label">이번 주 추천 ${escapeHtml(String(item.rank || index + 1))}위${source ? `<span class="hero-src">${escapeHtml(source)}</span>` : ""}</p>
            <h3 class="hero-title">${escapeHtml(item.title)}</h3>
            <p class="hero-facts">${escapeHtml(trendFactsText(item))}</p>
            ${times}
          </div>
        </div>
      </article>`;
  }

  function trendListItemMarkup(item, index) {
    const posterItem = { posterUrl: item.posterUrl, posterSourceUrl: item.posterSourceUrl };
    const choice = trendTimeChoices(item, 1)[0];
    const href = choice?.url || trendTrailerUrl(item);
    const next = choice ? `${choice.time} · ${choice.fullVenueName}` : trendMetaText(item);
    return `
      <li>
        <a class="fl" href="${escapeHref(href)}" target="_blank" rel="noopener noreferrer">
          ${trendBackdropMarkup(item, "fl-bg")}
          <span class="fl-poster">${posterMarkup(posterItem, item.title, "", "", { decorative: true })}</span>
          <span class="fl-body">
            <span class="fl-rank">${escapeHtml(String(item.rank || index + 1))}위</span>
            <strong class="fl-title">${escapeHtml(item.title)}</strong>
            <span class="fl-next">${escapeHtml(next)}</span>
          </span>
        </a>
      </li>`;
  }

  function renderVenueFilters() {
    const venues = state.data.venues || [];
    const jumpDate = activeDateFilter() || todayScheduleDate();
    const shortcutTitle = isTodayScheduleDate(jumpDate) ? "오늘 상영관 바로가기" : "상영관 바로가기";
    const desktopTitle = $("#desktopVenueShortcutTitle");
    const mobileTitle = $("#mobileVenueShortcutTitle");
    if (desktopTitle) desktopTitle.textContent = shortcutTitle;
    if (mobileTitle) mobileTitle.textContent = shortcutTitle;
    const sessions = getRemainingSessions().filter((session) => session.date === jumpDate);
    const counts = countBy(sessions, (session) => session.venueId);
    const items = venueShortcutItems(
      venues,
      (venue) => ({
        id: venue.id,
        name: venue.name,
        displayName: venue.name,
        area: venue.area,
        address: venueAddress(venue),
        count: counts[venue.id] || 0,
        countLabel: `${(counts[venue.id] || 0).toLocaleString("ko-KR")}회차`,
        shortCountLabel: `${(counts[venue.id] || 0).toLocaleString("ko-KR")}회차`
      })
    );
    const shortcutItems = items;

    const mobileLayout = isMobileViewport();
    const activeTarget = mobileLayout ? $("#mobileVenueFilter") : $("#desktopVenueFilter");
    const inactiveTarget = mobileLayout ? $("#desktopVenueFilter") : $("#mobileVenueFilter");
    inactiveTarget?.replaceChildren();
    renderVenueFilterTiles(activeTarget, shortcutItems);
  }

  function renderVenueFilterTiles(target, items) {
    if (!target) return;
    target.parentElement?.classList.toggle("hidden", !items.length);
    target.innerHTML = items
      .map((item) => {
        const name = item.displayName || item.name;
        const favorite = isFavoriteVenue(item.id);
        return `<button class="chip${item.count ? "" : " is-empty"}" type="button" data-venue-jump="${escapeHtml(item.id)}" aria-label="${escapeHtml(`${item.name} ${item.countLabel}${favorite ? ", 즐겨찾기" : ""}`)}">${favorite ? iconMarkup("star-fill") : ""}${escapeHtml(name)}<span class="n">${item.count.toLocaleString("ko-KR")}</span></button>`;
      })
      .join("");
  }

  function searchResultMeta(sessions) {
    const dates = compactValues(sessions.map((session) => shortDate(session.date)), 4);
    const venueCount = new Set(sessions.map((session) => session.venueId).filter(Boolean)).size;
    return [`${venueCount.toLocaleString("ko-KR")}곳`, `${sessions.length.toLocaleString("ko-KR")}회차`, dates].filter(Boolean).join(" · ");
  }

  function setHidden(element, hidden) {
    element?.classList.toggle("hidden", hidden);
  }

  function toggleSearchOnlyLayout(active) {
    setHidden($("#desktopDateBar")?.parentElement, active);
    setHidden(document.querySelector("[data-toggle-style='desktop']")?.parentElement?.parentElement, active);
    setHidden($("#desktopVenueFilter")?.parentElement, active);
    setHidden($("#desktopSchedule"), active);

    setHidden($("#mobileDateBar")?.closest(".sticky"), active);
    setHidden($("#view-today")?.parentElement, active);
    setHidden($("#mobileVenueFilter")?.parentElement, active);
    setHidden($("#mobileScheduleHeading")?.parentElement, active);
    setHidden($("#mobileSchedule"), active);

    ["programs", "festivals", "mobile-programs", "mobile-festivals"].forEach((id) => {
      setHidden(document.getElementById(id), active);
    });
  }

  function renderSearchResultRow(title, sessions) {
    const venues = venueMap();
    const sorted = sortSessions(sessions);
    const first = sorted[0];
    const showDate = new Set(sorted.map((session) => session.date).filter(Boolean)).size > 1 || !isTodayScheduleDate(first?.date);
    const venueGroups = groupedSessionEntries(sorted, (session) => session.venueId || "unknown", { sortByFavorites: true });
    return `
      <div class="group">
        ${thumbMarkup(first)}
        <div class="what">
          <p class="group-title"><span class="tt" title="${escapeHtml(title)}">${escapeHtml(title)}</span></p>
          <p class="meta">${rateBadgeMarkup(first)}${escapeHtml(searchResultMeta(sorted))}</p>
          ${venueGroups
            .map((group) => {
              const venueName = venues[group.key]?.name || group.sessions[0]?.venueName || "상영관";
              return `<div class="rv"><span class="rv-name">${escapeHtml(venueName)}</span><div class="times">${group.sessions.map((session) => timeChipMarkup(session, showDate)).join("")}</div></div>`;
            })
            .join("")}
        </div>
      </div>`;
  }

  function renderSearchResults(filtered) {
    const query = state.query.trim();
    const active = Boolean(query);
    const groups = active ? groupedSessionEntries(filtered, (session) => session.title || "제목 확인") : [];
    const desktop = $("#desktopSearchResults");
    const mobile = $("#mobileSearchResults");
    const mobileLayout = isMobileViewport();
    const status = $("#searchResultStatus");

    if (status) status.textContent = active ? `${groups.length}편, ${filtered.length.toLocaleString("ko-KR")}회차` : "";

    toggleSearchOnlyLayout(active);
    const activeContainer = mobileLayout ? mobile : desktop;
    const inactiveContainer = mobileLayout ? desktop : mobile;
    if (inactiveContainer) {
      inactiveContainer.classList.add("hidden");
      inactiveContainer.replaceChildren();
    }
    if (!activeContainer) return;
    activeContainer.classList.toggle("hidden", !active);
    activeContainer.innerHTML = active
      ? `
        <section class="results" aria-label="검색 결과">
          <div class="results-h">
            <strong>‘${escapeHtml(query)}’ 검색 결과</strong>
            <span>${groups.length}편 · ${filtered.length.toLocaleString("ko-KR")}회</span>
          </div>
          ${
            groups.length
              ? groups.map((group) => renderSearchResultRow(group.key, group.sessions)).join("")
              : `<p class="empty-line">${escapeHtml(emptyScheduleMessage("검색 결과가 없습니다."))}</p>`
          }
        </section>`
      : "";
  }

  function programPeriod(sessions) {
    const dates = uniqueValues(sessions.map((session) => session.date)).sort();
    if (!dates.length) return "";
    if (dates.length === 1) return shortDate(dates[0]);
    return `${shortDate(dates[0])} - ${shortDate(dates[dates.length - 1])}`;
  }

  function genericProgramLabel(value) {
    return /^(?:상영시간표|날짜별 시간표|작품별 상영일정|일반|2D(?:\([^)]*\))?|영문자막|자막|상영)$/i.test(String(value || "").trim());
  }

  function cleanProgramTitle(value) {
    let title = String(value || "")
      .replace(/^2D-/, "")
      .replace(/^#+/, "")
      .replace(/\([^)]*\)/g, "")
      .replace(/\s+/g, " ")
      .trim();
    title = title
      .replace(/^\d{1,2}\s*월\s*\d{1,2}\s*일?\s*/i, "")
      .replace(/^\d{1,2}\s*월\s*/, "")
      .replace(/^\d{1,2}\s*[.\-/]\s*\d{1,2}(?:\s*[월화수목금토일])?\s*/i, "")
      .replace(/^\d+\s*회\s+(?=.{0,40}(?:영화제|페스티벌))/i, "")
      .replace(/\s*[|｜]\s*[^|｜]+$/g, "")
      .replace(/^(.*?(?:영화제|페스티벌))\s*['"‘’“”]([^'"‘’“”]+)['"‘’“”]\s*$/i, "$1: $2")
      .replace(/(.+[가-힣].*?)\s+(?=[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff々〆〤ヶー・0-9A-Za-z\s]*[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff々〆〤ヶー・])[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff々〆〤ヶー・0-9A-Za-z\s]+$/u, "$1")
      .replace(/\s+/g, " ")
      .replace(/\s+([:：])/g, "$1")
      .trim();
    return title;
  }

  function talkLikeProgramText(value) {
    return /GV|관객과의\s*대화|씨네토크|시네토크|인디토크|토크|강연|연주상영/i.test(String(value || ""));
  }

  function majorProgramText(value) {
    return /영화제|페스티벌|프라이드시네마|KQFF|기획전|특별\s*상영|특별전|감독전|회고전|발굴복원전|인디돌잔치|상영회|패키지|주간/i.test(String(value || ""));
  }

  function ignoredProgramText(value) {
    return /굿즈|패키지/i.test(String(value || ""));
  }

  function majorProgramKind(value) {
    const text = String(value || "");
    if (/영화제|페스티벌|프라이드시네마|KQFF/i.test(text)) return "영화제";
    if (/회고전/.test(text)) return "회고전";
    if (/감독전/.test(text)) return "감독전";
    if (/특별\s*상영|특별전|상영회/.test(text)) return "특별상영";
    return "프로그램";
  }

  function programSectionWorthy(program) {
    const text = `${program.title || ""} ${program.kind || ""} ${program.summary || ""}`;
    if (!majorProgramText(text)) return false;
    if (ignoredProgramText(text)) return false;
    return !talkLikeProgramText(program.title);
  }

  function autoProgramKey(session) {
    const venues = venueMap();
    const venueName = venues[session.venueId]?.name || "상영관";
    const program = String(session.program || "").trim();
    const text = `${session.title || ""} ${program} ${session.summary || ""}`;

    if (!majorProgramText(text)) return "";
    if (ignoredProgramText(text)) return "";
    if (session.kind === "talk" || talkLikeProgramText(session.title) || talkLikeProgramText(program)) return "";
    if (/^2D-?영화제/.test(program)) return `${session.venueId}::${venueName} 영화제 상영`;
    if (/^2D-?기획전/.test(program)) return "";
    if (isFestivalSession(session)) {
      return `${session.venueId}::${festivalNameFromSession(session)}`;
    }
    const title = cleanProgramTitle(program);
    if (/기획전|특별\s*상영|패키지|감독전|회고전|상영회|시네마테크|주간|프라이드시네마/i.test(title) && !genericProgramLabel(title) && !/^(?:기획전|영화제|특별상영|상영회|패키지)$/i.test(title)) {
      return `${session.venueId}::${title}`;
    }
    return "";
  }

  function programTokens(program) {
    return uniqueValues(
      cleanProgramTitle(program.title)
        .split(/[\s:·,.'‘’"()[\]\-]+/)
        .filter((token) => token.length >= 2 && !/영화|기획전|특별|상영|프로그램|파트|the|and/i.test(token))
    );
  }

  function cleanMovieListTitle(value) {
    return String(value || "")
      .replace(/\((?:확장판|감독판|디지털|자막|영문자막|무삭제판|리마스터링|4K|2D|3D|더빙)[^)]*\)/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function programCoreTitle(program) {
    const title = cleanProgramTitle(program.title)
      .replace(/[“”‘’"']/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const bracket = title.match(/[<〈]([^>〉]*(?:영화제|페스티벌|기획전|특별전|감독전|회고전|추모전|프로젝트)[^>〉]*)[>〉]/i);
    if (bracket?.[1]) return cleanProgramTitle(bracket[1]);
    const programName = title.match(/([가-힣A-Za-z0-9·\s]+(?:영화제|페스티벌|기획전|특별전|감독전|회고전|추모전|프로젝트))/i);
    return cleanProgramTitle(programName?.[1] || title);
  }

  function dateRangesOverlap(a, b) {
    if (!a?.start || !a?.end || !b?.start || !b?.end) return true;
    return a.start <= b.end && b.start <= a.end;
  }

  function sameProgramCard(a, b) {
    if (!a?.venueId || a.venueId !== b?.venueId) return false;
    if (!dateRangesOverlap(programDateRange(a), programDateRange(b))) return false;
    const aCore = programCoreTitle(a);
    const bCore = programCoreTitle(b);
    if (!aCore || !bCore) return false;
    return aCore === bCore || aCore.includes(bCore) || bCore.includes(aCore);
  }

  function preferredProgramCard(a, b) {
    const score = (program) => {
      const core = programCoreTitle(program);
      let value = 0;
      if (!program.sourceId) value += 30;
      if (posterSource(program) || knownProgramImages[program.id]) value += 4;
      if (/영화제|페스티벌|기획전|특별전|감독전|회고전|추모전|프로젝트/i.test(core)) value += 8;
      if (/[<〈>〉]/.test(program.title || "")) value -= 6;
      value -= Math.min(String(program.title || "").length, 80) / 10;
      return value;
    };
    return score(a) >= score(b) ? a : b;
  }

  function programSessionMatches(program, session) {
    if (program.venueId && session.venueId !== program.venueId) return false;
    const range = programDateRange(program);
    if (range?.start && range?.end && (session.date < range.start || session.date > range.end)) return false;
    const programText = `${program.title || ""} ${program.kind || ""} ${program.summary || ""}`;
    const sessionText = `${session.title || ""} ${session.program || ""} ${session.summary || ""} ${(session.tags || []).join(" ")}`;
    const tokens = programTokens({ title: programCoreTitle(program) });
    if (tokens.some((token) => sessionText.includes(token))) return true;
    if (/영화제|페스티벌|기획전|특별전|감독전|회고전|추모전|프로젝트/i.test(programText)) {
      return /영화제|페스티벌|기획전|특별|감독전|회고전|추모전/i.test(sessionText);
    }
    return false;
  }

  function programMovieTitles(program) {
    const saved = Array.isArray(program.movies) ? program.movies : [];
    const inferred = getRemainingSessions()
      .filter((session) => programSessionMatches(program, session))
      .map((session) => cleanMovieListTitle(session.title));
    return uniqueValues([...saved, ...inferred].map(cleanMovieListTitle).filter(Boolean)).slice(0, 10);
  }

  function mergeProgramCard(a, b) {
    const preferred = preferredProgramCard(a, b);
    const fallback = preferred === a ? b : a;
    const dates = uniqueValues([...(a.dates || []), ...(b.dates || [])].filter(Boolean)).sort();
    const movieTitles = uniqueValues([...(a.movieTitles || []), ...(b.movieTitles || []), ...programMovieTitles(a), ...programMovieTitles(b)].filter(Boolean));
    return {
      ...preferred,
      dates: dates.length ? dates : preferred.dates,
      url: preferred.url || fallback.url || "",
      posterUrl: posterSource(preferred) ? preferred.posterUrl : fallback.posterUrl || preferred.posterUrl,
      movieTitles,
      sessions: Math.max(Number(a.sessions || 0), Number(b.sessions || 0)) || preferred.sessions,
      titleCount: Math.max(Number(a.titleCount || 0), Number(b.titleCount || 0)) || preferred.titleCount
    };
  }

  function mergeProgramCards(programs) {
    return programs.reduce((merged, program) => {
      const prepared = { ...program, movieTitles: programMovieTitles(program) };
      const existingIndex = merged.findIndex((item) => sameProgramCard(item, prepared));
      if (existingIndex >= 0) merged[existingIndex] = mergeProgramCard(merged[existingIndex], prepared);
      else merged.push(prepared);
      return merged;
    }, []);
  }

  function relatedProgramSessions(program) {
    const tokens = programTokens(program);
    const title = cleanProgramTitle(program.title);
    return getRemainingSessions().filter((session) => {
      if (program.venueId && session.venueId !== program.venueId) return false;
      const text = `${session.program || ""} ${session.title || ""} ${session.summary || ""}`;
      if (title && text.includes(title)) return true;
      const hits = tokens.filter((token) => text.includes(token)).length;
      return hits >= Math.min(2, tokens.length || 2);
    });
  }

  function hydrateProgramImage(program) {
    if (posterSource(program)) return program;
    if (knownProgramImages[program.id]) return { ...program, posterUrl: knownProgramImages[program.id] };
    const related = relatedProgramSessions(program).find((session) => posterSource(session));
    return related ? { ...program, posterUrl: posterSource(related) } : program;
  }

  function liveProgramCards() {
    const venues = venueMap();
    const sources = sourceMap();
    const groups = groupBy(
      getRemainingSessions().filter((session) => autoProgramKey(session)),
      autoProgramKey
    );

    return Object.entries(groups)
      .map(([key, sessions]) => {
        const sorted = sortSessions(sessions);
        const first = sorted[0];
        const venue = venues[first.venueId];
        const [, title] = key.split("::");
        const titles = uniqueValues(sorted.map((session) => session.title));
        const source = sources[first.sourceId];
        const url =
          safeExternalUrl(first.detailUrl, "") ||
          safeExternalUrl(source?.url, "") ||
          safeExternalUrl(first.bookingUrl, "") ||
          venueOfficialUrl(venue) ||
          "#";
        const posterSession = sorted.find((session) => posterSource(session)) || first;
        return {
          id: `auto-${key}`,
          title,
          venueId: first.venueId,
          period: programPeriod(sorted),
          dates: uniqueValues(sorted.map((session) => session.date)).sort(),
          kind: majorProgramKind(`${title} ${first.program || ""}`),
          status: "자동 반영",
          url,
          posterUrl: posterSession.posterUrl,
          sessions: sorted.length,
          titleCount: titles.length,
          sortKey: `${sorted[0].date || ""} ${title}`
        };
      })
      .filter((program) => program.title && !/^영화제$/.test(program.title))
      .filter(programSectionWorthy)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "ko"));
  }

  function programDateRange(program) {
    const dateList = Array.isArray(program.dates) ? program.dates : [];
    const relatedDates = dateList.length ? dateList : relatedProgramSessions(program).map((session) => session.date);
    return parsePeriodRange(program.period, relatedDates);
  }

  function programLifecycle(program) {
    return lifecycleFromRange(programDateRange(program));
  }

  function lifecyclePillMarkup(lifecycle) {
    if (!lifecycle?.label) return "";
    return `<span class="pill${lifecycle.tone === "ending" ? " is-ending" : ""}">${escapeHtml(lifecycle.label)}</span>`;
  }

  function lifecycleSortRank(lifecycle) {
    if (lifecycle?.tone === "ending" || lifecycle?.tone === "active") return 0;
    if (lifecycle?.tone === "upcoming") return 1;
    return lifecycle?.expired ? 3 : 2;
  }

  function lifecycleSortDate(range, lifecycle) {
    if (!range) return "";
    return range.end || range.start || "";
  }

  function compareLifecycleItems(aRange, aLifecycle, aFallback, bRange, bLifecycle, bFallback) {
    const rankDiff = lifecycleSortRank(aLifecycle) - lifecycleSortRank(bLifecycle);
    if (rankDiff) return rankDiff;
    const dateDiff = lifecycleSortDate(aRange, aLifecycle).localeCompare(lifecycleSortDate(bRange, bLifecycle));
    if (dateDiff) return dateDiff;
    return String(aFallback || "").localeCompare(String(bFallback || ""), "ko");
  }

  function programCards() {
    const curated = (state.data.programs || [])
      .filter(programSectionWorthy)
      .map(hydrateProgramImage)
      .filter((program) => !programLifecycle(program)?.expired);
    const seen = new Set(curated.map((program) => `${program.venueId || ""}::${program.title || ""}`));
    const live = liveProgramCards().filter((program) => {
      const exactKey = `${program.venueId || ""}::${program.title || ""}`;
      const looseMatch = curated.some((curatedProgram) => {
        if (curatedProgram.venueId !== program.venueId) return false;
        return (
          program.title.includes(curatedProgram.title) ||
          curatedProgram.title.includes(program.title)
        );
      });
      if (seen.has(exactKey) || looseMatch) return false;
      seen.add(exactKey);
      return true;
    }).map(hydrateProgramImage);
    return mergeProgramCards([...curated, ...live]).sort((a, b) => {
      const aRange = programDateRange(a);
      const bRange = programDateRange(b);
      return compareLifecycleItems(aRange, lifecycleFromRange(aRange), a.sortKey || a.title, bRange, lifecycleFromRange(bRange), b.sortKey || b.title);
    });
  }

  function programCardLabel(program, venue) {
    return [program.kind, venue?.name].filter(Boolean).join(" · ") || "프로그램";
  }

  function renderPrograms() {
    const venues = venueMap();
    const programs = programCards();
    const mobileLayout = isMobileViewport();
    const target = mobileLayout ? $("#mobileProgramList") : $("#programList");
    (mobileLayout ? $("#programList") : $("#mobileProgramList"))?.replaceChildren();
    if (!target) return;
    target.innerHTML = programs.length
      ? programs
          .map((program) => {
            const venue = venues[program.venueId];
            const title = cleanProgramTitle(program.title);
            const period = [program.period, program.sessions ? `${program.sessions}회` : ""].filter(Boolean).join(" · ");
            return `
              <a class="prog" href="${escapeHref(program.url)}" target="_blank" rel="noopener noreferrer">
                <span class="prog-top"><span>${escapeHtml(programCardLabel(program, venue))}</span>${lifecyclePillMarkup(programLifecycle(program))}</span>
                <h3 title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
                ${period ? `<p class="prog-period">${escapeHtml(period)}</p>` : ""}
              </a>`;
          })
          .join("")
      : emptyMarkup("지금 진행 중인 프로그램이 없어요.");
  }

  function festivalNameFromSession(session) {
    const venues = venueMap();
    const venueName = venues[session.venueId]?.name || "상영관";
    return resolveFestivalName({ session, programs: state.data?.programs, venueName });
  }

  function festivalSectionFromSession(session) {
    const program = String(session.program || "").trim();
    if (/^2D-?영화제/.test(program)) return cleanProgramTitle(program).replace(/^영화제\s*/, "") || session.screen || "상영";
    return program || session.screen || "상영";
  }

  function majorFestivalRows() {
    const today = kstDateString();
    return (state.data.majorFestivals || [])
      .map((festival) => {
        const startDate = festival.startDate || festival.date;
        const endDate = festival.endDate || startDate;
        if (!startDate || !endDate) return null;
        const showFrom = festival.showFrom || addMonths(startDate, -1);
        const showUntil = festival.showUntil || addDays(endDate, 1);
        if (today < showFrom || today > showUntil) return null;
        const periodLabel = festival.periodLabel || formatPeriodLabel(startDate, endDate);
        return {
          id: `major-festival-${festival.id || festival.name}`,
          kind: "major-festival",
          date: startDate,
          time: festival.time || "기간",
          name: festival.name || "주요 영화제",
          section: festival.section || "주요 영화제",
          title: periodLabel,
          startDate,
          endDate,
          periodLabel,
          region: festival.region || "",
          venueName: festival.venueName || festival.region || "",
          logoUrl: festival.logoPath || festival.logoUrl || "",
          logoTheme: festival.logoTheme || "",
          accentColor: festival.accentColor || "",
          accentTextColor: festival.accentTextColor || "",
          programHighlights: Array.isArray(festival.programHighlights) ? festival.programHighlights : [],
          highlightGroups: Array.isArray(festival.highlightGroups) ? festival.highlightGroups : [],
          dailyHighlights: Array.isArray(festival.dailyHighlights) ? festival.dailyHighlights : [],
          detailUrl: festival.url || festival.detailUrl,
          sourceLabel: festival.sourceLabel || "",
          sourceUrl: festival.sourceUrl || festival.url || "",
          status: festival.status || "confirmed",
          bookingType: "detail",
          actionLabel: festival.actionLabel || "공식"
        };
      })
      .filter(Boolean);
  }

  function festivalVenueLabel(row, venues) {
    return row.venueName || row.region || venues[row.venueId]?.name || "";
  }

  function majorFestivalRow(group) {
    return (group?.rows || []).find((row) => row.kind === "major-festival");
  }

  function isCurrentMajorFestivalGroup(group) {
    const major = majorFestivalRow(group);
    const lifecycle = festivalGroupLifecycle(group);
    return Boolean(major && !lifecycle?.expired && (lifecycle?.tone === "active" || lifecycle?.tone === "ending"));
  }

  function festivalGroupSummary(group, venues) {
    const major = majorFestivalRow(group);
    if (major) {
      return [major.periodLabel, festivalVenueLabel(major, venues), major.section].filter(Boolean).join(" · ");
    }
    const venuesText = compactValues(group.rows.map((row) => festivalVenueLabel(row, venues)), 3);
    const dateText = compactValues(group.rows.map((row) => formatDate(row.date)), 2);
    const sectionCount = festivalScheduleSections(group).length;
    return [dateText, venuesText, `${group.rows.length}회차, ${sectionCount}개 섹션`].filter(Boolean).join(" · ");
  }

  function festivalScheduleSectionLabel(row, groupName) {
    const title = String(row.title || "").trim();
    const explicitSection = cleanProgramTitle(row.section || "");
    const normalizedName = String(groupName || "").replace(/\s+/g, "").toLowerCase();
    const normalizedSection = explicitSection.replace(/\s+/g, "").toLowerCase();
    const titleSections = [
      [/\bEX[-\s]?Now\b/i, "EX-Now"],
      [/\bEX[-\s]?Choice\b/i, "EX-Choice"],
      [/\bAsia\s+Forum\b/i, "Asia Forum"],
      [/개막식|개막작/, "개막"],
      [/폐막식|폐막작/, "폐막"],
      [/포럼|Forum/i, "포럼"],
      [/포커스/i, "포커스"]
    ];
    const titleSection = titleSections.find(([pattern]) => pattern.test(title));
    if (titleSection) return titleSection[1];
    if (
      explicitSection &&
      normalizedSection !== normalizedName &&
      !isGenericFestivalSectionLabel(explicitSection) &&
      !/영화제|페스티벌|KQFF/i.test(explicitSection)
    ) {
      return explicitSection;
    }
    return `${shortDate(row.date)} 프로그램`;
  }

  function festivalScheduleSections(group) {
    const sections = new Map();
    for (const row of group?.rows || []) {
      if (row.kind === "major-festival") continue;
      const label = festivalScheduleSectionLabel(row, group.name);
      if (!sections.has(label)) sections.set(label, { label, rows: [] });
      sections.get(label).rows.push(row);
    }
    return [...sections.values()];
  }

  function festivalScheduleSectionMeta(section) {
    const dates = compactValues(section.rows.map((row) => shortDate(row.date)), 2);
    return [dates, `${section.rows.length}회`].filter(Boolean).join(" · ");
  }

  function festivalRows() {
    const majorRows = majorFestivalRows();
    const liveRows = getRemainingSessions()
      .filter(isFestivalSession)
      .map((session) => ({
        id: `festival-${session.id}`,
        date: session.date,
        time: session.time,
        name: festivalNameFromSession(session),
        section: festivalSectionFromSession(session),
        title: session.title,
        venueId: session.venueId,
        bookingUrl: session.bookingUrl,
        detailUrl: session.detailUrl,
        bookingType: session.bookingType,
        actionLabel: session.actionLabel
      }));

    const curatedRows = (state.data.festivals || [])
      .filter((row) => !isPastTimedItem(row))
      .filter((row) => {
        const isPlaceholder = /확인 필요|시간표 확인|needs-check|시간 확인/i.test(`${row.status || ""} ${row.title || ""} ${row.time || ""}`);
        const hasLiveReplacement = liveRows.some((live) => {
          if (live.venueId !== row.venueId) return false;
          const liveText = `${live.name || ""} ${live.section || ""} ${live.title || ""}`;
          const rowText = `${row.name || ""} ${row.section || ""} ${row.title || ""}`;
          return liveText.includes(row.name || "") || rowText.includes(live.name || "");
        });
        return !(isPlaceholder && hasLiveReplacement);
      });
    const rows = [...majorRows, ...curatedRows, ...liveRows];
    const seen = new Set();
    return rows
      .filter((row) => {
        const key = `${row.kind || "festival"}|${row.date}|${row.time}|${row.venueId || row.name}|${row.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  }

  function festivalGroups(rows) {
    return Object.entries(groupBy(rows, (row) => row.name || "영화제"))
      .map(([name, groupedRows]) => {
        const sortedRows = groupedRows.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
        const major = sortedRows.find((row) => row.kind === "major-festival");
        const range = major
          ? { start: major.startDate || major.date, end: major.endDate || major.date }
          : parsePeriodRange("", sortedRows.map((row) => row.date));
        return {
          name,
          rows: sortedRows,
          range,
          lifecycle: lifecycleFromRange(range)
        };
      })
      .sort((a, b) => {
        const currentMajorDiff = Number(isCurrentMajorFestivalGroup(b)) - Number(isCurrentMajorFestivalGroup(a));
        if (currentMajorDiff) return currentMajorDiff;
        return compareLifecycleItems(
          a.range,
          a.lifecycle,
          `${a.rows[0]?.date || ""} ${a.name}`,
          b.range,
          b.lifecycle,
          `${b.rows[0]?.date || ""} ${b.name}`
        );
      });
  }

  function festivalGroupLifecycle(group) {
    return group?.lifecycle || lifecycleFromRange(group?.range || parsePeriodRange("", (group?.rows || []).map((row) => row.date)));
  }

  function festivalActionMarkup(row) {
    const url = actionUrl(row);
    if (url === "#") return `<span class="book is-off">확인중</span>`;
    const label = actionLabel(row);
    return `<a class="book${row.bookingType === "booking" ? "" : " is-ghost"}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  }

  function majorFestivalLogoMarkup(row) {
    if (!row?.logoUrl) return "";
    return `<span class="fest-logo${row.logoTheme === "dark" ? " is-dark" : ""}"><img src="${escapeHtml(row.logoUrl)}" alt="${escapeHtml(row.name)} 로고" loading="lazy" /></span>`;
  }

  function majorFestivalHighlightsMarkup(row) {
    const detailGroups = Array.isArray(row?.highlightGroups) ? row.highlightGroups.filter((group) => group?.label && Array.isArray(group.items) && group.items.length) : [];
    if (detailGroups.length) {
      return `
        <div class="fest-more">
          ${detailGroups
            .slice(0, 6)
            .map((group) => {
              const groupUrl = safeExternalUrl(group.url, "");
              const labelMarkup = groupUrl
                ? `<a href="${escapeHtml(groupUrl)}" target="_blank" rel="noopener noreferrer" data-stop-propagation>${escapeHtml(group.label)}</a>`
                : `<span>${escapeHtml(group.label)}</span>`;
              return `
                <details>
                  <summary>${labelMarkup}</summary>
                  <div class="items">${group.items.filter(Boolean).slice(0, 4).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
                </details>`;
            })
            .join("")}
        </div>`;
    }

    const daily = Array.isArray(row?.dailyHighlights) ? row.dailyHighlights : [];
    if (daily.length) {
      return `
        <div class="fest-days">
          ${daily
            .slice(0, 3)
            .map((day) => {
              const items = Array.isArray(day.items) ? day.items.filter(Boolean).slice(0, 3) : [];
              if (!day.date || !items.length) return "";
              return `<p><strong>${escapeHtml(shortDate(day.date))}</strong>${escapeHtml(items.join(" · "))}</p>`;
            })
            .join("")}
        </div>`;
    }

    const highlights = Array.isArray(row?.programHighlights) ? row.programHighlights.filter(Boolean) : [];
    if (!highlights.length) return "";
    return `<div class="fest-chips">${highlights.slice(0, 6).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`;
  }

  function festivalScheduleSectionsMarkup(group, venues) {
    const sections = festivalScheduleSections(group);
    if (!sections.length) return "";
    return `
      <div class="fest-more">
        ${sections
          .map(
            (section) => `
              <details>
                <summary>${escapeHtml(section.label)} <small>${escapeHtml(festivalScheduleSectionMeta(section))}</small></summary>
                <div class="items">
                  ${section.rows
                    .map(
                      (row) => `
                        <div class="fest-item">
                          <span class="fw${isSunday(row.date) ? " is-sun" : ""}"><strong>${escapeHtml(formatDate(row.date))}</strong>${escapeHtml(row.time || "")}</span>
                          <span class="fc"><strong title="${escapeHtml(row.title)}">${escapeHtml(row.title)}</strong><small>${escapeHtml(festivalVenueLabel(row, venues))}</small></span>
                          ${festivalActionMarkup(row)}
                        </div>`
                    )
                    .join("")}
                </div>
              </details>`
          )
          .join("")}
      </div>`;
  }

  function renderFestivals() {
    const venues = venueMap();
    const groups = festivalGroups(festivalRows());
    const mobileLayout = isMobileViewport();
    const target = mobileLayout ? $("#mobileFestivalList") : $("#festivalRows");
    (mobileLayout ? $("#festivalRows") : $("#mobileFestivalList"))?.replaceChildren();
    if (!target) return;
    target.innerHTML = groups.length
      ? groups.map((group) => festivalItemMarkup(group, venues)).join("")
      : `<p class="fest-empty">등록된 영화제 일정이 없어요.</p>`;
  }

  function normalizeTrendTitle(value) {
    return String(value || "")
      .replace(/\([^)]*\)/g, "")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "")
      .toLowerCase();
  }

  function trendMatchingSessions(item) {
    const title = normalizeTrendTitle(item?.title);
    if (!title) return [];
    return sortSessions(
      getRemainingSessions().filter((session) => {
        const sessionTitle = normalizeTrendTitle(session.title);
        return sessionTitle && (sessionTitle.includes(title) || title.includes(sessionTitle));
      })
    );
  }

  function communityTrendItems() {
    const items = Array.isArray(state.communityTrends?.items) ? state.communityTrends.items : [];
    return items
      .filter((item) => item?.title)
      .map((item, index) => {
        const sessions = trendMatchingSessions(item);
        const firstSession = sessions[0];
        return {
          ...item,
          rank: item.rank || index + 1,
          sessions,
          firstSession,
          posterUrl: item.posterUrl || firstSession?.posterUrl || "",
          url: firstSession ? actionUrl(firstSession) : safeExternalUrl(item.url, "#")
        };
      })
      .slice(0, 4);
  }

  function trendMetaText(item) {
    const venues = venueMap();
    const today = kstDateString();
    const todaySessions = (item.sessions || []).filter((session) => session.date === today);
    const session = todaySessions[0] || item.firstSession;
    if (!session) return item.caption || "상영 일정 확인 중";
    const venue = venues[session.venueId]?.name || "상영관";
    const prefix = session.date === today ? "오늘" : shortDate(session.date);
    return `${prefix} ${session.time} · ${venue}`;
  }

  function youtubeTrailerSearchUrl(title) {
    const query = encodeURIComponent(`${title || "영화"} 예고편`);
    return `https://www.youtube.com/results?search_query=${query}`;
  }

  function trendTrailerUrl(item) {
    return safeExternalUrl(item?.trailerUrl, "") || youtubeTrailerSearchUrl(item?.title);
  }

  function renderPopularPicks() {
    const items = communityTrendItems();
    const searchActive = Boolean(state.query.trim());
    // Stays up in every view so switching views does not shove the schedule up and down.
    const active = !searchActive && items.length > 0;
    const mobileLayout = isMobileViewport();
    const activeSection = mobileLayout ? $("#mobile-popular") : $("#popular");
    const inactiveSection = mobileLayout ? $("#popular") : $("#mobile-popular");
    const activeList = mobileLayout ? $("#mobilePopularList") : $("#popularList");
    const inactiveList = mobileLayout ? $("#popularList") : $("#mobilePopularList");

    activeSection?.classList.toggle("hidden", !active);
    inactiveSection?.classList.add("hidden");
    inactiveList?.replaceChildren();
    if (!activeList) return;
    if (!active) {
      activeList.replaceChildren();
      return;
    }
    const signature = `${mobileLayout}|${items.map((item) => `${item.title}|${trendTimeChoices(item, 3).map((choice) => `${choice.url}${choice.time}`).join(",")}`).join(";")}`;
    // Re-rendering resets the carousel's scroll position, so keep the markup when nothing changed.
    if (activeList.dataset.signature === signature && activeList.childElementCount) return;
    activeList.dataset.signature = signature;
    const [lead, ...rest] = items;
    activeList.innerHTML = mobileLayout
      ? items.map((item, index) => trendHeroMarkup(item, index)).join("")
      : `${trendHeroMarkup(lead, 0)}${rest.length ? `<ul class="feature-list">${rest.map((item, index) => trendListItemMarkup(item, index + 1)).join("")}</ul>` : ""}`;
  }

  async function loadCommunityTrends() {
    try {
      const response = await fetch("data/community-trends.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`data/community-trends.json ${response.status}`);
      state.communityTrends = await response.json();
    } catch {
      state.communityTrends = { items: [] };
    }
  }

  function render() {
    if (!state.data) return;
    const mobileLayout = isMobileViewport();
    state.lastRenderedMobileLayout = mobileLayout;
    normalizeDateSelection();
    const filtered = getFilteredSessions();
    const searchFiltered = state.query.trim()
      ? getFilteredSessions({ includeDate: false, includeLinkFilter: false, includeVenueFilter: false })
      : filtered;
    updateMeta(filtered);
    renderVenueFilters();
    renderSearchResults(searchFiltered);
    renderDateBars();
    renderViewButtons();
    if (state.query.trim()) {
      $("#desktopSchedule")?.replaceChildren();
      $("#mobileSchedule")?.replaceChildren();
    } else if (mobileLayout) {
      $("#desktopSchedule")?.replaceChildren();
      renderMobileSchedule(filtered);
    } else {
      $("#mobileSchedule")?.replaceChildren();
      renderDesktopSchedule(filtered);
    }
    if (state.query.trim()) {
      [$("#programList"), $("#mobileProgramList"), $("#festivalRows"), $("#mobileFestivalList")].forEach((element) =>
        element?.replaceChildren()
      );
    } else {
      renderPrograms();
      renderFestivals();
    }
    renderPopularPicks();
    updateSoonBadges();
    repairPosterImages();
    syncInitialHashScroll();
    updateNavActive();
  }

  function hideBootFallback() {
    document.body.classList.remove("app-loading");
    const fallback = $("#bootFallback");
    if (fallback) fallback.remove();
  }

  function syncInitialHashScroll() {
    if (!window.location.hash) return;
    const hash = window.location.hash;
    // Key on the hash only (not data size) so a background data refresh does not
    // re-trigger an auto-scroll and yank the user back to the anchor. A real hash
    // change resets hashSyncKey via the hashchange handler, so navigation still scrolls.
    if (state.hashSyncKey === hash) return;
    state.hashSyncKey = hash;
    const sync = () => {
      const id = safeDecodeURIComponent(hash.slice(1));
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      const top = target.getBoundingClientRect().top + window.scrollY - navOffset();
      window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
      setNavActive(id);
    };
    window.requestAnimationFrame(sync);
    [80, 300, 700, 1400, 2400].forEach((delay) => window.setTimeout(sync, delay));
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("visible");
    window.setTimeout(() => toast.classList.remove("visible"), 1800);
  }

  let searchRenderTimer = null;

  function syncSearch(value) {
    state.query = value;
    [$("#searchInput"), $("#tabletSearchInput"), $("#mobileSearchInput")].forEach((input) => {
      if (input && input.value !== value) input.value = value;
    });
    // Debounce the full re-render so each keystroke doesn't rebuild both DOM trees.
    if (searchRenderTimer) clearTimeout(searchRenderTimer);
    searchRenderTimer = window.setTimeout(() => {
      searchRenderTimer = null;
      render();
    }, 180);
  }

  async function refreshScheduleData(options = {}) {
    if (!state.data || state.dataRefreshing) return false;

    const now = Date.now();
    if (!options.force && now - state.lastDataRefreshAt < scheduleDataRefreshCooldownMs) return false;

    state.dataRefreshing = true;
    try {
      const nextData = await loadData();
      const nextSignature = scheduleDataSignature(nextData);
      state.lastDataRefreshAt = Date.now();
      if (nextSignature === state.dataSignature) return false;

      applyScheduleData(nextData);
      render();
      startBrowserLiveRefresh(nextData);
      return true;
    } catch {
      return false;
    } finally {
      state.dataRefreshing = false;
    }
  }

  function bindLifecycleRefresh() {
    const refreshVisibleData = () => {
      reconcileDateState();
      if (!document.hidden) refreshScheduleData();
    };

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshVisibleData();
    });
    window.addEventListener("focus", refreshVisibleData);
    window.addEventListener("online", () => refreshScheduleData({ force: true }));
    window.setInterval(() => {
      const dateChanged = reconcileDateState({ refreshData: true });
      if (!dateChanged && !document.hidden) refreshScheduleData();
    }, dateRolloverCheckMs);
  }

  function setMobileSearchOpen(open) {
    const panel = $("#mobileSearchPanel");
    const button = $("#mobileSearchButton");
    const icon = button?.querySelector(".ui-icon use");
    panel?.classList.toggle("hidden", !open);
    button?.setAttribute("aria-expanded", String(open));
    button?.setAttribute("aria-label", open ? "검색 닫기" : "검색 열기");
    if (icon) icon.setAttribute("href", `${iconSpritePath}#${open ? "x" : "search"}`);
  }

  function setTabletSearchOpen(open) {
    const panel = $("#tabletSearchPanel");
    const button = $("#tabletSearchButton");
    const icon = button?.querySelector(".ui-icon use");
    panel?.classList.toggle("hidden", !open);
    button?.setAttribute("aria-expanded", String(open));
    button?.setAttribute("aria-label", open ? "검색 닫기" : "검색 열기");
    if (icon) icon.setAttribute("href", `${iconSpritePath}#${open ? "x" : "search"}`);
  }

  function clearSearch() {
    if (searchRenderTimer) {
      clearTimeout(searchRenderTimer);
      searchRenderTimer = null;
    }
    state.query = "";
    [$("#searchInput"), $("#tabletSearchInput"), $("#mobileSearchInput")].forEach((input) => {
      if (input) input.value = "";
    });
    render();
  }

  function closeMobileSearch() {
    clearSearch();
    setMobileSearchOpen(false);
  }

  function closeTabletSearch() {
    clearSearch();
    setTabletSearchOpen(false);
  }

  const viewOrder = ["today", "film", "venue"];

  // Keeps the view control where the finger is (the picks above it come and go between
  // views) and slides the new schedule in from the side the control moved towards.
  function switchView(nextView, button) {
    if (!nextView || nextView === state.view) return;
    const direction = viewOrder.indexOf(nextView) > viewOrder.indexOf(state.view) ? 1 : -1;
    const anchorTop = button.getBoundingClientRect().top;
    state.view = nextView;
    state.venueFilter = "all";
    render();
    const replacement = [...document.querySelectorAll(`[data-view="${nextView}"]`)].find((item) => item.offsetParent);
    const delta = replacement ? replacement.getBoundingClientRect().top - anchorTop : 0;
    if (Math.abs(delta) > 1 && window.scrollY > 0) window.scrollTo({ top: Math.max(0, window.scrollY + delta), behavior: "instant" });
    animateScheduleSwap(direction);
  }

  function animateScheduleSwap(direction) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const mobile = isMobileViewport();
    const from = direction ? `translateX(${direction * 32}px)` : "translateY(10px)";
    const easing = "cubic-bezier(0.2, 0.8, 0.2, 1)";
    const title = $(mobile ? "#mobileScheduleHeading" : "#desktopScheduleTitle")?.parentElement;
    title?.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 220, easing });
    $(mobile ? "#mobileSchedule" : "#desktopSchedule")?.animate(
      [{ opacity: 0, transform: from }, { opacity: 1, transform: "none" }],
      { duration: 340, easing }
    );
  }

  function bindEvents() {
    $("#searchInput")?.addEventListener("input", (event) => syncSearch(event.target.value));
    $("#tabletSearchInput")?.addEventListener("input", (event) => syncSearch(event.target.value));
    $("#mobileSearchInput")?.addEventListener("input", (event) => syncSearch(event.target.value));
    $("#tabletSearchButton")?.addEventListener("click", () => {
      const open = $("#tabletSearchPanel")?.classList.contains("hidden");
      if (open) {
        setTabletSearchOpen(true);
        window.setTimeout(() => $("#tabletSearchInput")?.focus(), 30);
      } else {
        closeTabletSearch();
      }
    });
    $("#mobileSearchButton")?.addEventListener("click", () => {
      const open = $("#mobileSearchPanel")?.classList.contains("hidden");
      if (open) {
        setMobileSearchOpen(true);
        window.setTimeout(() => $("#mobileSearchInput")?.focus(), 30);
      } else {
        closeMobileSearch();
      }
    });
    $("#mobileSearchInput")?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeMobileSearch();
      $("#mobileSearchButton")?.focus();
    });
    $("#tabletSearchInput")?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeTabletSearch();
      $("#tabletSearchButton")?.focus();
    });

    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-stop-propagation]")) {
        event.stopPropagation();
      }

      if (event.target.closest("[data-theme-toggle]")) {
        toggleTheme();
        return;
      }

      const navLink = event.target.closest("[data-nav-target]");
      if (navLink) {
        const targetId = navLink.dataset.navTarget;
        if (targetId && scrollToSection(targetId)) {
          event.preventDefault();
          state.hashSyncKey = "";
          history.pushState(null, "", `#${encodeURIComponent(targetId)}`);
          return;
        }
      }

      const dateButton = event.target.closest("[data-date]");
      if (dateButton) {
        const selectedDate = dateButton.dataset.date || "";
        if ((state.date || "") === selectedDate) return;
        state.date = selectedDate || null;
        render();
        const replacement = [...document.querySelectorAll("[data-date]")].find(
          (button) => button.dataset.date === selectedDate
        );
        replacement?.focus({ preventScroll: true });
        animateScheduleSwap(0);
        return;
      }

      const viewButton = event.target.closest("[data-view]");
      if (viewButton) {
        switchView(viewButton.dataset.view, viewButton);
        return;
      }

      const favoriteVenueToggle = event.target.closest("[data-favorite-venue]");
      if (favoriteVenueToggle) {
        event.preventDefault();
        event.stopPropagation();
        toggleFavoriteVenue(favoriteVenueToggle.dataset.favoriteVenue || "");
        return;
      }

      const venueJumpButton = event.target.closest("[data-venue-jump]");
      if (venueJumpButton) {
        jumpToVenueSchedule(venueJumpButton.dataset.venueJump || "all");
        return;
      }

      if (event.target.closest("[data-retry-load]")) {
        window.location.reload();
      }
    });

    window.addEventListener("hashchange", () => {
      state.hashSyncKey = "";
      window.setTimeout(syncInitialHashScroll, 0);
      window.setTimeout(syncInitialHashScroll, 300);
      window.setTimeout(updateNavActive, 320);
    });
    let navScrollScheduled = false;
    window.addEventListener(
      "scroll",
      () => {
        if (navScrollScheduled) return;
        navScrollScheduled = true;
        requestAnimationFrame(() => {
          navScrollScheduled = false;
          updateNavActive();
        });
      },
      { passive: true }
    );
    window.addEventListener("resize", () => {
      if (window.innerWidth < 768 || window.innerWidth >= 1024) setTabletSearchOpen(false);
      if (state.data && state.lastRenderedMobileLayout !== isMobileViewport()) {
        lastNavActiveId = null;
        render();
        return;
      }
      updateNavActive();
    });
    bindLifecycleRefresh();
  }

  function validateSchedulePayload(data) {
    if (!data || typeof data !== "object") throw new Error("schedule payload is not an object");
    for (const key of ["venues", "sessions", "programs", "sources"]) {
      if (!Array.isArray(data[key])) throw new Error(`schedule payload is missing ${key}`);
    }
    return data;
  }

  async function loadData() {
    const response = await fetch("data/schedule.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`data/schedule.json ${response.status}`);
    return validateSchedulePayload(await response.json());
  }

  function renderError() {
    hideBootFallback();
    const block = `
      <div class="empty" role="alert">
        <strong>시간표 데이터를 불러오지 못했습니다.</strong>
        <span>인터넷 연결을 확인한 뒤 다시 시도해 주세요.</span>
        <button class="book" type="button" data-retry-load>
          ${iconMarkup("refresh-cw", "ui-icon-sm")}
          다시 시도
        </button>
      </div>
    `;
    $("#desktopSchedule").innerHTML = block;
    $("#mobileSchedule").innerHTML = block;
  }

  async function init() {
    bindEvents();
    syncThemeControls();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", syncThemeControls);
    try {
      state.favoriteVenueIds = loadFavoriteVenueIds();
      const [scheduleData] = await Promise.all([loadData(), loadCommunityTrends()]);
      applyScheduleData(scheduleData, { resetDate: true });
      render();
      hideBootFallback();
      startBrowserLiveRefresh(scheduleData);
      window.setInterval(updateSoonBadges, 30 * 1000);
    } catch {
      renderError();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
