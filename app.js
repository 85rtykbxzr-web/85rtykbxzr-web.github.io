import { addCalendarDays, addCalendarMonths, calendarDaysBetween } from "./src/calendar-date.mjs";
import {
  isFestivalSession,
  isGenericFestivalSectionLabel,
  resolveFestivalName
} from "./src/festival-labels.mjs";
import { safePublicUrl } from "./src/public-url-policy.mjs";

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
  const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const kindLabels = {
    talk: "GV·토크",
    festival: "영화제",
    program: "기획전",
    package: "굿즈",
    special: "특별상영"
  };
  const statusLabels = {
    confirmed: "확정",
    "needs-check": "확인 필요",
    soldout: "매진"
  };
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
  const compactVenueMarks = new Set(["artnine", "cinecube", "emu", "filmforum"]);
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

  function favoriteVenueButton(venueId, venueName, extraClass = "") {
    if (!venueId || venueId === "all") return "";
    const favorite = isFavoriteVenue(venueId);
    const title = `${venueName || "상영관"} 즐겨찾기 ${favorite ? "해제" : "추가"}`;
    const colorClass = favorite ? "text-primary" : "text-on-surface-variant hover:text-primary";
    return `
      <button class="inline-flex shrink-0 items-center justify-center rounded-full bg-transparent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 ${colorClass} ${extraClass}" type="button" data-favorite-venue="${escapeHtml(venueId)}" aria-pressed="${favorite}" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}">
        ${iconMarkup(favorite ? "star-fill" : "star")}
      </button>
    `;
  }

  function venueMarkSizeClass(id, compact = false) {
    if (id === "sac") return compact ? "max-h-8 max-w-[118px]" : "max-h-10 max-w-[160px]";
    if (compactVenueMarks.has(id)) return compact ? "max-h-9 max-w-[54px]" : "max-h-10 max-w-[70px]";
    return compact ? "max-h-7 max-w-[86px]" : "max-h-8 max-w-[126px]";
  }

  function venueMarkHtml(item, compact = false) {
    if (item.id === "all") {
      return `
        <span class="flex ${compact ? "h-8 w-8" : "h-10 w-10"} items-center justify-center border border-primary/10 bg-primary text-surface">
          ${iconMarkup("film", compact ? "ui-icon-sm" : "")}
        </span>
      `;
    }

    const source = venueMarkAssets[item.id];
    const markLabel = venueMarkText[item.id] || item.name || "상영관";
    const maxClass = venueMarkSizeClass(item.id, compact);

    if (!source) {
      return `
        <span class="flex ${compact ? "h-7 min-w-7 px-1 text-[10px]" : "h-10 min-w-10 px-2 text-[11px]"} items-center justify-center border border-primary/10 font-bold tracking-normal text-primary">
          ${escapeHtml(markLabel)}
        </span>
      `;
    }

    return `
      <img class="${maxClass} object-contain" src="${escapeHtml(source)}" alt="${escapeHtml(item.name)} 로고" width="${compact ? 86 : 126}" height="${compact ? 28 : 40}" loading="lazy" decoding="async" />
    `;
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

  function venueInfoHtml(venue, fallback = "상영일 운영 | 서울", compact = false) {
    if (!venue) return escapeHtml(fallback);
    const closedDay = venueClosedDays[venue.id] || "상영일 운영";
    const address = venueAddress(venue);
    const venueName = venue.name || "상영관";
    return `
      <span>
        ${escapeHtml(closedDay)} |
        <a class="text-on-surface-variant underline decoration-primary/20 underline-offset-2 transition-colors hover:text-primary hover:decoration-primary" href="${escapeHref(naverMapUrl(venue))}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`${address} · ${venueName} 네이버 지도 열기`)}" title="네이버맵에서 주소 보기">${escapeHtml(address)}</a>
      </span>
    `;
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

  function dateToneClass(dateString, fallback = "text-primary") {
    return isSunday(dateString) ? "text-error" : fallback;
  }

  function getSourcesByVenue() {
    return groupBy(state.data?.sources || [], (source) => source.venueId || "unknown");
  }

  function sourceMap() {
    return Object.fromEntries((state.data?.sources || []).map((source) => [source.id, source]));
  }

  function updateMeta() {
    const dates = getUpcomingDates();
    let range = state.data?.meta?.rangeLabel || "상영 일정 확인 중";
    if (dates.length) {
      const first = parseLocalDate(dates[0]);
      const last = parseLocalDate(dates[dates.length - 1]);
      range =
        first.getMonth() === last.getMonth()
          ? `${first.getFullYear()}년 ${first.getMonth() + 1}월`
          : `${first.getFullYear()}년 ${first.getMonth() + 1}월 - ${last.getMonth() + 1}월`;
    }

    $("#desktopScheduleTitle").textContent = "상영시간표";
    $("#desktopMonth").textContent = range;
    const dataStatus = $("#desktopDataStatus");
    if (dataStatus) {
      const verifiedAt = formatVerifiedAt(state.data?.meta?.lastVerifiedAt || state.data?.meta?.generatedAt);
      const venueCount = (state.data?.venues || []).length;
      dataStatus.textContent = verifiedAt ? `${verifiedAt} 기준, ${venueCount}개 상영관` : `${venueCount}개 상영관`;
    }
    const mobileHeading = $("#mobileScheduleHeading");
    if (mobileHeading) {
      const filterLabel = state.linkFilter === "all" ? "" : `${actionLabel({ bookingType: state.linkFilter })} `;
      if (state.view === "film") mobileHeading.textContent = "영화별 상영";
      else if (state.view === "venue") mobileHeading.textContent = "상영관별 시간표";
      else mobileHeading.textContent = `${filterLabel}상영시간표`;
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
      return `<img alt="${escapeHtml(title)}" class="${className}" src="${escapeHtml(src)}" width="400" height="600" loading="${priority ? "eager" : "lazy"}" decoding="async" ${priority ? 'fetchpriority="high"' : ""} referrerpolicy="no-referrer" data-poster-title="${escapeHtml(title)}" data-poster-kicker="${escapeHtml(kicker)}"${fallbackAttribute} />`;
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

  function ageClass(label) {
    if (label === "FEST") return "bg-error text-white";
    if (label === "GV") return "bg-primary text-surface";
    if (label === "19") return "bg-major-festival text-white";
    if (label === "15") return "bg-tertiary text-white";
    if (label === "12") return "bg-rating-12 text-white";
    if (label === "INFO") return "bg-outline-variant text-primary";
    return "bg-rating-all text-white";
  }

  function ageBadgeClass(label) {
    const sizeClass = "inline-flex h-5 min-w-7 items-center justify-center px-2 text-[10px]";
    return `${sizeClass} ${ageClass(label)} shrink-0 rounded-sm font-bold leading-none`;
  }

  function ageBadgeTitleOffset() {
    return "mt-1";
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

  function scheduleTimeText(session) {
    return activeDateFilter() ? cleanTime(session) : `${shortDate(session.date)} | ${cleanTime(session)}`;
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

  function displayScheduleTitle(value, limit = 16) {
    const text = String(value || "").trim();
    const chars = Array.from(text);
    return chars.length > limit ? `${chars.slice(0, limit).join("")}...` : text;
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

  function timeLink(session, extraClasses = "", options = {}) {
    const past = isPastSession(session);
    const soldout = isSoldoutSession(session);
    const withSubLabel = options.withSubLabel ?? false;
    const subLabel = soldout ? statusLabels.soldout : actionLabel(session);
    const timeText = scheduleTimeText(session);
    const title = `${session.title || "상영"} ${timeText} ${subLabel}`;
    const url = actionUrl(session);
    if (soldout) {
      return `
        <span class="time-btn time-soldout ${extraClasses}" aria-label="${escapeHtml(`${session.title || "상영"} ${timeText} 매진`)}" title="매진">
          <span class="font-schedule-time text-sm leading-none whitespace-nowrap">${escapeHtml(timeText)}</span>
          <span class="time-soldout-label whitespace-nowrap">매진</span>
        </span>
      `;
    }

    if (past) {
      return `
        <span class="time-btn time-ended ${extraClasses}" aria-label="${escapeHtml(`${session.title || "상영"} ${timeText} 종료`)}" title="상영 종료">
          <span class="font-schedule-time text-sm leading-none whitespace-nowrap">${escapeHtml(timeText)}</span>
        </span>
      `;
    }

    if (url === "#") {
      return `
        <span class="time-btn time-ended ${extraClasses}" aria-label="${escapeHtml(`${session.title || "상영"} ${timeText} 링크 확인 필요`)}" title="링크 확인 필요">
          <span class="font-schedule-time text-sm leading-none whitespace-nowrap">${escapeHtml(timeText)}</span>
          ${withSubLabel ? `<span class="text-[10px] font-label-caps uppercase whitespace-nowrap">확인중</span>` : ""}
        </span>
      `;
    }

    return `
      <a class="time-btn ${extraClasses}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(title)}">
        <span class="font-schedule-time text-sm leading-none whitespace-nowrap">${escapeHtml(timeText)}</span>
        ${withSubLabel ? `<span class="text-[10px] font-label-caps uppercase whitespace-nowrap">${escapeHtml(subLabel)}</span>` : ""}
      </a>
    `;
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
    const desktopAllActive = !activeDate;
    const mobileLayout = isMobileViewport();

    if (mobileLayout) {
      $("#desktopDateBar")?.replaceChildren();
      const mobileMonthDate = activeDate || dates[0] || todayDate;
      const mobileMonthParsed = parseLocalDate(mobileMonthDate);
      const mobileMonth = monthNames[mobileMonthParsed.getMonth()] || "";
      const mobileMonthNumber = String(mobileMonthParsed.getMonth() + 1).padStart(2, "0");
      const mobileMonthTarget = $("#mobileDateMonth");
      if (mobileMonthTarget) {
        mobileMonthTarget.innerHTML = `
          <strong class="mobile-date-month-number">${escapeHtml(mobileMonthNumber)}</strong>
          <span class="mobile-date-month-label mobile-kicker">${escapeHtml(mobileMonth)}</span>
        `;
      }

      const mobileAllButton = `
        <button class="mobile-date-item flex h-[72px] min-w-[62px] flex-col items-center justify-center transition-opacity ${
          !activeDate ? "border-b-2 border-primary text-primary" : "text-on-surface-variant hover:text-primary"
        }" type="button" data-date="" aria-pressed="${!activeDate}" aria-label="ALL ${totalSessions.toLocaleString("ko-KR")} 회차, 전체 날짜">
          <span class="mobile-kicker">ALL</span>
          <span class="text-2xl font-bold leading-none">${totalSessions.toLocaleString("ko-KR")}</span>
          <span class="mobile-kicker">회차</span>
        </button>
      `;

      $("#mobileDateBar").innerHTML = (todayMode ? "" : mobileAllButton) + dates
        .map((date) => {
          const parsed = parseLocalDate(date);
          const active = activeDate === date;
          const sunday = isSunday(date);
          const stateClass = active
            ? `border-b-2 ${sunday ? "border-error text-error" : "border-primary text-primary"}`
            : `${sunday ? "text-error" : "text-on-surface-variant"} hover:text-primary`;
          const count = sessionsByDate[date] || 0;
          return `
            <button class="mobile-date-item flex h-[72px] min-w-[54px] flex-col items-center justify-center transition-colors ${stateClass}" type="button" data-date="${escapeHtml(date)}" aria-pressed="${active}" ${date === todayDate ? 'aria-current="date"' : ""} aria-label="${escapeHtml(`${parsed.getDate()} ${date === todayDate ? "오늘" : weekdays[parsed.getDay()]} · ${count}, ${parsed.getMonth() + 1}월 ${parsed.getDate()}일`)}">
              <span class="text-2xl font-bold leading-none">${parsed.getDate()}</span>
              <span class="mobile-kicker mt-2">${date === todayDate ? "오늘" : weekdays[parsed.getDay()]} · ${count}</span>
            </button>
          `;
        })
        .join("");
      return;
    }

    $("#mobileDateBar")?.replaceChildren();
    const desktopAllButton = `
      <button class="flex-shrink-0 flex flex-col items-center justify-center w-20 h-16 rounded-sm transition-colors cursor-pointer border border-transparent ${
        desktopAllActive ? "bg-primary text-surface" : "text-on-surface-variant hover:bg-primary/5 hover:border-primary/10"
      }" type="button" data-date="" aria-pressed="${desktopAllActive}" aria-label="전체 ${totalSessions.toLocaleString("ko-KR")} 회차, 전체 날짜">
        <span class="text-[10px] font-medium mb-1">전체</span>
        <span class="text-lg font-bold">${totalSessions.toLocaleString("ko-KR")}</span>
        <span class="text-[10px]">회차</span>
      </button>
    `;

    $("#desktopDateBar").innerHTML = (todayMode ? "" : desktopAllButton) + dates
      .map((date) => {
        const parsed = parseLocalDate(date);
        const active = activeDate === date;
        const sunday = parsed.getDay() === 0;
        const label = date === todayDate ? "오늘" : weekdays[parsed.getDay()];
        const inactiveClass = sunday ? "text-error" : "text-on-surface-variant";
        const count = sessionsByDate[date] || 0;
        return `
          <button class="flex-shrink-0 flex flex-col items-center justify-center w-16 h-16 rounded-sm transition-colors cursor-pointer border border-transparent ${
            active ? "bg-primary text-surface" : `${inactiveClass} hover:bg-primary/5 hover:border-primary/10`
          }" type="button" data-date="${escapeHtml(date)}" aria-pressed="${active}" ${date === todayDate ? 'aria-current="date"' : ""} aria-label="${escapeHtml(`${label} ${parsed.getDate()} ${count}회, ${parsed.getMonth() + 1}월 ${parsed.getDate()}일`)}">
            <span class="text-[10px] font-medium mb-1">${escapeHtml(label)}</span>
            <span class="text-lg font-bold">${parsed.getDate()}</span>
            <span class="text-[10px]">${count.toLocaleString("ko-KR")}회</span>
          </button>
        `;
      })
      .join("");
  }

  function renderViewButtons() {
    document.querySelectorAll("[data-view]").forEach((button) => {
      const active = button.dataset.view === state.view;
      button.setAttribute("aria-pressed", String(active));
      if (button.dataset.toggleStyle === "mobile") {
        button.className = active
          ? "min-w-0 w-full py-2 text-center text-label-caps uppercase bg-surface text-primary border border-outline-variant/20"
          : "min-w-0 w-full py-2 text-center text-label-caps uppercase text-on-surface-variant";
        return;
      }
      button.className = active
        ? "px-6 py-2 text-sm font-bold bg-primary text-surface rounded-sm transition-colors"
        : "px-6 py-2 text-sm text-on-surface-variant hover:text-primary transition-colors rounded-sm";
    });
  }

  function isMobileViewport() {
    return window.matchMedia("(max-width: 767px)").matches;
  }

  function navOffset() {
    return isMobileViewport() ? 88 : 92;
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
      const active = link.dataset.navTarget === activeId;
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
      if (link.dataset.navKind === "desktop") {
        link.className = active
          ? "font-body-md text-sm font-bold text-primary border-b-2 border-primary pb-1 transition-colors"
          : "font-body-md text-sm text-on-surface-variant hover:text-primary border-b-2 border-transparent pb-1 transition-colors";
        return;
      }

      link.className = active
        ? "min-w-0 w-full h-full flex flex-col items-center justify-center gap-1 text-primary"
        : "min-w-0 w-full h-full flex flex-col items-center justify-center gap-1 text-on-surface-variant";
      const label = link.querySelector("span:last-child");
      if (label) label.classList.toggle("font-bold", active);
    });
  }

  function updateNavActive() {
    setNavActive(activeSectionId());
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
    const offset = navOffset() + (isMobileViewport() ? 72 : 0);
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

  function timeChipClass(session, variant = "desktop") {
    const minWidth = activeDateFilter() ? "min-w-20" : "min-w-28";
    const size =
      variant === "mobile"
        ? `flex flex-col items-center justify-center ${minWidth} h-10 px-2 whitespace-nowrap`
        : `flex flex-col items-center justify-center ${minWidth} h-10 px-3 whitespace-nowrap`;
    if (session.bookingType === "booking") return `${size} bg-primary text-surface`;
    return `${size} border border-primary/20 text-primary bg-surface`;
  }

  function isPastTimedItem(item) {
    const time = String(item?.timeSort || item?.time || "").match(/\d{1,2}:\d{2}/)?.[0];
    if (!item?.date || !time) return false;
    const startTime = new Date(`${item.date}T${time}:00+09:00`);
    if (Number.isNaN(startTime.getTime())) return false;
    return startTime.getTime() < Date.now();
  }

  function isPastSession(session) {
    return isPastTimedItem(session);
  }

  function isSoldoutSession(session) {
    if (!session) return false;
    const text = [session.status, session.actionLabel, session.summary, ...(session.tags || [])].filter(Boolean).join(" ");
    return session.status === "soldout" || text.includes("매진") || /sold\s*out/i.test(text);
  }

  function sessionMeta(sessions, venue, mode = state.view) {
    const programs = compactValues(sessions.map((session) => session.program), 2);
    const screens = compactValues(sessions.map((session) => session.screen || "상영관"), 2);
    const dates = activeDateFilter() ? "" : compactValues(sessions.map((session) => shortDate(session.date)), 3);

    if (mode === "film") {
      return [venue?.area || venue?.type || "", programs, screens].filter(Boolean).join(" · ");
    }

    return [programs, screens, dates].filter(Boolean).join(" · ");
  }

  function desktopRow(group, venues) {
    const sessions = group.sessions;
    const first = sessions[0];
    const venue = venues[first.venueId];
    const label = ageLabel(first);
    const title = state.view === "film" ? venue?.name || first.screen || "상영관" : first.title;
    const displayTitle = displayScheduleTitle(title);
    const meta = sessionMeta(sessions, venue);
    const officialUrl = venueOfficialUrl(venue);
    const titleMarkup =
      state.view === "film"
        ? officialUrl
          ? `<a class="block max-w-full truncate text-left text-base font-bold text-primary hover:underline" href="${escapeHtml(officialUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(`${title} 공식 사이트`)}">${escapeHtml(displayTitle)}</a>`
          : `<span class="block max-w-full truncate text-base font-bold text-primary" title="${escapeHtml(title)}">${escapeHtml(displayTitle)}</span>`
        : `<h4 class="block max-w-full truncate text-base font-bold text-primary leading-tight" title="${escapeHtml(title)}">${escapeHtml(displayTitle)}</h4>`;
    return `
      <div class="min-w-0 py-4 border-t border-primary/10 hover:bg-primary/[0.025] transition-colors">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex items-start gap-2">
            <span class="${ageBadgeClass(label, true)} ${ageBadgeTitleOffset(true)}">${escapeHtml(label)}</span>
            <span class="min-w-0">
              ${titleMarkup}
              <span class="block mt-1 text-xs text-on-surface-variant leading-relaxed">${escapeHtml(meta)}</span>
            </span>
          </div>
          <span class="shrink-0 pt-1 text-[10px] font-label-caps text-on-surface-variant uppercase">${sessions.length}타임</span>
        </div>
        <div class="mt-3 min-w-0 flex flex-wrap gap-2">
          ${sessions.map((session) => timeLink(session, `${timeChipClass(session)} font-schedule-time`)).join("")}
        </div>
      </div>
    `;
  }

  function desktopSectionTitle(key, title, meta, cardGroups, sessions) {
    const venues = venueMap();
    const venue = venues[key];
    const infoLineMarkup = state.view === "venue" && venue ? venueInfoHtml(venue) : escapeHtml(meta);
    const officialUrl = venueOfficialUrl(venue);
    const titleContent =
      state.view === "venue"
        ? officialUrl
          ? `<a class="block max-w-full truncate text-left text-2xl font-bold font-display-lg text-primary hover:underline" href="${escapeHtml(officialUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(`${title} 공식 사이트`)}">${escapeHtml(title)}</a>`
          : `<h3 class="block max-w-full truncate text-2xl font-bold font-display-lg text-primary" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>`
        : `<h3 class="block max-w-full truncate text-2xl font-bold font-display-lg text-primary" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>`;
    const favoriteMarkup = state.view === "venue" && venue ? favoriteVenueButton(key, title, "h-9 w-9") : "";

    return `
      <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-2 border-b-2 border-primary pb-3">
        <div class="min-w-0 overflow-hidden">
          <div class="flex min-w-0 items-center gap-3">
            <div class="min-w-0">${titleContent}</div>
            ${favoriteMarkup}
          </div>
          <p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-on-surface-variant leading-relaxed">${infoLineMarkup}</p>
        </div>
        <span class="text-sm text-on-surface-variant">${cardGroups.length}${state.view === "film" ? "곳" : "편"} · ${sessions.length}회차</span>
      </div>
    `;
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

  function agendaMeta(session, venue) {
    const values = splitSessionMetaValues(session).filter((value) => {
      if (isScreenMeta(value, session, venue) || isAgeMeta(value)) return false;
      if (isSoldoutSession(session) && (value.includes("매진") || value.includes("예매할 수 없습니다"))) return false;
      return true;
    });
    const conciseValues = uniqueValues([seatMeta(values), runtimeMeta(values), screeningTypeMeta(values), formatMeta(values)]);
    if (conciseValues.length) return conciseValues.join(" · ");
    return values.join(" · ");
  }

  function agendaRow(session, venues, compact = false) {
    const venue = venues[session.venueId];
    const label = ageLabel(session);
    const meta = agendaMeta(session, venue);
    const screenLabel = session.screen || venue?.area || "상영관";
    const detailMeta = compact ? uniqueValues([screenLabel, meta]).join(" · ") : meta || venue?.name || "";
    const past = isPastSession(session);
    const soldout = isSoldoutSession(session);
    const displayTitle = displayScheduleTitle(session.title || "제목 확인");
    const url = actionUrl(session);
    const interactive = !past && !soldout && url !== "#";
    const statusLabel = soldout ? statusLabels.soldout : past ? "종료" : actionLabel(session);
    const statusClass = past
      ? "border border-outline/40 text-on-surface-variant bg-surface-container-low"
      : soldout
        ? "border border-error/30 text-error bg-surface-container-low"
      : session.bookingType === "booking"
        ? "bg-primary text-surface"
        : "border border-primary/20 text-primary";
    const titleClass = past ? "text-on-surface-variant line-through decoration-1" : soldout ? "text-on-surface-variant" : "text-primary";
    const timeClass = past || soldout ? "text-on-surface-variant" : "text-error";
    const rowClass = compact
      ? "block py-4 border-t border-outline-variant/20"
      : "block border border-primary/10 bg-surface-container-lowest px-4 py-4 transition-colors hover:border-primary/25 hover:bg-surface";

    return `
      <div class="${rowClass}">
        <div class="${compact ? "flex items-start gap-3" : "grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-5 items-start"}">
          <span class="${compact ? "w-16" : ""} shrink-0">
            <strong class="block font-schedule-time text-lg leading-none ${timeClass}">${escapeHtml(cleanTime(session))}</strong>
            ${compact ? "" : `<span class="mt-2 block text-xs text-on-surface-variant">${escapeHtml(screenLabel)}</span>`}
          </span>
          <span class="min-w-0">
            <span class="flex min-w-0 items-start gap-2">
              <span class="${ageBadgeClass(label, compact)} ${ageBadgeTitleOffset(compact)}">${escapeHtml(label)}</span>
              <strong class="block min-w-0 ${compact ? "mobile-row-title" : "text-lg leading-[22px]"} ${titleClass} truncate" title="${escapeHtml(session.title || "")}">${escapeHtml(displayTitle)}</strong>
            </span>
            <span class="${compact ? "mobile-meta mt-1 block break-keep" : "mt-2 block text-sm text-on-surface-variant"}">${escapeHtml(detailMeta)}</span>
          </span>
          <span class="${compact ? "ml-auto flex shrink-0 flex-col gap-2" : "flex shrink-0 flex-col items-stretch gap-2"}">
            ${
              interactive
                ? `<a class="inline-flex justify-center px-3 py-1 text-[10px] font-label-caps ${statusClass}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(statusLabel)}</a>`
                : `<span class="inline-flex justify-center px-3 py-1 text-[10px] font-label-caps ${statusClass}">${escapeHtml(statusLabel)}</span>`
            }
          </span>
        </div>
      </div>
    `;
  }

  function agendaVenueSection(key, sessions, compact = false) {
    const venues = venueMap();
    const venue = venues[key];
    const venueName = venue?.name || key || "상영관";
    const anchorId = venueAnchorId(key, compact ? "mobile" : "desktop");
    const sorted = sortSessions(sessions);
    const officialUrl = venueOfficialUrl(venue);
    const titleClass = compact ? "mobile-card-title" : "text-2xl font-bold font-display-lg";
    const titleContent = officialUrl
      ? `<a class="block max-w-full truncate text-left text-primary hover:underline" href="${escapeHtml(officialUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(`${venueName} 공식 사이트`)}">${escapeHtml(venueName)}</a>`
      : escapeHtml(venueName);
    const titleMarkup = `<h3 class="block max-w-full truncate ${titleClass} text-primary" title="${escapeHtml(venueName)}">${titleContent}</h3>`;
    const favoriteMarkup = venue ? favoriteVenueButton(key, venueName, "h-9 w-9") : "";
    const favorite = isFavoriteVenue(key);
    const shellClass = compact
      ? `border-b border-outline-variant/20 pb-5 scroll-mt-40 ${favorite ? "bg-primary/[0.035] -mx-4 px-4 py-4" : ""}`
      : `scroll-mt-28 ${favorite ? "border border-primary/25 bg-primary/[0.025] p-4" : ""}`;
    const headerClass = compact
      ? "pb-3"
      : "flex flex-col md:flex-row md:items-end md:justify-between gap-2 border-b-2 border-primary pb-3";

    return `
      <div id="${escapeHtml(anchorId)}" class="${shellClass}">
        <div class="${headerClass}">
          <div class="min-w-0 overflow-hidden">
            <div class="flex min-w-0 items-center gap-3">
              <div class="min-w-0">${titleMarkup}</div>
              ${favoriteMarkup}
            </div>
            <p class="${compact ? "mobile-meta mt-2" : "mt-2 text-sm text-on-surface-variant leading-relaxed"} flex flex-wrap items-center gap-x-2 gap-y-1">${venueInfoHtml(venue, "상영일 운영 | 서울", compact)}</p>
          </div>
          <span class="${compact ? "mobile-kicker text-on-surface-variant" : "text-sm text-on-surface-variant"}">${sorted.length}회차</span>
        </div>
        <div class="${compact ? "" : "agenda-grid"}">
          ${sorted.map((session) => agendaRow(session, venues, compact)).join("")}
        </div>
      </div>
    `;
  }

  function renderDesktopTodaySchedule(filtered) {
    const container = $("#desktopSchedule");
    const activeDate = activeDateFilter();
    const groups = groupedSessionEntries(filtered, (session) => session.venueId || "unknown", { sortByFavorites: true });

    if (!groups.length) {
      container.innerHTML = `<div class="p-10 border-y border-primary/10 bg-surface text-center text-on-surface-variant">${escapeHtml(formatDate(activeDate))}에 맞는 상영 회차가 없습니다.</div>`;
      return;
    }

    container.innerHTML = groups.map((group) => agendaVenueSection(group.key, group.sessions)).join("");
  }

  function renderDesktopSchedule(filtered) {
    if (state.view === "today") {
      renderDesktopTodaySchedule(filtered);
      return;
    }

    const venues = venueMap();
    const groups = groupBy(filtered, (session) => (state.view === "film" ? session.title : session.venueId));
    const entries =
      state.view === "venue"
        ? groupedSessionEntries(filtered, (session) => session.venueId || "unknown", { sortByFavorites: true }).map((group) => [
            group.key,
            group.sessions
          ])
        : Object.entries(groups);
    const container = $("#desktopSchedule");

    if (!entries.length) {
      container.innerHTML = `<div class="p-10 border-y border-primary/10 bg-surface text-center text-on-surface-variant">조건에 맞는 상영 회차가 없습니다.</div>`;
      return;
    }

    container.innerHTML = entries
      .map(([key, sessions]) => {
        const first = sessions[0];
        const venue = venues[first.venueId];
        const title = state.view === "film" ? key : venue?.name || key;
        const cardGroups = groupedSessionEntries(
          sessions,
          (session) => (state.view === "film" ? session.venueId || "unknown" : session.title || "제목 확인"),
          { sortByFavorites: state.view === "film" }
        );
        const meta =
          state.view === "film"
            ? compactValues(sessions.map((session) => venues[session.venueId]?.name), 4)
            : venue?.area || venue?.type || "서울";
        const anchorId = state.view === "venue" ? venueAnchorId(key, "desktop") : "";
        return `
          <div ${anchorId ? `id="${escapeHtml(anchorId)}"` : ""} class="scroll-mt-28">
            ${desktopSectionTitle(key, title, meta, cardGroups, sessions)}
            <div class="grid grid-cols-1 xl:grid-cols-2 xl:gap-x-10">
              ${cardGroups.map((group) => desktopRow(group, venues)).join("")}
            </div>
          </div>
        `;
      })
      .join("");
  }

  function mobileTimeChips(sessions) {
    return sessions.map((session) => timeLink(session, `${timeChipClass(session, "mobile")} font-schedule-time`, { withSubLabel: false })).join("");
  }

  function mobileTheaterBlock(venue, sessions) {
    const first = sessions[0];
    const meta = sessionMeta(sessions, venue, "film");
    const venueName = venue?.name || first.screen || "상영관";
    const favorite = isFavoriteVenue(venue?.id);
    const officialUrl = venueOfficialUrl(venue);
    return `
      <div class="py-3 border-t border-outline-variant/20 ${favorite ? "bg-primary/[0.035] -mx-3 px-3" : ""}">
        <div class="flex justify-between items-start gap-3">
          <span class="min-w-0 flex-1">
            <span class="flex min-w-0 items-start gap-2">
              <span class="min-w-0">
                ${
                  officialUrl
                    ? `<a class="mobile-row-title block max-w-full truncate text-left text-primary hover:underline" href="${escapeHtml(officialUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(`${venueName} 공식 사이트`)}">${escapeHtml(venueName)}</a>`
                    : `<span class="mobile-row-title block max-w-full truncate text-primary" title="${escapeHtml(venueName)}">${escapeHtml(venueName)}</span>`
                }
              </span>
            </span>
            <span class="mobile-meta block mt-1">${escapeHtml(meta)}</span>
          </span>
          <span class="mobile-kicker shrink-0 text-on-surface-variant">${sessions.length}타임</span>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          ${mobileTimeChips(sessions)}
        </div>
      </div>
    `;
  }

  function mobileVenueSessionRow(title, sessions) {
    const first = sessions[0];
    const label = ageLabel(first);
    const meta = sessionMeta(sessions, null, "venue");
    const fullTitle = title || first.title;
    const displayTitle = displayScheduleTitle(fullTitle);
    return `
      <div class="py-3 border-t border-outline-variant/20">
        <div class="flex items-start justify-between gap-3">
          <span class="min-w-0">
            <span class="flex items-start gap-2 min-w-0">
              <span class="${ageBadgeClass(label, true)} ${ageBadgeTitleOffset(true)}">${escapeHtml(label)}</span>
              <strong class="mobile-row-title block min-w-0 truncate text-on-surface" title="${escapeHtml(fullTitle)}">${escapeHtml(displayTitle)}</strong>
            </span>
            <span class="mobile-meta block mt-1">${escapeHtml(meta)}</span>
          </span>
          <span class="mobile-kicker shrink-0 text-on-surface-variant">${sessions.length}타임</span>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          ${mobileTimeChips(sessions)}
        </div>
      </div>
    `;
  }

  function mobileMovieEntry(title, sessions, index) {
    const venues = venueMap();
    const first = sessions[0];
    const label = ageLabel(first);
    const venueGroups = groupedSessionEntries(sessions, (session) => session.venueId || "unknown", { sortByFavorites: true });
    const venueNames = compactValues(sessions.map((session) => venues[session.venueId]?.name), 2);
    const displayTitle = displayScheduleTitle(title);
    return `
      <div class="border-b border-outline-variant/20 pb-5">
        <div class="min-w-0">
          <div class="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2">
            <span class="${ageBadgeClass(label, true)} ${ageBadgeTitleOffset(true, "card")}">${escapeHtml(label)}</span>
            <span class="min-w-0">
              <h3 class="mobile-card-title max-w-full truncate text-on-surface" title="${escapeHtml(title)}">${escapeHtml(displayTitle)}</h3>
            </span>
            <span class="mobile-meta col-start-2 block mt-1">${escapeHtml(venueNames || first.program || "상영")}</span>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <span class="mobile-kicker text-on-surface-variant">${escapeHtml(kindLabels[first.kind] || first.kind)}</span>
            <span class="mobile-kicker text-on-surface-variant">${sessions.length}회차</span>
            <span class="mobile-kicker text-on-surface-variant">${venueGroups.length}곳</span>
          </div>
        </div>
        <div class="mt-3">
          ${venueGroups.map((group) => mobileTheaterBlock(venues[group.sessions[0].venueId], group.sessions)).join("")}
        </div>
      </div>
    `;
  }

  function mobileVenueEntry(venue, sessions, index) {
    const movieGroups = groupedSessionEntries(sessions, (session) => session.title || "제목 확인");
    const venueName = venue?.name || "상영관";
    const anchorId = venueAnchorId(venue?.id || sessions[0]?.venueId || index, "mobile");
    const favoriteMarkup = venue ? favoriteVenueButton(venue.id, venueName, "h-9 w-9") : "";
    const favorite = isFavoriteVenue(venue?.id);
    const officialUrl = venueOfficialUrl(venue);
    return `
      <div id="${escapeHtml(anchorId)}" class="border-b border-outline-variant/20 pb-5 scroll-mt-40 ${favorite ? "bg-primary/[0.035] -mx-4 px-4 py-4" : ""}">
        <div class="min-w-0">
          <div class="flex min-w-0 items-center gap-3">
            <div class="min-w-0">
              ${
                officialUrl
                  ? `<a class="mobile-card-title block max-w-full truncate text-left text-primary hover:underline" href="${escapeHtml(officialUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(`${venueName} 공식 사이트`)}">${escapeHtml(venueName)}</a>`
                  : `<h3 class="mobile-card-title block max-w-full truncate text-primary" title="${escapeHtml(venueName)}">${escapeHtml(venueName)}</h3>`
              }
            </div>
            ${favoriteMarkup}
          </div>
          <p class="mobile-meta mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">${venueInfoHtml(venue, "상영일 운영 | 서울", true)}</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <span class="mobile-kicker text-on-surface-variant">${sessions.length}회차</span>
            <span class="mobile-kicker text-on-surface-variant">${movieGroups.length}편</span>
          </div>
        </div>
        <div class="mt-3">
          ${movieGroups.map((group) => mobileVenueSessionRow(group.key, group.sessions)).join("")}
        </div>
      </div>
    `;
  }

  function renderMobileSchedule(filtered) {
    if (state.view === "today") {
      const activeDate = activeDateFilter();
      const groups = groupedSessionEntries(filtered, (session) => session.venueId || "unknown", { sortByFavorites: true });
      $("#mobileSchedule").innerHTML = groups.length
        ? groups.map((group) => agendaVenueSection(group.key, group.sessions, true)).join("")
        : `<div class="p-6 border border-outline-variant/20 bg-surface-container-lowest text-center text-on-surface-variant">${escapeHtml(formatDate(activeDate))}에 맞는 상영 회차가 없습니다.</div>`;
      return;
    }

    const venues = venueMap();
    const grouped =
      state.view === "film"
        ? groupBy(filtered, (session) => session.title)
        : groupBy(filtered, (session) => session.venueId);
    const entries =
      state.view === "venue"
        ? groupedSessionEntries(filtered, (session) => session.venueId || "unknown", { sortByFavorites: true }).map((group) => [
            group.key,
            group.sessions
          ])
        : Object.entries(grouped);

    if (!entries.length) {
      $("#mobileSchedule").innerHTML = `<div class="p-6 border border-outline-variant/20 bg-surface-container-lowest text-center text-on-surface-variant">조건에 맞는 상영 회차가 없습니다.</div>`;
      return;
    }

    $("#mobileSchedule").innerHTML = entries
      .map(([key, sessions], index) => {
        if (state.view === "film") return mobileMovieEntry(key, sessions, index);
        const venue = venues[key];
        return mobileVenueEntry(venue, sessions, index);
      })
      .join("");
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
    renderVenueFilterTiles(activeTarget, shortcutItems, mobileLayout);
  }

  // Desktop and mobile venue tiles share one structure; only sizing/color tokens differ.
  function renderVenueFilterTiles(target, items, compact) {
    if (!target) return;
    target.parentElement?.classList.toggle("hidden", !items.length);
    const tileClass = compact
      ? "group flex h-24 w-32 flex-col items-center justify-between border bg-surface-container-lowest px-2 py-2 text-center text-primary transition-colors active:bg-primary/5"
      : "group flex min-h-28 w-full min-w-0 flex-col items-center justify-between border bg-surface px-3 py-3 text-center text-primary transition-colors hover:border-primary/30 hover:bg-primary/5";
    target.innerHTML = items
      .map((item) => {
        const itemName = item.displayName || item.name;
        const favoriteClass = isFavoriteVenue(item.id)
          ? "border-primary/25 ring-1 ring-primary/35"
          : compact
            ? "border-outline-variant/20"
            : "border-primary/10";
        const markSpan = compact
          ? `<span class="flex h-9 w-full items-center justify-center px-1">${venueMarkHtml(item, true)}</span>`
          : `<span class="flex h-11 w-full items-center justify-center px-1">${venueMarkHtml(item)}</span>`;
        const nameSpan = compact
          ? `<span class="mt-1 flex h-8 w-full items-center justify-center overflow-hidden text-[11px] font-bold leading-4">${escapeHtml(itemName)}</span>`
          : `<span class="mt-2 flex h-9 w-full items-center justify-center overflow-hidden text-sm font-bold leading-[1.2]">${escapeHtml(itemName)}</span>`;
        const countSpan = compact
          ? `<span class="mobile-kicker mt-1 block text-on-surface-variant">${escapeHtml(item.shortCountLabel || item.countLabel)}</span>`
          : `<span class="mt-1 block text-[10px] font-label-caps text-on-surface-variant">${escapeHtml(item.countLabel)}</span>`;
        return `
          <div class="relative ${compact ? "w-32 shrink-0 snap-start" : "min-w-0"}">
            <button class="${tileClass} ${favoriteClass}" type="button" data-venue-jump="${escapeHtml(item.id)}" aria-label="${escapeHtml(`${item.name} ${item.countLabel}`)}">
              ${markSpan}
              ${nameSpan}
              ${countSpan}
            </button>
          </div>
        `;
      })
      .join("");
  }

  function searchResultMeta(sessions) {
    const dates = compactValues(sessions.map((session) => shortDate(session.date)), 4);
    const venueCount = new Set(sessions.map((session) => session.venueId).filter(Boolean)).size;
    return [`${venueCount.toLocaleString("ko-KR")}곳`, `${sessions.length.toLocaleString("ko-KR")}회차`, dates].filter(Boolean).join(" · ");
  }

  function renderSearchVenueTimes(sessions, compact = false) {
    const venues = venueMap();
    const venueGroups = groupedSessionEntries(sessions, (session) => session.venueId || "unknown", { sortByFavorites: true });
    const showDate = new Set(sessions.map((session) => session.date).filter(Boolean)).size > 1;
    const venueChipClass = compact
      ? "inline-flex shrink-0 items-center gap-2 border border-outline-variant/15 bg-surface-container-lowest px-3 py-2"
      : "flex max-w-full min-w-0 items-center gap-2 border border-primary/10 bg-surface-container-lowest px-3 py-2";
    const venueClass = compact
      ? "max-w-[7.2rem] truncate text-[12px] font-bold leading-none text-primary"
      : "max-w-[8.8rem] shrink-0 truncate text-sm font-bold leading-none text-primary";
    const railClass = compact
      ? "flex w-full max-w-full min-w-0 gap-2 overflow-x-auto overscroll-x-contain no-scrollbar pb-1"
      : "flex w-full max-w-full min-w-0 flex-wrap gap-2 pb-1";

    const items = venueGroups
      .map((group) => {
        const first = group.sessions[0];
        const venue = venues[first.venueId];
        const venueName = venue?.name || first.venueName || first.screen || "상영관";
        const chips = group.sessions
          .map((session) => searchTimeLink(session, compact, showDate))
          .join("");
        return `
          <span class="${venueChipClass}">
            <span class="${venueClass}" title="${escapeHtml(venueName)}">${escapeHtml(venueName)}</span>
            <span class="${compact ? "flex shrink-0 items-center gap-1" : "flex min-w-0 flex-wrap items-center gap-1"}">${chips}</span>
          </span>
        `;
      })
      .join("");

    return `<div class="${railClass}">${items}</div>`;
  }

  function searchTimeLink(session, compact = false, showDate = false) {
    const past = isPastSession(session);
    const soldout = isSoldoutSession(session);
    const timeText = showDate ? `${shortDate(session.date)} | ${cleanTime(session)}` : scheduleTimeText(session);
    const url = actionUrl(session);
    const status = soldout ? statusLabels.soldout : past ? "종료" : actionLabel(session);
    const baseClass = compact
      ? "inline-flex h-7 min-w-[3.55rem] items-center justify-center px-2 text-[12px] leading-none"
      : "inline-flex h-8 min-w-16 items-center justify-center px-3 text-sm leading-none";
    const toneClass =
      soldout || past || url === "#"
        ? "border border-primary/20 bg-surface text-on-surface-variant"
        : session.bookingType === "booking"
          ? "bg-primary text-surface"
          : "border border-primary/20 bg-surface text-primary";
    const label = soldout ? `<span class="ml-1 text-[10px] font-label-caps text-error">${escapeHtml(status)}</span>` : "";
    const content = `<span class="font-schedule-time whitespace-nowrap">${escapeHtml(timeText)}</span>${label}`;
    const className = `time-btn ${baseClass} ${toneClass}`;

    if (soldout || past || url === "#") {
      return `<span class="${className}" aria-label="${escapeHtml(`${session.title || "상영"} ${timeText} ${status}`)}" title="${escapeHtml(status)}">${content}</span>`;
    }

    return `<a class="${className}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`${session.title || "상영"} ${timeText} ${status}`)}">${content}</a>`;
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

  function renderSearchResultRow(title, sessions, compact = false) {
    const sorted = sortSessions(sessions);
    const first = sorted[0];
    const label = ageLabel(first);
    const titleClass = compact ? "mobile-row-title" : "text-lg leading-tight";
    const metaClass = compact ? "mobile-meta" : "text-xs text-on-surface-variant";
    return `
      <div class="${compact ? "py-4" : "py-5"} border-t border-primary/10">
        <div class="flex flex-col ${compact ? "gap-3" : "lg:flex-row lg:items-start gap-4"}">
          <div class="min-w-0 ${compact ? "" : "lg:w-[22rem] shrink-0"}">
            <div class="flex items-start gap-2">
              <span class="${ageBadgeClass(label, compact)} ${ageBadgeTitleOffset(compact)}">${escapeHtml(label)}</span>
              <span class="min-w-0">
                <strong class="block ${titleClass} line-clamp-1 text-primary" title="${escapeHtml(title)}">${escapeHtml(title)}</strong>
                <span class="mt-1 block ${metaClass}">${escapeHtml(searchResultMeta(sorted))}</span>
              </span>
            </div>
          </div>
          <div class="min-w-0 ${compact ? "w-full" : "w-full lg:flex-1"}">
            ${renderSearchVenueTimes(sorted, compact)}
          </div>
        </div>
      </div>
    `;
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
    const inactiveContainer = mobileLayout ? desktop : mobile;
    if (inactiveContainer) {
      inactiveContainer.classList.add("hidden");
      inactiveContainer.replaceChildren();
    }

    if (desktop && !mobileLayout) {
      desktop.classList.toggle("hidden", !active);
      desktop.innerHTML = active
        ? `
          <div class="border-y-2 border-primary bg-surface">
            <div class="py-4 flex items-end justify-between gap-4">
              <span>
                <strong class="block text-2xl font-bold text-primary">"${escapeHtml(query)}" 검색 결과</strong>
                <span class="mt-1 block text-sm text-on-surface-variant">${groups.length}편 · ${filtered.length.toLocaleString("ko-KR")}회차</span>
              </span>
            </div>
            <div>
              ${
                groups.length
                  ? groups.map((group) => renderSearchResultRow(group.key, group.sessions)).join("")
                  : `<div class="py-10 border-t border-primary/10 text-center text-on-surface-variant">검색 결과가 없습니다.</div>`
              }
            </div>
          </div>
        `
        : "";
    }

    if (mobile && mobileLayout) {
      mobile.classList.toggle("hidden", !active);
      mobile.innerHTML = active
        ? `
          <div class="border-y border-outline-variant/20">
            <div class="py-3">
              <strong class="block text-base text-primary">"${escapeHtml(query)}" 검색 결과</strong>
              <span class="mt-1 block text-xs text-on-surface-variant">${groups.length}편 · ${filtered.length.toLocaleString("ko-KR")}회차</span>
            </div>
            ${
              groups.length
                ? groups.map((group) => renderSearchResultRow(group.key, group.sessions, true)).join("")
                : `<div class="py-6 border-t border-outline-variant/20 text-sm text-on-surface-variant">검색 결과가 없습니다.</div>`
            }
          </div>
        `
        : "";
    }
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

  function lifecyclePillMarkup(lifecycle, compact = false) {
    if (!lifecycle?.label) return "";
    const toneClass = {
      ending: "border-primary bg-primary text-surface",
      active: "border-status-active/25 bg-status-active/10 text-status-active",
      upcoming: "border-primary/15 bg-primary/5 text-on-surface-variant"
    }[lifecycle.tone] || "border-primary/10 bg-primary/5 text-on-surface-variant";
    return `<span class="festival-lifecycle-pill inline-flex shrink-0 items-center border ${toneClass} ${compact ? "px-2 py-1 text-[10px]" : "px-3 py-1 text-[11px]"} font-bold leading-none">${escapeHtml(lifecycle.label)}</span>`;
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
    return [program.kind, venue?.name].filter(Boolean).join(" | ") || "프로그램";
  }

  function renderPrograms() {
    const venues = venueMap();
    const programs = programCards();
    const mobileLayout = isMobileViewport();
    const desktopTarget = $("#programList");
    const mobileTarget = $("#mobileProgramList");

    if (mobileLayout) {
      desktopTarget?.replaceChildren();
      mobileTarget.innerHTML = programs
        .map((program) => {
          const venue = venues[program.venueId];
          const label = programCardLabel(program, venue);
          const lifecycle = programLifecycle(program);
          const programUrl = safeExternalUrl(program.url, "#");
          return `
            <a class="flex gap-3 p-4 bg-surface-container-lowest border border-outline-variant/10" href="${escapeHtml(programUrl)}" target="_blank" rel="noopener noreferrer">
              ${posterMarkup(program, program.title, "w-24 h-16 object-cover shrink-0", "")}
              <span class="flex flex-col justify-center min-w-0">
                <span class="mb-1 flex items-center gap-2">
                  <span class="min-w-0 text-sm font-bold text-tertiary line-clamp-1">${escapeHtml(label || "프로그램")}</span>
                  ${lifecyclePillMarkup(lifecycle, true)}
                </span>
                <strong class="mobile-row-title line-clamp-2" title="${escapeHtml(cleanProgramTitle(program.title))}">${escapeHtml(cleanProgramTitle(program.title))}</strong>
                ${program.period ? `<span class="mobile-kicker mt-2 inline-flex w-fit bg-primary/5 px-2 py-1 text-primary">${escapeHtml(program.period)}</span>` : ""}
              </span>
            </a>
          `;
        })
        .join("");
      return;
    }

    mobileTarget?.replaceChildren();
    desktopTarget.innerHTML = programs
      .map((program) => {
        const venue = venues[program.venueId];
        const label = programCardLabel(program, venue);
        const lifecycle = programLifecycle(program);
        const programUrl = safeExternalUrl(program.url, "#");
        return `
          <a class="group flex h-full cursor-pointer flex-col rounded-sm border border-primary/10 bg-surface p-4 transition-colors hover:border-primary/30" href="${escapeHtml(programUrl)}" target="_blank" rel="noopener noreferrer">
            <div class="aspect-video bg-surface/10 mb-6 overflow-hidden">
              ${posterMarkup(program, program.title, "w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]", "")}
            </div>
            <div class="mb-3 flex items-center justify-between gap-2">
              <span class="min-w-0 text-base md:text-lg font-bold text-on-surface-variant block line-clamp-1">${escapeHtml(label || "프로그램")}</span>
              ${lifecyclePillMarkup(lifecycle)}
            </div>
            <h3 class="text-xl font-bold leading-snug h-[3.4rem] line-clamp-2 group-hover:text-tertiary transition-colors" title="${escapeHtml(cleanProgramTitle(program.title))}">${escapeHtml(cleanProgramTitle(program.title))}</h3>
            <div class="mt-5 flex flex-wrap items-center gap-2">
              ${program.period ? `<span class="text-base md:text-lg font-bold px-3 py-1 bg-primary/5 text-primary">${escapeHtml(program.period)}</span>` : ""}
              ${program.sessions ? `<span class="text-[10px] font-label-caps px-2 py-1 bg-primary/5 text-primary">${escapeHtml(program.sessions)}회차</span>` : ""}
            </div>
          </a>
        `;
      })
      .join("");
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

  function festivalActionMarkup(row, compact = false) {
    const label = actionLabel(row);
    const url = actionUrl(row);
    const hasUrl = url !== "#";
    const buttonClass = row.bookingType === "booking" ? "bg-primary text-surface" : "festival-action text-primary";
    const sizeClass = compact ? "px-3 py-1 text-[10px]" : "px-3 py-2 text-xs";
    return hasUrl
      ? `<a class="inline-flex ${sizeClass} font-bold transition-colors ${buttonClass}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
      : `<span class="inline-flex ${sizeClass} font-bold border border-outline-variant/40 text-on-surface-variant">확인중</span>`;
  }

  function majorFestivalLogoMarkup(row, compact = false) {
    if (!row?.logoUrl) return "";
    const sizeClass = compact ? "h-7 w-16" : "h-9 w-24";
    const themeClass = row.logoTheme === "dark" ? "festival-logo-dark" : "bg-surface-container-lowest";
    return `
      <span class="festival-logo-box festival-logo-inline ${sizeClass} ${themeClass}">
        <img src="${escapeHtml(row.logoUrl)}" alt="${escapeHtml(row.name)} 로고" loading="lazy" />
      </span>
    `;
  }

  function majorFestivalHighlightsMarkup(row, compact = false) {
    const detailGroups = Array.isArray(row?.highlightGroups) ? row.highlightGroups.filter((group) => group?.label && Array.isArray(group.items) && group.items.length) : [];
    if (detailGroups.length) {
      return `
        <div class="festival-highlight-details mt-3">
          ${detailGroups
            .slice(0, compact ? 6 : 6)
            .map((group) => {
              const groupUrl = safeExternalUrl(group.url, "");
              const labelMarkup = groupUrl
                ? `<a class="festival-highlight-title-link" href="${escapeHtml(groupUrl)}" target="_blank" rel="noopener noreferrer" data-stop-propagation>${escapeHtml(group.label)}</a>`
                : `<span>${escapeHtml(group.label)}</span>`;
              return `
                <details class="festival-highlight-detail">
                  <summary>${labelMarkup}</summary>
                  <div>
                    ${group.items
                      .filter(Boolean)
                      .slice(0, compact ? 4 : 4)
                      .map((item) => `<span>${escapeHtml(item)}</span>`)
                      .join("")}
                  </div>
                </details>
              `;
            })
            .join("")}
        </div>
      `;
    }

    const daily = Array.isArray(row?.dailyHighlights) ? row.dailyHighlights : [];
    const dailyLimit = compact ? 2 : 3;
    if (daily.length) {
      return `
        <div class="festival-highlight-days mt-3">
          ${daily
            .slice(0, dailyLimit)
            .map((day) => {
              const items = Array.isArray(day.items) ? day.items.filter(Boolean).slice(0, compact ? 2 : 3) : [];
              if (!day.date || !items.length) return "";
              return `
                <span class="festival-highlight-day">
                  <strong>${escapeHtml(shortDate(day.date))}</strong>
                  <span>${escapeHtml(items.join(" · "))}</span>
                </span>
              `;
            })
            .join("")}
        </div>
      `;
    }

    const highlights = Array.isArray(row?.programHighlights) ? row.programHighlights.filter(Boolean) : [];
    if (!highlights.length) return "";
    return `
      <div class="festival-highlight-chips mt-3">
        ${highlights
          .slice(0, compact ? 4 : 6)
          .map((item) => `<span>${escapeHtml(item)}</span>`)
          .join("")}
      </div>
    `;
  }

  function festivalScheduleSectionsMarkup(group, venues) {
    const sections = festivalScheduleSections(group);
    if (!sections.length) return "";
    return `
      <div class="festival-highlight-details festival-schedule-details mt-3">
        ${sections
          .map(
            (section) => `
              <details class="festival-highlight-detail festival-schedule-detail">
                <summary>
                  <span class="festival-schedule-section-summary">
                    <strong>${escapeHtml(section.label)}</strong>
                    <small>${escapeHtml(festivalScheduleSectionMeta(section))}</small>
                  </span>
                </summary>
                <div class="festival-schedule-items">
                  ${section.rows
                    .map((row) => {
                      const venueText = festivalVenueLabel(row, venues);
                      const label = actionLabel(row);
                      const url = actionUrl(row);
                      const hasUrl = url !== "#";
                      const dateClass = dateToneClass(row.date, "text-on-surface-variant");
                      const badgeClass = row.bookingType === "booking" ? "bg-primary text-surface" : "border border-primary/20 text-primary";
                      const tagName = hasUrl ? "a" : "span";
                      const attrs = hasUrl
                        ? `href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`${row.title} ${formatDate(row.date)} ${row.time} ${venueText} ${label}`)}"`
                        : "";
                      return `
                        <${tagName} class="festival-schedule-item" ${attrs}>
                          <span class="festival-schedule-when ${dateClass}">
                            <strong>${escapeHtml(formatDate(row.date))}</strong>
                            <small>${escapeHtml(row.time)}</small>
                          </span>
                          <span class="festival-schedule-copy">
                            <strong title="${escapeHtml(row.title)}">${escapeHtml(row.title)}</strong>
                            <small>${escapeHtml(venueText)}</small>
                          </span>
                          <span class="festival-schedule-action ${hasUrl ? badgeClass : "border border-outline-variant/40 text-on-surface-variant"}">${escapeHtml(hasUrl ? label : "확인중")}</span>
                        </${tagName}>
                      `;
                    })
                    .join("")}
                </div>
              </details>
            `
          )
          .join("")}
      </div>
    `;
  }

  function renderFestivals() {
    const venues = venueMap();
    const rows = festivalRows();
    const groups = festivalGroups(rows);
    const desktop = $("#festivalRows");
    const mobile = $("#mobileFestivalList");
    const mobileLayout = isMobileViewport();

    if (mobileLayout) desktop?.replaceChildren();
    else mobile?.replaceChildren();

    if (desktop && !mobileLayout) {
      desktop.innerHTML = groups.length
        ? groups
            .map((group) => {
              const lifecycle = festivalGroupLifecycle(group);
              const summary = festivalGroupSummary(group, venues);
              const major = majorFestivalRow(group);
              if (major) {
                const logoMarkup = majorFestivalLogoMarkup(major);
                const highlightsMarkup = majorFestivalHighlightsMarkup(major);
                return `
                  <tr class="festival-group-row major-festival-row">
                    <td class="px-4 py-5 align-top" colspan="4">
                      <div class="min-w-0">
                        <span class="major-festival-heading flex min-w-0 flex-wrap items-center gap-3 md:gap-4">
                          <strong class="major-festival-title block text-lg text-primary truncate">${escapeHtml(group.name)}</strong>
                          ${logoMarkup}
                          ${lifecyclePillMarkup(lifecycle)}
                        </span>
                        <small class="major-festival-summary mt-1 block text-on-surface-variant">${escapeHtml(summary)}</small>
                        ${highlightsMarkup}
                      </div>
                    </td>
                    <td class="px-4 py-5 align-middle whitespace-nowrap">${festivalActionMarkup(major)}</td>
                  </tr>
                `;
              }
              const sectionsMarkup = festivalScheduleSectionsMarkup(group, venues);
              return `
                <tr class="festival-group-row">
                  <td class="px-4 py-4 align-top" colspan="5">
                    <div class="flex items-start justify-between gap-4">
                      <span class="min-w-0">
                        <span class="flex min-w-0 items-center gap-2">
                          <strong class="festival-group-title block text-base text-primary truncate">${escapeHtml(group.name)}</strong>
                          ${lifecyclePillMarkup(lifecycle)}
                        </span>
                        <small class="festival-group-summary mt-1 block text-on-surface-variant">${escapeHtml(summary)}</small>
                      </span>
                    </div>
                    ${sectionsMarkup}
                  </td>
                </tr>
              `;
            })
            .join("")
        : `<tr><td class="px-4 py-6 text-on-surface-variant" colspan="5">등록된 영화제 시간표가 없습니다.</td></tr>`;
    }

    if (mobile && mobileLayout) {
      mobile.innerHTML = groups.length
        ? groups
            .map((group) => {
              const lifecycle = festivalGroupLifecycle(group);
              const summary = festivalGroupSummary(group, venues);
              const major = majorFestivalRow(group);
              if (major) {
                const logoMarkup = majorFestivalLogoMarkup(major, true);
                const highlightsMarkup = majorFestivalHighlightsMarkup(major, true);
                return `
                  <div class="festival-mobile-card major-festival-mobile-card">
                    <div class="major-festival-panel p-4">
                      <div class="flex items-start justify-between gap-3">
                        <span class="min-w-0">
                          <span class="major-festival-heading flex min-w-0 flex-wrap items-center gap-3">
                            <strong class="major-festival-title block min-w-0 text-base text-primary truncate">${escapeHtml(group.name)}</strong>
                            ${logoMarkup}
                            ${lifecyclePillMarkup(lifecycle, true)}
                          </span>
                          <span class="major-festival-summary mt-1 block text-xs text-on-surface-variant">${escapeHtml(summary)}</span>
                        </span>
                        <span class="shrink-0">${festivalActionMarkup(major, true)}</span>
                      </div>
                      ${highlightsMarkup}
                    </div>
                  </div>
                `;
              }
              const sectionsMarkup = festivalScheduleSectionsMarkup(group, venues);
              return `
              <div class="festival-mobile-card">
                <div class="festival-group-panel p-4">
                  <span class="flex items-center gap-2">
                    <strong class="festival-group-title block min-w-0 text-base text-primary truncate">${escapeHtml(group.name)}</strong>
                    ${lifecyclePillMarkup(lifecycle, true)}
                  </span>
                  <span class="festival-group-summary mt-1 block text-xs text-on-surface-variant">${escapeHtml(summary)}</span>
                  ${sectionsMarkup}
                </div>
              </div>
            `;
            })
            .join("")
        : `<div class="p-5 bg-surface-container-lowest border border-outline-variant/10 text-sm text-on-surface-variant">등록된 영화제 시간표가 없습니다.</div>`;
    }
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

  function trendRankText(item) {
    const rank = Number(item?.rank || 0);
    return rank > 0 ? String(rank).padStart(2, "0") : "";
  }

  function youtubeTrailerSearchUrl(title) {
    const query = encodeURIComponent(`${title || "영화"} 예고편`);
    return `https://www.youtube.com/results?search_query=${query}`;
  }

  function trendTrailerUrl(item) {
    return safeExternalUrl(item?.trailerUrl, "") || youtubeTrailerSearchUrl(item?.title);
  }

  function trendSessionChoices(item, limit = 2) {
    const venues = venueMap();
    const seen = new Set();
    const choices = [];
    for (const session of item.sessions || []) {
      const url = actionUrl(session);
      if (!url || url === "#") continue;
      const venueId = session.venueId || "";
      const venueName = venues[venueId]?.name || session.venueName || session.venue || "상영관";
      const key = venueId || venueName;
      if (seen.has(key)) continue;
      seen.add(key);
      choices.push({
        url,
        venueName,
        timeLabel: `${session.date === kstDateString() ? "오늘" : shortDate(session.date)} ${session.time || ""}`.trim()
      });
      if (choices.length >= limit) break;
    }
    return choices;
  }

  function trendVenueLinksMarkup(item, compact = false) {
    const choices = trendSessionChoices(item, 2);
    if (!choices.length) {
      return `<p class="${compact ? "mobile-meta mt-2" : "mt-3 text-sm text-on-surface-variant"}">${escapeHtml(trendMetaText(item))}</p>`;
    }
    return `
      <div class="${compact ? "mt-3 grid gap-2" : "mt-4 grid gap-2"}">
        ${choices
          .map(
            (choice) =>
              compact
                ? `
              <a class="flex min-w-0 flex-col gap-1 border border-primary/10 px-3 py-2 text-primary active:bg-primary active:text-surface" href="${escapeHref(choice.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`${choice.venueName} ${choice.timeLabel} 예매`)}">
                <span class="truncate text-[12px] font-bold">${escapeHtml(choice.venueName)}</span>
                <span class="text-[10px] font-medium text-on-surface-variant">${escapeHtml(choice.timeLabel)}</span>
              </a>
            `
                : `
              <a class="flex min-w-0 items-center justify-between gap-3 border border-primary/15 px-3 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary hover:text-surface" href="${escapeHref(choice.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`${choice.venueName} ${choice.timeLabel} 예매`)}">
                <span class="min-w-0 truncate">${escapeHtml(choice.venueName)}</span>
                <span class="shrink-0 text-xs font-medium">${escapeHtml(choice.timeLabel)}</span>
              </a>
            `
          )
          .join("")}
      </div>
    `;
  }

  function trendPosterLinkMarkup(item, className, imageClassName, priority = false) {
    const trailerUrl = trendTrailerUrl(item);
    const posterItem = { posterUrl: item.posterUrl, posterSourceUrl: item.posterSourceUrl };
    return `
      <a class="${className}" href="${escapeHref(trailerUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(item.title)} 예고편 보기">
        ${posterMarkup(posterItem, item.title, imageClassName, "", { priority })}
      </a>
    `;
  }

  function trendCardMarkup(item, compact = false, priority = false) {
    if (compact) {
      return `
        <article class="grid w-[calc(100vw-4rem)] max-w-[19rem] shrink-0 snap-start grid-cols-[5.5rem_minmax(0,1fr)] gap-3 border border-outline-variant/20 bg-surface-container-lowest p-4">
          ${trendPosterLinkMarkup(item, "relative block aspect-[2/3] w-full overflow-hidden bg-primary/5", "h-full w-full object-cover", priority)}
          <div class="flex min-w-0 flex-col justify-start">
            <span class="mb-1 text-[19px] font-black leading-none text-primary">${escapeHtml(trendRankText(item))}</span>
            <strong class="mobile-row-title line-clamp-2">${escapeHtml(item.title)}</strong>
            ${trendVenueLinksMarkup(item, true)}
          </div>
        </article>
      `;
    }

    return `
      <article class="group flex min-h-52 flex-col border border-primary/10 bg-surface p-4">
        ${trendPosterLinkMarkup(item, "relative mx-auto mb-5 block aspect-[2/3] w-full max-w-[13rem] overflow-hidden bg-primary/5", "h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]", priority)}
        <span class="mb-2 block text-[22px] font-black leading-none text-primary">${escapeHtml(trendRankText(item))}</span>
        <h3 class="line-clamp-2 text-lg font-bold leading-snug">${escapeHtml(item.title)}</h3>
        ${trendVenueLinksMarkup(item)}
      </article>
    `;
  }

  function renderPopularPicks() {
    const items = communityTrendItems();
    const searchActive = Boolean(state.query.trim());
    const active = state.view === "today" && !searchActive;
    const desktopSection = $("#popular");
    const mobileSection = $("#mobile-popular");
    const desktopList = $("#popularList");
    const mobileList = $("#mobilePopularList");
    const mobileLayout = isMobileViewport();
    const activeSection = mobileLayout ? mobileSection : desktopSection;
    const inactiveSection = mobileLayout ? desktopSection : mobileSection;
    const activeList = mobileLayout ? mobileList : desktopList;
    const inactiveList = mobileLayout ? desktopList : mobileList;

    activeSection?.classList.toggle("hidden", !active || !items.length);
    inactiveSection?.classList.add("hidden");
    inactiveList?.replaceChildren();
    [$("#popularUpdatedAt"), $("#mobilePopularUpdatedAt")].forEach((element) => {
      if (!element) return;
      element.textContent = "";
      element.classList.add("hidden");
    });
    if (activeList) {
      activeList.innerHTML = active && items.length ? items.map((item, index) => trendCardMarkup(item, mobileLayout, index === 0)).join("") : "";
    }
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
    updateMeta();
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
        state.date = selectedDate || null;
        render();
        const replacement = [...document.querySelectorAll("[data-date]")].find(
          (button) => button.dataset.date === selectedDate
        );
        replacement?.focus({ preventScroll: true });
        return;
      }

      const viewButton = event.target.closest("[data-view]");
      if (viewButton) {
        const nextView = viewButton.dataset.view;
        state.view = nextView;
        state.venueFilter = "all";
        render();
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
      <div class="border border-primary/10 bg-surface p-10 text-center text-on-surface-variant" role="alert">
        <strong class="block text-primary">시간표 데이터를 불러오지 못했습니다.</strong>
        <span class="mt-2 block text-sm">인터넷 연결을 확인한 뒤 다시 시도해 주세요.</span>
        <button class="mt-4 inline-flex items-center gap-2 border border-primary bg-primary px-4 py-2 text-sm font-bold text-surface" type="button" data-retry-load>
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
    try {
      state.favoriteVenueIds = loadFavoriteVenueIds();
      const [scheduleData] = await Promise.all([loadData(), loadCommunityTrends()]);
      applyScheduleData(scheduleData, { resetDate: true });
      render();
      hideBootFallback();
    } catch {
      renderError();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
