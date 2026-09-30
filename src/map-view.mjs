import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./map-view.css";
import { venueCoordinates } from "./map-coordinates.mjs";

const CLUSTER_RADIUS_PX = 52;
const TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const RANGES = [
  { id: "today", label: "오늘" },
  { id: "tomorrow", label: "내일" },
  { id: "week", label: "일주일" }
];
const GV_PATTERN = /GV|관객과의\s*대화|씨네토크|시네토크|인디토크|토크|무대인사/i;

let active = null;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function addDays(dateString, days) {
  const [y, m, d] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function formatDistance(km) {
  return km < 1 ? `${Math.round(km * 10) * 100}m` : `${km.toFixed(km < 10 ? 1 : 0)}km`;
}

function isGv(session) {
  return (
    session.kind === "talk" ||
    GV_PATTERN.test(`${session.title || ""} ${session.program || ""} ${(session.tags || []).join(" ")}`)
  );
}

function shortDate(dateString) {
  return `${dateString.slice(5, 7)}.${dateString.slice(8, 10)}`;
}

export function openMap(ctx) {
  if (active) return active;
  const opener = document.activeElement;

  const state = {
    range: "today",
    bookable: false,
    gv: false,
    favorites: false,
    selected: null,
    user: null,
    locating: false
  };

  const venues = ctx.venues
    .filter((venue) => venueCoordinates[venue.id])
    .map((venue) => ({ ...venue, coords: venueCoordinates[venue.id] }));

  const root = document.createElement("div");
  root.className = "scm-root";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "영화관 지도");
  root.innerHTML = `
    <div class="scm-head">
      <h2 class="scm-title">지도</h2>
      <div class="scm-chips" id="scmChips" role="group" aria-label="지도 필터"></div>
      <button type="button" class="scm-close" id="scmClose" aria-label="지도 닫기">닫기</button>
    </div>
    <div class="scm-body">
      <aside class="scm-panel" id="scmPanel" aria-live="polite"></aside>
      <div class="scm-stage">
        <div class="scm-canvas" id="scmCanvas"></div>
        <p class="scm-note" id="scmNote" hidden>지도 타일을 불러오지 못했어요. 목록과 예매 링크는 그대로 쓸 수 있어요.</p>
      </div>
    </div>`;
  document.body.appendChild(root);
  document.documentElement.classList.add("scm-lock");

  const $ = (selector) => root.querySelector(selector);
  const map = L.map($("#scmCanvas"), {
    zoomControl: false,
    attributionControl: true,
    minZoom: 9,
    maxZoom: 18,
    zoomSnap: 0.5,
    worldCopyJump: false
  });
  map.attributionControl.setPrefix(false);
  L.control.zoom({ position: "bottomright", zoomInTitle: "확대", zoomOutTitle: "축소" }).addTo(map);
  const tiles = L.tileLayer(TILE_URL, {
    subdomains: "abcd",
    maxZoom: 19,
    attribution: "© OpenStreetMap · © CARTO"
  }).addTo(map);
  let tileErrors = 0;
  tiles.on("tileerror", () => {
    tileErrors += 1;
    if (tileErrors >= 4) $("#scmNote").hidden = false;
  });
  tiles.on("tileload", () => {
    tileErrors = 0;
    $("#scmNote").hidden = true;
  });
  const pinLayer = L.layerGroup().addTo(map);
  let userMarker = null;

  // ---- data ---------------------------------------------------------------
  function visibleSessions() {
    const today = ctx.today();
    const from = state.range === "tomorrow" ? addDays(today, 1) : today;
    const to = state.range === "today" ? today : state.range === "tomorrow" ? from : addDays(today, 6);
    return ctx.sessions().filter((session) => {
      if (!session.date || session.date < from || session.date > to) return false;
      if (ctx.isPast(session)) return false;
      if (state.bookable && ctx.isSoldout(session)) return false;
      if (state.gv && !isGv(session)) return false;
      return true;
    });
  }

  function aggregate() {
    const sessions = visibleSessions();
    const byVenue = new Map();
    sessions.forEach((session) => {
      if (!byVenue.has(session.venueId)) byVenue.set(session.venueId, []);
      byVenue.get(session.venueId).push(session);
    });
    return venues
      .filter((venue) => !state.favorites || ctx.isFavorite(venue.id))
      .map((venue) => {
        const list = (byVenue.get(venue.id) || []).sort((a, b) =>
          `${a.date} ${a.timeSort || a.time || ""}`.localeCompare(`${b.date} ${b.timeSort || b.time || ""}`)
        );
        const films = new Set(list.map((session) => session.title));
        return {
          venue,
          sessions: list,
          filmCount: films.size,
          distance: state.user ? distanceKm(state.user, venue.coords) : null
        };
      });
  }

  // ---- markers ------------------------------------------------------------
  function pinHtml(entry, selected) {
    const { venue } = entry;
    const classes = ["scm-pin"];
    if (!entry.filmCount) classes.push("is-empty");
    if (ctx.isFavorite(venue.id)) classes.push("is-fav");
    if (selected) classes.push("is-selected");
    const badge = entry.filmCount ? `<span class="scm-pin-badge">${entry.filmCount}편</span>` : "";
    return `<div class="${classes.join(" ")}">
      <span class="scm-pin-logo"><b>${esc((venue.name || "?").slice(0, 1))}</b></span>
      <span class="scm-pin-name">${esc(venue.name)}</span>${badge}
    </div>`;
  }

  function clusterEntries(entries) {
    const clusters = [];
    entries.forEach((entry) => {
      const point = map.latLngToContainerPoint(entry.venue.coords);
      const hit = clusters.find((cluster) => cluster.point.distanceTo(point) < CLUSTER_RADIUS_PX);
      if (hit && entry.venue.id !== state.selected) hit.members.push(entry);
      else clusters.push({ point, members: [entry] });
    });
    return clusters;
  }

  function drawPins() {
    pinLayer.clearLayers();
    const entries = aggregate();
    // keep the selected venue out of clusters so it never disappears under one
    clusterEntries(entries).forEach((cluster) => {
      if (cluster.members.length === 1) {
        const entry = cluster.members[0];
        const marker = L.marker(entry.venue.coords, {
          icon: L.divIcon({
            className: "scm-pin-host",
            html: pinHtml(entry, entry.venue.id === state.selected),
            iconSize: [0, 0]
          }),
          title: `${entry.venue.name} · ${entry.filmCount}편`,
          alt: entry.venue.name,
          keyboard: true,
          zIndexOffset: entry.venue.id === state.selected ? 1000 : entry.filmCount
        });
        marker.on("click", () => select(entry.venue.id, { fly: true }));
        pinLayer.addLayer(marker);
        return;
      }
      const lat = cluster.members.reduce((sum, m) => sum + m.venue.coords[0], 0) / cluster.members.length;
      const lng = cluster.members.reduce((sum, m) => sum + m.venue.coords[1], 0) / cluster.members.length;
      const films = cluster.members.reduce((sum, m) => sum + m.filmCount, 0);
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: "scm-pin-host",
          html: `<div class="scm-cluster"><b>${cluster.members.length}관</b><span>${films}편</span></div>`,
          iconSize: [0, 0]
        }),
        title: `영화관 ${cluster.members.length}곳 · 확대해서 보기`,
        keyboard: true
      });
      marker.on("click", () => {
        map.fitBounds(L.latLngBounds(cluster.members.map((m) => m.venue.coords)), {
          padding: [80, 80],
          maxZoom: 16
        });
      });
      pinLayer.addLayer(marker);
    });
  }

  // ---- panel --------------------------------------------------------------
  function renderChips() {
    const rangeButtons = RANGES.map(
      (range) =>
        `<button type="button" class="scm-chip${state.range === range.id ? " is-on" : ""}" data-range="${range.id}" aria-pressed="${state.range === range.id}">${range.label}</button>`
    ).join("");
    const toggle = (key, label) =>
      `<button type="button" class="scm-chip${state[key] ? " is-on" : ""}" data-toggle="${key}" aria-pressed="${state[key]}">${label}</button>`;
    $("#scmChips").innerHTML = `${rangeButtons}<span class="scm-chip-gap" aria-hidden="true"></span>${toggle("bookable", "예매 가능")}${toggle("gv", "GV·토크")}${toggle("favorites", "즐겨찾기")}
      <button type="button" class="scm-chip scm-locate${state.user ? " is-on" : ""}" data-locate ${state.locating ? "disabled" : ""}>${state.locating ? "찾는 중…" : state.user ? "내 위치 ✓" : "내 위치"}</button>`;
  }

  function listHtml(entries) {
    const sorted = [...entries].sort((a, b) => {
      if (a.distance != null && b.distance != null) return a.distance - b.distance;
      return Number(!ctx.isFavorite(a.venue.id)) - Number(!ctx.isFavorite(b.venue.id)) || b.filmCount - a.filmCount;
    });
    const rows = sorted
      .map((entry) => {
        const next = entry.sessions[0];
        const logo = ctx.markSrc(entry.venue.id);
        return `<li><button type="button" class="scm-row${entry.filmCount ? "" : " is-empty"}" data-venue="${esc(entry.venue.id)}">
          <span class="scm-row-logo">${logo ? `<img src="${esc(logo)}" alt="" width="36" height="36" loading="lazy" decoding="async" />` : ""}</span>
          <span class="scm-row-main">
            <strong>${esc(entry.venue.name)}</strong>
            <small>${esc(entry.venue.area || "")}${entry.distance != null ? ` · ${formatDistance(entry.distance)}` : ""}${next ? ` · 다음 ${esc(next.date === ctx.today() ? "" : shortDate(next.date) + " ")}${esc(next.time || "")}` : ""}</small>
          </span>
          <span class="scm-row-count">${entry.filmCount ? `<b>${entry.filmCount}</b>편` : "없음"}</span>
        </button></li>`;
      })
      .join("");
    const totalFilms = new Set(entries.flatMap((entry) => entry.sessions.map((s) => s.title))).size;
    return `<div class="scm-panel-head"><h3>영화관 ${entries.length}곳</h3><p>${totalFilms}편 상영${state.user ? " · 가까운 순" : ""}</p></div>
      ${!state.user ? `<p class="scm-hint">‘내 위치’를 누르면 가까운 영화관 순으로 정렬돼요. 위치는 이 기기 안에서만 쓰고 저장하거나 전송하지 않아요.</p>` : ""}
      <ul class="scm-list">${rows || `<li class="scm-empty">조건에 맞는 영화관이 없어요.</li>`}</ul>`;
  }

  function detailHtml(entry) {
    const { venue } = entry;
    const byTitle = new Map();
    entry.sessions.forEach((session) => {
      if (!byTitle.has(session.title)) byTitle.set(session.title, []);
      byTitle.get(session.title).push(session);
    });
    const films = [...byTitle.entries()]
      .map(([title, list]) => {
        const poster = ctx.safeImage(list.find((s) => s.posterUrl)?.posterUrl);
        const times = list
          .map((session) => {
            const label = `${session.date === ctx.today() ? "" : shortDate(session.date) + " "}${session.time || "시간 확인"}`;
            const url = ctx.actionUrl(session);
            if (ctx.isSoldout(session))
              return `<span class="time-btn time-soldout"><span class="font-schedule-time text-sm leading-none whitespace-nowrap">${esc(label)}</span><span class="time-soldout-label whitespace-nowrap">매진</span></span>`;
            if (url === "#")
              return `<span class="time-btn time-ended"><span class="font-schedule-time text-sm leading-none whitespace-nowrap">${esc(label)}</span></span>`;
            return `<a class="time-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(`${title} ${label} ${ctx.actionLabel(session)}`)}"><span class="font-schedule-time text-sm leading-none whitespace-nowrap">${esc(label)}</span></a>`;
          })
          .join("");
        return `<li class="scm-film">
          <span class="scm-poster">${poster ? `<img src="${esc(poster)}" alt="" width="48" height="68" loading="lazy" decoding="async" />` : ""}</span>
          <div class="scm-film-main"><strong>${esc(title)}</strong><div class="scm-times">${times}</div></div>
        </li>`;
      })
      .join("");
    return `<div class="scm-detail">
      <button type="button" class="scm-back" data-back>← 목록</button>
      <div class="scm-detail-head">
        <h3>${esc(venue.name)}</h3>
        <p>${esc(ctx.closedDay(venue))} · <a href="${esc(ctx.naverUrl(venue))}" target="_blank" rel="noopener noreferrer">${esc(ctx.address(venue))}</a></p>
        ${entry.distance != null ? `<p class="scm-dist">내 위치에서 약 ${formatDistance(entry.distance)}</p>` : ""}
        <div class="scm-actions">
          <a class="scm-btn" href="${esc(ctx.naverUrl(venue))}" target="_blank" rel="noopener noreferrer">네이버 지도</a>
          ${venue.url ? `<a class="scm-btn" href="${esc(venue.url)}" target="_blank" rel="noopener noreferrer">공식 사이트</a>` : ""}
          <button type="button" class="scm-btn" data-fav="${esc(venue.id)}" aria-pressed="${ctx.isFavorite(venue.id)}">${ctx.isFavorite(venue.id) ? "★ 즐겨찾기" : "☆ 즐겨찾기"}</button>
          <button type="button" class="scm-btn is-primary" data-jump="${esc(venue.id)}">전체 시간표</button>
        </div>
      </div>
      <ul class="scm-films">${films || `<li class="scm-empty">이 조건에는 상영이 없어요. 기간을 넓혀 보세요.</li>`}</ul>
    </div>`;
  }

  function renderPanel() {
    const entries = aggregate();
    const selected = entries.find((entry) => entry.venue.id === state.selected);
    const panel = $("#scmPanel");
    panel.classList.toggle("has-detail", Boolean(selected));
    panel.innerHTML = selected ? detailHtml(selected) : listHtml(entries);
    if (selected) panel.scrollTop = 0;
  }

  function refresh() {
    renderChips();
    renderPanel();
    drawPins();
  }

  function select(id, { fly = false } = {}) {
    state.selected = id;
    refresh();
    map.invalidateSize();
    const venue = venues.find((item) => item.id === id);
    if (venue && fly) {
      const compact = window.matchMedia("(max-width: 767px)").matches;
      // shift the target so the pin sits in the visible part of the map, not under the sheet
      const size = map.getSize();
      const zoom = Math.max(map.getZoom(), 15);
      const offset = compact ? [0, size.y * 0.2] : [0, 0];
      const target = map.project(venue.coords, zoom).add(offset);
      map.flyTo(map.unproject(target, zoom), zoom, { duration: 0.6 });
    }
  }

  function clearSelection() {
    state.selected = null;
    refresh();
    map.invalidateSize();
  }

  function locate() {
    if (!navigator.geolocation || state.locating) {
      ctx.toast(navigator.geolocation ? "" : "이 브라우저는 위치 기능을 지원하지 않아요.");
      return;
    }
    state.locating = true;
    renderChips();
    navigator.geolocation.getCurrentPosition(
      (position) => {
        state.locating = false;
        state.user = [position.coords.latitude, position.coords.longitude];
        if (userMarker) userMarker.remove();
        userMarker = L.marker(state.user, {
          icon: L.divIcon({ className: "scm-pin-host", html: `<div class="scm-me"></div>`, iconSize: [0, 0] }),
          interactive: false,
          keyboard: false
        }).addTo(map);
        const nearest = aggregate()
          .filter((entry) => entry.distance != null)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 3);
        map.fitBounds(L.latLngBounds([state.user, ...nearest.map((entry) => entry.venue.coords)]), {
          padding: [70, 70],
          maxZoom: 15
        });
        refresh();
      },
      () => {
        state.locating = false;
        renderChips();
        ctx.toast("위치를 가져오지 못했어요. 브라우저의 위치 권한을 확인해 주세요.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  // ---- events -------------------------------------------------------------
  function close() {
    document.removeEventListener("keydown", onKey, true);
    map.remove();
    root.remove();
    document.documentElement.classList.remove("scm-lock");
    active = null;
    ctx.onClose();
    if (opener && document.contains(opener)) opener.focus?.({ preventScroll: true });
  }

  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (state.selected) clearSelection();
      else close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...root.querySelectorAll("a[href], button:not([disabled]), [tabindex='0']")].filter(
      (el) => el.offsetParent !== null
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("#scmClose")) return close();
    const range = target.closest("[data-range]");
    if (range) {
      state.range = range.dataset.range;
      return refresh();
    }
    const toggle = target.closest("[data-toggle]");
    if (toggle) {
      state[toggle.dataset.toggle] = !state[toggle.dataset.toggle];
      return refresh();
    }
    if (target.closest("[data-locate]")) return locate();
    const row = target.closest("[data-venue]");
    if (row) return select(row.dataset.venue, { fly: true });
    if (target.closest("[data-back]")) return clearSelection();
    const fav = target.closest("[data-fav]");
    if (fav) {
      ctx.toggleFavorite(fav.dataset.fav);
      return refresh();
    }
    const jump = target.closest("[data-jump]");
    if (jump) {
      const id = jump.dataset.jump;
      close();
      ctx.jumpToVenue(id);
    }
  });
  document.addEventListener("keydown", onKey, true);

  // ---- start --------------------------------------------------------------
  const seoul = venues.filter((venue) => venue.coords[0] < 37.75 && venue.coords[1] > 126.85);
  map.fitBounds(L.latLngBounds((seoul.length ? seoul : venues).map((venue) => venue.coords)), { padding: [60, 60] });
  map.on("moveend zoomend", drawPins);
  refresh();
  $("#scmClose").focus({ preventScroll: true });

  active = { close, select, map, root };
  return active;
}

export function closeMap() {
  active?.close();
}
