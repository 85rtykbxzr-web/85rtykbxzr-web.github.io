// Festival planner sheet: browse a festival's screenings by day, heart the ones to see, and
// read the day back as one clean timeline with the walk and the free time between films.
// Picks stay in this browser (localStorage); nothing leaves the device.
import {
  durationLabel,
  fitsBetween,
  formatMinutes,
  hallOf,
  overlapsAny,
  placeOf,
  planDay,
  screeningSpan
} from "./festival-planner.mjs";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const PLACE_FILTERS = [
  ["", "전체"],
  ["bcc", "영화의전당"],
  ["cgv", "CGV"],
  ["lotte", "롯데시네마"],
  ["etc", "그 밖"]
];

const heart = (filled) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="${filled ? "is-filled" : ""}" d="M12 20.3s-7.3-4.4-9.1-9.1C1.6 7.9 3.8 4.6 7.2 4.6c2 0 3.6 1.1 4.8 2.7 1.2-1.6 2.8-2.7 4.8-2.7 3.4 0 5.6 3.3 4.3 6.6-1.8 4.7-9.1 9.1-9.1 9.1Z"/></svg>`;

export function createFestivalPlanner({ $, escapeHtml, showToast, safeExternalUrl, kstDateString }) {
  const state = { data: null, festivalId: "", day: "", mode: "all", place: "", gv: false, query: "", window: null, loading: null };

  const storageKey = () => `fest-plan:v1:${state.festivalId}`;
  function readPicks() {
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey()) || "[]"));
    } catch {
      return new Set();
    }
  }
  function writePicks(picks) {
    try {
      localStorage.setItem(storageKey(), JSON.stringify([...picks]));
    } catch {
      showToast("이 브라우저에선 저장이 안 돼요");
    }
  }

  const films = () => state.data?.films || {};
  const sessionsOn = (date) => (state.data?.sessions || []).filter((session) => session.date === date);
  const pickedOn = (date, picks = readPicks()) => sessionsOn(date).filter((session) => picks.has(session.id));
  const byId = (id) => (state.data?.sessions || []).find((session) => session.id === id);

  function dayLabel(date) {
    const day = new Date(`${date}T00:00:00`);
    return { d: day.getDate(), w: WEEKDAYS[day.getDay()], sun: day.getDay() === 0, sat: day.getDay() === 6 };
  }

  function festivalDays() {
    return [...new Set((state.data?.sessions || []).map((session) => session.date))].sort();
  }

  function sessionMeta(session) {
    const place = placeOf(session.venue);
    const hall = hallOf(session.venue, place);
    const film = films()[session.filmId];
    return [hall ? `${place.name} ${hall}` : session.venue, film?.section].filter(Boolean).join(" · ");
  }

  function badges(session) {
    return [
      session.gv ? '<span class="fp-badge is-gv">GV</span>' : "",
      session.bundle ? '<span class="fp-badge">묶음</span>' : "",
      session.kind === "event" ? '<span class="fp-badge">행사</span>' : ""
    ].join("");
  }

  function timeRange(session) {
    const span = screeningSpan(session, films());
    return `${session.time}<small>~${formatMinutes(span.end)}${span.runtimeKnown ? "" : "?"}</small>`;
  }

  function renderDays(picks) {
    const today = kstDateString();
    $("#fpDays").innerHTML = festivalDays()
      .map((date) => {
        const label = dayLabel(date);
        const count = pickedOn(date, picks).length;
        const cls = ["date", date === state.day ? "is-on" : "", label.sun ? "is-sun" : ""].filter(Boolean).join(" ");
        return `<button class="${cls}" type="button" data-fp-day="${date}" aria-pressed="${date === state.day}"><span class="wd">${date === today ? "오늘" : label.w}</span><span class="d">${label.d}</span>${count ? `<span class="fp-dot" aria-label="${count}편 담음">${count}</span>` : ""}</button>`;
      })
      .join("");
  }

  function renderModes(picks) {
    const total = (state.data?.sessions || []).filter((session) => picks.has(session.id)).length;
    $("#fpModes").innerHTML = [
      ["all", "전체 상영"],
      ["mine", `내 시간표${total ? ` ${total}` : ""}`]
    ]
      .map(([mode, label]) => `<button type="button" class="${mode === state.mode ? "is-on" : ""}" data-fp-mode="${mode}" aria-pressed="${mode === state.mode}">${label}</button>`)
      .join("");
  }

  function filteredSessions(picks) {
    const query = state.query.trim().toLowerCase();
    let list = sessionsOn(state.day);
    if (state.place) list = list.filter((session) => (state.place === "etc" ? !["bcc", "cgv", "lotte"].includes(placeOf(session.venue).id) : placeOf(session.venue).id === state.place));
    if (state.gv) list = list.filter((session) => session.gv);
    if (query) list = list.filter((session) => `${session.title} ${session.titleEn} ${films()[session.filmId]?.section || ""}`.toLowerCase().includes(query));
    if (state.window) {
      const { prev, next } = state.window;
      list = list.filter((session) => !picks.has(session.id) && fitsBetween(session, byId(prev), byId(next), films()));
    }
    return list;
  }

  function renderAll(picks) {
    const picked = pickedOn(state.day, picks);
    const list = filteredSessions(picks);
    const windowBar = state.window
      ? `<div class="fp-window"><span>${escapeHtml(state.window.label)} 사이에 볼 수 있는 상영 ${list.length}편</span><button type="button" data-fp-window-clear>해제</button></div>`
      : "";
    const filters = `
      <div class="fp-filters">
        <label class="fp-search"><input type="search" id="fpQuery" placeholder="작품, 섹션 검색" value="${escapeHtml(state.query)}" autocomplete="off" /></label>
        <div class="fp-chips">
          ${PLACE_FILTERS.map(([id, label]) => `<button type="button" class="fp-chip${state.place === id ? " is-on" : ""}" data-fp-place="${id}">${label}</button>`).join("")}
          <button type="button" class="fp-chip${state.gv ? " is-on" : ""}" data-fp-gv>GV</button>
        </div>
      </div>`;
    const rows = list.length
      ? list
          .map((session) => {
            const on = picks.has(session.id);
            const clash = !on && overlapsAny(session, picked, films());
            return `
              <div class="fp-row${on ? " is-picked" : ""}">
                <span class="fp-time">${timeRange(session)}</span>
                <a class="fp-what" href="${escapeHtml(safeExternalUrl(session.url, "#"))}" target="_blank" rel="noopener noreferrer">
                  <span class="fp-title">${escapeHtml(session.title)}${badges(session)}</span>
                  <span class="fp-meta">${clash ? '<em class="fp-clash">겹침</em>' : ""}<span class="fp-meta-text">${escapeHtml(sessionMeta(session))}</span></span>
                </a>
                <button type="button" class="fp-heart${on ? " is-on" : ""}" data-fp-pick="${escapeHtml(session.id)}" aria-pressed="${on}" aria-label="${escapeHtml(`${session.title} ${on ? "빼기" : "담기"}`)}">${heart(on)}</button>
              </div>`;
          })
          .join("")
      : `<p class="fp-empty">조건에 맞는 상영이 없어요</p>`;
    return windowBar + filters + `<div class="fp-list">${rows}</div>`;
  }

  function gapMarkup(gap, previous, next) {
    const walk = gap.walk;
    const route = walk.same
      ? ""
      : `<a class="fp-route" href="${escapeHtml(safeExternalUrl(`https://map.kakao.com/?sName=${encodeURIComponent(walk.from.map)}&eName=${encodeURIComponent(walk.to.map)}`, "#"))}" target="_blank" rel="noopener noreferrer">길찾기</a>`;
    const walkText = walk.same ? (walk.minutes ? `같은 건물 도보 ${walk.minutes}분` : "같은 관") : `${walk.from.short} → ${walk.to.short} 도보 ${walk.minutes}분`;
    let headline = "";
    let tone = "";
    if (gap.status === "overlap") {
      tone = "is-bad";
      headline = `${durationLabel(-gap.free)} 겹쳐요`;
    } else if (gap.status === "tight") {
      tone = "is-warn";
      headline = gap.free <= walk.minutes ? "이동 시간이 부족해요" : `빠듯해요 · 여유 ${gap.free}분`;
    } else if (gap.status === "free") {
      headline = `빈 시간 ${durationLabel(gap.free - gap.need)}`;
    } else {
      headline = `여유 ${gap.free}분`;
    }
    const fill = gap.status === "free"
      ? `<button type="button" class="fp-fill" data-fp-window="${escapeHtml(previous.id)}|${escapeHtml(next.id)}" data-fp-window-label="${formatMinutes(gap.from)}~${next.time}">이 시간에 볼 영화 찾기</button>`
      : "";
    const others = gap.status === "overlap"
      ? `<button type="button" class="fp-fill" data-fp-others="${escapeHtml(next.id)}">‘${escapeHtml(next.title)}’ 다른 회차</button>`
      : "";
    const gvNote = gap.gvConflict ? `<span class="fp-gv-note">GV까지 보면 빠듯해요</span>` : "";
    return `
      <li class="fp-gap ${tone}">
        <p class="fp-gap-line"><span><b>${escapeHtml(headline)}</b>${escapeHtml(walkText)}</span>${route}</p>
        ${gvNote}${fill}${others}
      </li>`;
  }

  // Lanes for screenings that overlap on one day, so they sit side by side like a class
  // timetable instead of on top of each other.
  function layoutLanes(items) {
    const sorted = [...items].sort((a, b) => a.span.start - b.span.start);
    const groups = [];
    for (const item of sorted) {
      const group = groups.at(-1);
      if (group && item.span.start < group.end) {
        group.items.push(item);
        group.end = Math.max(group.end, item.span.end);
      } else groups.push({ items: [item], end: item.span.end });
    }
    for (const group of groups) {
      const laneEnds = [];
      for (const item of group.items) {
        let lane = laneEnds.findIndex((end) => end <= item.span.start);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = item.span.end;
        item.lane = lane;
      }
      for (const item of group.items) item.lanes = laneEnds.length;
    }
    return sorted;
  }

  function gridMarkup(picks) {
    const picked = (state.data?.sessions || []).filter((session) => picks.has(session.id));
    // Every day from the first pick to the last, at least four columns, so the grid reads as
    // a week rather than a lone column.
    const allDays = festivalDays().filter((date) => sessionsOn(date).length > 5);
    const pickedDays = [...new Set(picked.map((session) => session.date))].sort();
    let from = Math.max(0, allDays.indexOf(pickedDays[0]));
    let to = Math.max(from, allDays.indexOf(pickedDays.at(-1)));
    while (to - from < 3 && (to < allDays.length - 1 || from > 0)) {
      if (to < allDays.length - 1) to += 1;
      else from -= 1;
    }
    const days = allDays.slice(from, to + 1);
    const byDay = days.map((date) => {
      const plan = planDay(picked.filter((session) => session.date === date), films());
      return { date, items: layoutLanes(plan) };
    });
    const spans = byDay.flatMap((day) => day.items.map((item) => item.span));
    const startHour = Math.floor(Math.min(...spans.map((span) => span.start)) / 60);
    const endHour = Math.min(26, Math.ceil(Math.max(...spans.map((span) => span.end)) / 60));
    const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
    const head = byDay
      .map(({ date }) => {
        const label = dayLabel(date);
        return `<button type="button" class="tt-day${date === state.day ? " is-on" : ""}${label.sun ? " is-sun" : ""}" data-fp-day="${date}" aria-pressed="${date === state.day}"><span>${label.w}</span><b>${label.d}</b></button>`;
      })
      .join("");
    const cols = byDay
      .map(({ date, items }) => {
        const blocks = items
          .map((item) => {
            const session = item.session;
            const place = placeOf(session.venue);
            const hall = hallOf(session.venue, place);
            return `<button type="button" class="tt-block" data-fp-focus="${escapeHtml(session.id)}" data-tt-top="${item.span.start - startHour * 60}" data-tt-height="${item.span.end - item.span.start}" data-tt-lane="${item.lane}" data-tt-lanes="${item.lanes}"${item.lanes > 1 ? " data-tt-narrow" : ""} aria-label="${escapeHtml(`${session.time} ${session.title} ${place.short}`)}"><time>${session.time}</time><b>${escapeHtml(session.title)}</b><span>${escapeHtml(place.id === "bcc" && hall ? hall : `${place.short}${hall ? ` ${hall}` : ""}`)}</span></button>`;
          })
          .join("");
        // the walk between two screenings, drawn in the gap: a dotted path and how much time is left
        const gaps = items
          .filter((item) => item.gap && item.gap.status !== "overlap" && item.lanes === 1)
          .map((item) => {
            const gap = item.gap;
            const label = gap.status === "free" ? `빈 ${durationLabel(gap.free - gap.need)}` : gap.status === "tight" ? `빠듯 ${gap.free}분` : `여유 ${gap.free}분`;
            return `<span class="tt-gap${gap.status === "tight" ? " is-warn" : ""}" data-tt-top="${gap.from - startHour * 60}" data-tt-height="${gap.free}" aria-hidden="true"><i>${escapeHtml(label)}</i></span>`;
          })
          .join("");
        return `<div class="tt-col${date === state.day ? " is-on" : ""}">${gaps}${blocks}</div>`;
      })
      .join("");
    const lines = hours.map((hour) => `<span class="tt-hour"><i>${hour > 23 ? hour - 24 : hour}</i></span>`).join("");
    return `
      <div class="tt-wrap">
        <div class="fpt v-ink" data-tt-hours="${hours.length}" data-tt-days="${days.length}">
          <div class="tt-head"><span class="tt-corner"></span>${head}</div>
          <div class="tt-body"><div class="tt-grid">${lines}</div><div class="tt-cols">${cols}</div></div>
        </div>
      </div>`;
  }

  function dayDetailMarkup(picks) {
    const plan = planDay(pickedOn(state.day, picks), films());
    const label = dayLabel(state.day);
    const heading = `${Number(state.day.slice(5, 7))}월 ${label.d}일 ${label.w}요일`;
    if (!plan.length) return `<h3 class="fp-detail-h">${heading}</h3><p class="fp-empty">이 날은 담은 영화가 없어요. 위 표에서 날짜를 눌러 보세요</p>`;
    const first = plan[0].span.start;
    const last = plan.at(-1).span.end;
    const summary = `<small>${plan.length}편 · ${formatMinutes(first)}–${formatMinutes(last)}${plan.some((item) => item.gap?.status === "overlap") ? ' · <em>겹침 있음</em>' : ""}</small>`;
    const body = plan
      .map((item, index) => {
        const session = item.session;
        const place = placeOf(session.venue);
        const hall = hallOf(session.venue, place);
        const card = `
          <li class="fp-it" id="fp-card-${escapeHtml(session.id)}">
            <p class="fp-it-time"><strong>${session.time}</strong><span>${formatMinutes(item.span.end)}${item.span.runtimeKnown ? "" : "?"}까지</span></p>
            <div class="fp-it-main">
              <p class="fp-it-title"><span>${escapeHtml(session.title)}</span>${badges(session)}</p>
              <p class="fp-it-place">${escapeHtml(place.name)}${hall ? ` <b>${escapeHtml(hall)}</b>` : ""}</p>
            </div>
            <div class="fp-it-side">
              <button type="button" class="fp-code" data-fp-copy="${escapeHtml(session.code)}" aria-label="예매코드 ${escapeHtml(session.code)} 복사">${escapeHtml(session.code)}</button>
              <button type="button" class="fp-remove" data-fp-pick="${escapeHtml(session.id)}" aria-label="${escapeHtml(session.title)} 빼기">빼기</button>
            </div>
          </li>`;
        return (item.gap ? gapMarkup(item.gap, plan[index - 1].session, session) : "") + card;
      })
      .join("");
    return `<h3 class="fp-detail-h">${heading}${summary}</h3><ol class="fp-itin">${body}</ol>`;
  }

  function renderMine(picks) {
    const anyPick = (state.data?.sessions || []).some((session) => picks.has(session.id));
    if (!anyPick) {
      return `<div class="fp-empty is-big"><p>보고 싶은 상영에 ♡를 눌러 담아 보세요</p><p class="sub">담은 영화가 시간표로 모이고, 사이사이 이동 시간과 빈 시간을 알려 드려요</p><button type="button" class="fp-fill" data-fp-mode="all">상영 둘러보기</button></div>`;
    }
    const ticket = state.data.ticketUrl ? `<a class="fp-ticket" href="${escapeHtml(safeExternalUrl(state.data.ticketUrl, "#"))}" target="_blank" rel="noopener noreferrer">공식 예매하러 가기</a>` : "";
    return gridMarkup(picks) + dayDetailMarkup(picks) + `<p class="fp-note">도보 시간은 지도 기준 추정이에요. 입장 여유 5분을 더해 계산해요.</p>` + ticket;
  }

  // Block positions come from data attributes: the page's CSP forbids inline style attributes,
  // but setting styles from script is fine.
  function placeBlocks() {
    const grid = $("#fpBody .fpt");
    if (!grid) return;
    const hourHeight = 52;
    grid.querySelector(".tt-body").style.height = `${Number(grid.dataset.ttHours) * hourHeight}px`;
    grid.querySelectorAll(".tt-block").forEach((block) => {
      const lanes = Number(block.dataset.ttLanes) || 1;
      const lane = Number(block.dataset.ttLane) || 0;
      // flush with the hour lines and column rules, a 1px gutter so neighbours stay apart
      block.style.top = `${(Number(block.dataset.ttTop) / 60) * hourHeight + 1}px`;
      block.style.height = `${Math.max(22, (Number(block.dataset.ttHeight) / 60) * hourHeight - 1)}px`;
      block.style.left = `calc(${(lane / lanes) * 100}% + 1px)`;
      block.style.width = `calc(${100 / lanes}% - 1px)`;
      // as many title lines as the block's height holds, under the place line when it shows
      const room = parseFloat(block.style.height) - 10 - 13 - (lanes > 1 ? 0 : 13);
      block.style.setProperty("--tt-lines", String(Math.max(1, Math.floor(room / 14))));
    });
    grid.querySelectorAll(".tt-gap").forEach((gap) => {
      const height = (Number(gap.dataset.ttHeight) / 60) * hourHeight;
      gap.style.top = `${(Number(gap.dataset.ttTop) / 60) * hourHeight + 1}px`;
      gap.style.height = `${height - 1}px`;
      gap.classList.toggle("is-short", height < 18);
    });
    const days = Number(grid.dataset.ttDays) || 1;
    grid.style.setProperty("--tt-days", String(days));
  }

  function render() {
    const picks = readPicks();
    renderDays(picks);
    renderModes(picks);
    const body = $("#fpBody");
    const scroll = body.scrollTop;
    body.innerHTML = state.mode === "mine" ? renderMine(picks) : renderAll(picks);
    $("#fpDays").hidden = state.mode === "mine";
    placeBlocks();
    body.scrollTop = scroll;
  }

  async function load(festivalId) {
    state.loading ||= fetch("data/festival-biff.json", { cache: "no-cache" }).then((response) => (response.ok ? response.json() : null)).catch(() => null);
    const data = await state.loading;
    if (!data || data.festivalId !== festivalId) {
      state.loading = null;
      return null;
    }
    return data;
  }

  async function open(festivalId) {
    const sheet = $("#festPlanner");
    if (!sheet) return;
    const data = await load(festivalId);
    if (!data) {
      showToast("상영시간표를 아직 불러오지 못했어요");
      return;
    }
    state.data = data;
    state.festivalId = festivalId;
    const days = festivalDays();
    const today = kstDateString();
    if (!days.includes(state.day)) state.day = days.includes(today) ? today : days.find((date) => sessionsOn(date).length > 5) || days[0];
    $("#fpTitle").textContent = data.name;
    render();
    if (typeof sheet.showModal === "function") sheet.showModal();
    else sheet.setAttribute("open", "");
    sheet.focus({ preventScroll: true });
  }

  function togglePick(id) {
    const picks = readPicks();
    const session = byId(id);
    if (picks.has(id)) picks.delete(id);
    else {
      picks.add(id);
      const clash = session && overlapsAny(session, pickedOn(session.date, picks).filter((other) => other.id !== id), films());
      showToast(clash ? "담았어요 · 다른 영화와 시간이 겹쳐요" : "내 시간표에 담았어요");
    }
    writePicks(picks);
    render();
  }

  function handleClick(event) {
    const sheet = $("#festPlanner");
    if (!sheet?.contains(event.target)) return false;
    const target = event.target;
    if (target === sheet || target.closest("[data-fp-close]")) {
      sheet.close?.();
      return true;
    }
    const day = target.closest("[data-fp-day]");
    if (day) {
      state.day = day.dataset.fpDay;
      state.window = null;
      if (state.mode !== "mine") $("#fpBody").scrollTop = 0;
      render();
      return true;
    }
    const mode = target.closest("[data-fp-mode]");
    if (mode) {
      state.mode = mode.dataset.fpMode;
      state.window = null;
      $("#fpBody").scrollTop = 0;
      render();
      return true;
    }
    const focus = target.closest("[data-fp-focus]");
    if (focus) {
      const session = byId(focus.dataset.fpFocus);
      if (session) {
        state.day = session.date;
        render();
        $(`#fp-card-${CSS.escape(session.id)}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return true;
    }
    const pick = target.closest("[data-fp-pick]");
    if (pick) {
      event.preventDefault();
      togglePick(pick.dataset.fpPick);
      return true;
    }
    const place = target.closest("[data-fp-place]");
    if (place) {
      state.place = place.dataset.fpPlace;
      render();
      return true;
    }
    if (target.closest("[data-fp-gv]")) {
      state.gv = !state.gv;
      render();
      return true;
    }
    const fill = target.closest("[data-fp-window]");
    if (fill) {
      const [prev, next] = fill.dataset.fpWindow.split("|");
      state.window = { prev, next, label: fill.dataset.fpWindowLabel };
      state.mode = "all";
      state.place = "";
      state.gv = false;
      state.query = "";
      $("#fpBody").scrollTop = 0;
      render();
      return true;
    }
    if (target.closest("[data-fp-window-clear]")) {
      state.window = null;
      render();
      return true;
    }
    const others = target.closest("[data-fp-others]");
    if (others) {
      const session = byId(others.dataset.fpOthers);
      state.mode = "all";
      state.window = null;
      state.place = "";
      state.gv = false;
      state.query = session?.title || "";
      const days = (state.data.sessions || []).filter((item) => item.filmId && item.filmId === session?.filmId && item.id !== session.id).map((item) => item.date);
      if (days.length && !days.includes(state.day)) state.day = days[0];
      $("#fpBody").scrollTop = 0;
      render();
      showToast(days.length ? `다른 회차 ${days.length}개가 있어요` : "다른 회차가 없어요");
      return true;
    }
    const copy = target.closest("[data-fp-copy]");
    if (copy) {
      const code = copy.dataset.fpCopy;
      navigator.clipboard?.writeText(code).then(() => showToast(`예매코드 ${code} 복사했어요`), () => showToast(`예매코드 ${code}`));
      return true;
    }
    return false;
  }

  function handleInput(event) {
    if (event.target.id !== "fpQuery") return;
    state.query = event.target.value;
    const caret = event.target.selectionStart;
    render();
    const input = $("#fpQuery");
    input?.focus();
    input?.setSelectionRange(caret, caret);
  }

  return { open, handleClick, handleInput };
}
