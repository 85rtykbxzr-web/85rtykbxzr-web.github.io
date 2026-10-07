// The 취향 추천 sheet: upload a ratings CSV, pick streaming services, get picks. All work
// happens in the browser; see taste-engine.mjs for the logic.
import { createTmdb, ottServices, readRatings, ratingStats, runTaste } from "./taste-engine.mjs";

const posterBase = "https://image.tmdb.org/t/p/";
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage full or blocked: the sheet still works for this visit
    }
  }
};
const keys = { otts: "taste-otts:v1", csv: "taste-csv:v1", options: "taste-options:v1" };
const pageSize = 12;
const sorts = [
  ["score", "추천순"],
  ["rating", "평점순"],
  ["year", "최신순"],
  ["runtime", "짧은순"]
];

// 을/를 after a title, read the way it would be said
function objectParticle(word) {
  const last = String(word).trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (code >= 0 && code <= 11171) return code % 28 ? "을" : "를";
  if (/\d/.test(last)) return "013678".includes(last) ? "을" : "를";
  if (/[a-z]/i.test(last)) return /[aeiouy]/i.test(last) ? "를" : "을";
  return "을";
}

export function createTastePicks({ $, escapeHtml, showToast, onTheater }) {
  const options = store.get(keys.options, {});
  const state = {
    step: "start",
    selected: store.get(keys.otts, ["netflix", "watcha"]),
    includeRent: Boolean(options.includeRent),
    hiddenGems: Boolean(options.hiddenGems),
    csv: store.get(keys.csv, null),
    items: null,
    result: null,
    error: "",
    filter: "all",
    sort: "score",
    shown: pageSize,
    line: "",
    posters: [],
    progress: 0,
    get: null,
    runId: 0,
    bound: false
  };

  const sheet = () => $("#tasteSheet");
  const body = () => $("#tpBody");
  const apiKey = () => document.querySelector('meta[name="tmdb-key"]')?.content || "";
  const count = (value) => value.toLocaleString("ko-KR");

  // ---------- pieces ----------

  function checks() {
    const check = (name, label) => `<button type="button" class="tp-check${state[name] ? " is-on" : ""}" data-tp-toggle="${name}" aria-pressed="${state[name]}"><span aria-hidden="true"></span>${label}</button>`;
    return `<div class="tp-checks">${check("includeRent", "대여·구매도 포함")}${check("hiddenGems", "덜 알려진 영화 위주")}</div>`;
  }

  function ottPicker() {
    return ottServices.map((service) => {
      const on = state.selected.includes(service.id);
      return `<button type="button" class="tp-ott${on ? " is-on" : ""}" data-tp-ott="${service.id}" aria-pressed="${on}"><i class="tp-dot is-${service.id}" aria-hidden="true"></i>${escapeHtml(service.name)}</button>`;
    }).join("");
  }

  // ---------- start ----------

  function renderStart() {
    const saved = state.csv;
    return `
      <section class="tp-intro">
        <h3>내 별점으로 고르는<br />OTT 영화</h3>
        <p>왓챠피디아나 레터박스드에서 받은 평가 기록을 올리면, 좋아한 영화들과 결이 닮았으면서 지금 내 OTT에서 볼 수 있는 영화를 골라요.</p>
      </section>
      <section class="tp-field">
        <div class="tp-label"><h4>쓰는 OTT</h4><span>${state.selected.length ? `${state.selected.length}개` : "고르지 않으면 OTT 상관없이"}</span></div>
        <div class="tp-otts" role="group" aria-label="OTT 선택">${ottPicker()}</div>
        ${checks()}
      </section>
      <section class="tp-field">
        <div class="tp-label"><h4>평가 기록 CSV</h4></div>
        ${saved ? `<button type="button" class="tp-reuse" data-tp-reuse><span>지난번 파일로 보기</span><small>${escapeHtml(saved.name)} · ${count(saved.count)}편</small><svg class="ui-icon" aria-hidden="true"><use href="/assets/lucide-sprite.svg#arrow-right"></use></svg></button>` : ""}
        <label class="tp-drop${saved ? " is-again" : ""}" data-tp-drop>
          <input type="file" accept=".csv,.tsv,.txt,text/csv" data-tp-file />
          <span class="tp-drop-btn">${saved ? "다른 파일 고르기" : "파일 고르기"}</span>
          <span class="tp-drop-hint">또는 여기로 끌어다 놓기</span>
        </label>
        <details class="tp-how">
          <summary>CSV는 어디서 받나요?</summary>
          <div>
            <p><b>왓챠피디아</b>는 공식 내보내기가 없어서 PC 크롬에서 공개 도구로 받아요.</p>
            <ol>
              <li>크롬에 Tampermonkey 확장 프로그램 설치</li>
              <li><a href="https://github.com/pottq577/watchapedia-export" target="_blank" rel="noopener noreferrer">WatchaPedia Ratings Exporter</a> 스크립트 설치</li>
              <li>왓챠피디아 로그인 → 내 평가 페이지에서 내보내기 → CSV 저장</li>
            </ol>
            <p><b>레터박스드</b>는 Settings → Import &amp; Export → Export Your Data로 받은 압축 파일 안의 <code>ratings.csv</code>를 올리면 돼요.</p>
          </div>
        </details>
      </section>
      <p class="tp-note">파일은 이 브라우저 안에서만 읽고 어디에도 올리지 않아요. 작품 정보만 TMDB에서 찾아와요.</p>`;
  }

  // ---------- loading ----------

  function posterTile(poster) {
    return `<img src="${posterBase}w92${escapeHtml(poster.path)}" alt="" decoding="async" referrerpolicy="no-referrer"${poster.liked ? "" : ' class="is-low"'} />`;
  }

  function renderLoading() {
    const stats = state.items ? ratingStats(state.items) : null;
    return `
      <section class="tp-loading" aria-live="polite">
        <div class="tp-progress" aria-hidden="true"><i data-tp-progress></i></div>
        <h3>추천을 고르는 중</h3>
        ${stats ? `<p class="tp-loading-sub">별점 ${count(stats.rated)}개 · 평균 ${stats.avg.toFixed(1)}점</p>` : ""}
        <p class="tp-loading-line" data-tp-line>${escapeHtml(state.line)}</p>
        <div class="tp-wall" data-tp-wall>${state.posters.map(posterTile).join("")}</div>
      </section>`;
  }

  // ---------- result ----------

  function reasonText(rec) {
    if (!rec.leads?.length) return "";
    const titles = rec.leads.map((lead) => `‘${lead.title}’`);
    return `${titles.join(", ")}${objectParticle(rec.leads.at(-1).title)} 좋아했다면`;
  }

  function serviceList(where) {
    return (where?.services || []).map((service) => `<span><i class="tp-dot is-${service.id}" aria-hidden="true"></i>${escapeHtml(service.name)}${service.mode === "대여" ? "<small>대여</small>" : ""}</span>`).join("");
  }

  function recRow(rec, index) {
    const link = rec.where?.link || `https://www.themoviedb.org/movie/${rec.id}/watch?locale=KR`;
    const poster = rec.poster
      ? `<img src="${posterBase}w185${escapeHtml(rec.poster)}" alt="" loading="${index < 4 ? "eager" : "lazy"}" decoding="async" referrerpolicy="no-referrer" />`
      : `<span>${escapeHtml(rec.title)}</span>`;
    const facts = [rec.year, rec.countries?.[0], rec.runtime ? `${rec.runtime}분` : "", rec.director].filter(Boolean).map((fact) => escapeHtml(String(fact))).join("<i>·</i>");
    const reason = reasonText(rec);
    return `
      <li class="tp-rec">
        <a class="tp-rec-poster" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">${poster}</a>
        <div class="tp-rec-body">
          <h4>${escapeHtml(rec.title)}</h4>
          ${rec.originalTitle ? `<p class="tp-rec-orig">${escapeHtml(rec.originalTitle)}</p>` : ""}
          <p class="tp-rec-facts">${facts}</p>
          ${reason || rec.favouriteDirector ? `<p class="tp-rec-why">${escapeHtml(reason)}${rec.favouriteDirector ? `<span>좋아하는 감독 ${escapeHtml(rec.favouriteDirector)}</span>` : ""}</p>` : ""}
          ${rec.overview ? `<p class="tp-rec-plot">${escapeHtml(rec.overview)}</p>` : ""}
          <div class="tp-rec-where">
            <span class="tp-services">${serviceList(rec.where)}</span>
            <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">보는 곳<svg class="ui-icon" aria-hidden="true"><use href="/assets/lucide-sprite.svg#arrow-right"></use></svg></a>
          </div>
        </div>
      </li>`;
  }

  function theaterRow(rec) {
    const why = rec.favouriteDirector ? `좋아하는 감독 ${rec.favouriteDirector}` : reasonText(rec);
    return `
      <li>
        <button type="button" class="tp-theater" data-tp-theater="${escapeHtml(rec.title)}">
          ${rec.poster ? `<img src="${posterBase}w154${escapeHtml(rec.poster)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />` : "<span></span>"}
          <span class="tp-theater-t">
            <b>${escapeHtml(rec.title)}</b>
            <small>${escapeHtml([rec.year, rec.director].filter(Boolean).join(" · "))}</small>
            ${why ? `<em>${escapeHtml(why)}</em>` : ""}
          </span>
          <span class="tp-theater-go">시간표<svg class="ui-icon" aria-hidden="true"><use href="/assets/lucide-sprite.svg#arrow-right"></use></svg></span>
        </button>
      </li>`;
  }

  function sorted(list) {
    const by = {
      rating: (a, b) => (b.voteAverage || 0) - (a.voteAverage || 0),
      year: (a, b) => (b.year || 0) - (a.year || 0),
      runtime: (a, b) => (a.runtime || 999) - (b.runtime || 999)
    }[state.sort];
    return by ? [...list].sort(by) : list;
  }

  function renderResult() {
    const { recs, theater } = state.result;
    const has = (rec, id) => rec.where?.services.some((service) => service.id === id);
    const filtered = sorted(state.filter === "all" ? recs : recs.filter((rec) => has(rec, state.filter)));
    const visible = filtered.slice(0, state.shown);
    const chosen = ottServices.filter((service) => state.selected.includes(service.id));
    const tabs = [["all", "전체", recs.length], ...chosen.map((service) => [service.id, service.name, recs.filter((rec) => has(rec, service.id)).length])]
      .filter(([id, , total]) => id === "all" || total)
      .map(([id, name, total]) => `<button type="button" class="tp-tab${state.filter === id ? " is-on" : ""}" data-tp-filter="${id}" aria-pressed="${state.filter === id}">${escapeHtml(name)}<small>${total}</small></button>`)
      .join("");
    const sortOptions = sorts.map(([id, name]) => `<option value="${id}"${state.sort === id ? " selected" : ""}>${name}</option>`).join("");
    const where = chosen.length ? chosen.map((service) => service.name).join(" · ") : "모든 OTT";
    const stats = state.items ? ratingStats(state.items) : null;
    return `
      <section class="tp-top">
        <p class="tp-top-k">${escapeHtml(where)}${stats ? ` · 별점 ${count(stats.rated)}개 기준` : ""}</p>
        <div class="tp-top-row">
          <h3>지금 볼 수 있는 ${recs.length}편</h3>
          <button type="button" class="tp-link" data-tp-restart>조건 바꾸기</button>
        </div>
        ${checks()}
        ${theater.length ? `<button type="button" class="tp-jump" data-tp-jump>서울 극장에서 하는 추천작도 ${theater.length}편 있어요</button>` : ""}
      </section>
      <div class="tp-bar">
        <div class="tp-tabs" role="group" aria-label="OTT별 보기">${tabs}</div>
        <label class="tp-sort"><span class="sr-only">정렬</span><select data-tp-sort>${sortOptions}</select></label>
      </div>
      ${visible.length
        ? `<ol class="tp-recs">${visible.map(recRow).join("")}</ol>`
        : `<p class="tp-empty">고른 OTT에서 찾은 영화가 없어요. OTT를 더 고르거나 대여·구매를 포함해 보세요.</p>`}
      ${filtered.length > state.shown ? `<button type="button" class="tp-more" data-tp-more>${Math.min(pageSize, filtered.length - state.shown)}편 더 보기</button>` : ""}
      ${theater.length ? `
        <section class="tp-theaters" id="tpTheaters">
          <h4>극장에서 지금</h4>
          <p>서울 독립·예술영화관에서 상영 중인 영화 중에 골랐어요.</p>
          <ul>${theater.map(theaterRow).join("")}</ul>
        </section>` : ""}
      <p class="tp-credit">작품 정보 TMDB, OTT 정보 JustWatch. 쿠팡플레이·라프텔은 데이터가 없어 고를 수 없어요.</p>`;
  }

  function renderError() {
    return `
      <section class="tp-error">
        <h3>추천을 만들지 못했어요</h3>
        <p>${escapeHtml(state.error)}</p>
        <button type="button" class="tp-primary" data-tp-restart>처음으로</button>
      </section>`;
  }

  function setProgress(target) {
    // through the CSSOM: the page's CSP has no inline style attributes
    const bar = target?.querySelector("[data-tp-progress]");
    if (bar) bar.style.transform = `scaleX(${Math.max(0.02, Math.min(1, state.progress)).toFixed(3)})`;
  }

  function render() {
    const target = body();
    if (!target) return;
    target.innerHTML = state.step === "loading" ? renderLoading() : state.step === "result" ? renderResult() : state.step === "error" ? renderError() : renderStart();
    setProgress(target);
    sheet()?.setAttribute("data-step", state.step);
  }

  function updateLoading(poster) {
    if (state.step !== "loading") return;
    const target = body();
    setProgress(target);
    const line = target?.querySelector("[data-tp-line]");
    if (line && line.textContent !== state.line) line.textContent = state.line;
    if (poster) target?.querySelector("[data-tp-wall]")?.insertAdjacentHTML("beforeend", posterTile(poster));
  }

  // ---------- running ----------

  async function theaterIds() {
    try {
      const response = await fetch("data/ticket-posters.json", { cache: "no-cache" });
      if (!response.ok) return [];
      const data = await response.json();
      return Object.values(data.films || {}).map((film) => film.tmdbId).filter(Boolean);
    } catch {
      return [];
    }
  }

  function fail(message) {
    state.step = "error";
    state.error = message;
    render();
  }

  async function run() {
    if (!state.csv) return;
    const key = apiKey();
    if (!key) {
      fail("작품 정보 연결이 아직 준비되지 않았어요. 잠시 뒤 다시 시도해 주세요.");
      return;
    }
    const runId = ++state.runId;
    try {
      state.items = readRatings(state.csv.text).items;
    } catch (error) {
      fail(error.message);
      return;
    }
    const avg = ratingStats(state.items).avg;
    state.step = "loading";
    state.line = "별점 기록을 읽는 중";
    state.posters = [];
    state.progress = 0.04;
    render();
    state.get ||= createTmdb({ apiKey: key, fetchImpl: (url, init) => fetch(url, init) });
    try {
      const result = await runTaste({
        items: state.items,
        selected: state.selected,
        includeRent: state.includeRent,
        hiddenGems: state.hiddenGems,
        get: state.get,
        theaterIds: await theaterIds(),
        onStep(step) {
          if (runId !== state.runId) return;
          const share = step.done / Math.max(1, step.total);
          let poster = null;
          if (step.phase === "match") {
            state.progress = 0.04 + 0.26 * share;
            state.line = `좋아한 영화와 별로였던 영화 ${step.total}편을 찾는 중`;
          } else if (step.phase === "read") {
            state.progress = 0.3 + 0.25 * share;
            state.line = `‘${step.title}’ 살펴보는 중`;
            if (step.poster && state.posters.length < 60) {
              poster = { path: step.poster, liked: step.rating >= avg };
              state.posters.push(poster);
            }
          } else if (step.phase === "gather") {
            state.progress = 0.56;
            state.line = "내 OTT에 있는 후보를 모으는 중";
          } else if (step.phase === "score") {
            state.progress = 0.58 + 0.4 * share;
            state.line = `후보 ${step.total}편을 견주는 중`;
          }
          updateLoading(poster);
        }
      });
      if (runId !== state.runId) return;
      state.result = result;
      state.step = "result";
      state.filter = "all";
      state.shown = pageSize;
      render();
      body()?.scrollTo({ top: 0 });
    } catch (error) {
      if (runId !== state.runId) return;
      fail(error.message || "추천을 만들지 못했어요.");
    }
  }

  async function takeFile(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      showToast("파일이 너무 커요 (8MB까지)");
      return;
    }
    const text = await file.text();
    let total = 0;
    try {
      total = readRatings(text).items.length;
    } catch (error) {
      fail(error.message);
      return;
    }
    if (!total) {
      showToast("CSV에서 작품을 찾지 못했어요");
      return;
    }
    state.csv = { name: file.name, count: total, text };
    store.set(keys.csv, state.csv);
    run();
  }

  // ---------- events ----------

  // re-render in place, keeping the reader where they were in the list
  function rerender(change = () => {}) {
    const scroll = body()?.scrollTop || 0;
    change();
    render();
    body()?.scrollTo({ top: scroll });
  }

  function bind() {
    const root = sheet();
    if (!root || state.bound) return;
    state.bound = true;
    root.addEventListener("click", (event) => {
      const target = event.target;
      if (target === root || target.closest("[data-tp-close]")) { root.close?.(); return; }
      const ott = target.closest("[data-tp-ott]");
      if (ott) {
        const id = ott.dataset.tpOtt;
        rerender(() => {
          state.selected = state.selected.includes(id) ? state.selected.filter((value) => value !== id) : [...state.selected, id];
          store.set(keys.otts, state.selected);
        });
        return;
      }
      const toggle = target.closest("[data-tp-toggle]");
      if (toggle) {
        const name = toggle.dataset.tpToggle;
        state[name] = !state[name];
        store.set(keys.options, { includeRent: state.includeRent, hiddenGems: state.hiddenGems });
        if (state.step === "result") run();
        else rerender();
        return;
      }
      if (target.closest("[data-tp-reuse]")) { run(); return; }
      if (target.closest("[data-tp-restart]")) { state.runId += 1; state.step = "start"; render(); body()?.scrollTo({ top: 0 }); return; }
      if (target.closest("[data-tp-jump]")) { body()?.querySelector("#tpTheaters")?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      const filter = target.closest("[data-tp-filter]");
      if (filter) { rerender(() => { state.filter = filter.dataset.tpFilter; state.shown = pageSize; }); return; }
      if (target.closest("[data-tp-more]")) { rerender(() => { state.shown += pageSize; }); return; }
      const theater = target.closest("[data-tp-theater]");
      if (theater) { root.close?.(); onTheater?.(theater.dataset.tpTheater); }
    });
    root.addEventListener("change", (event) => {
      const sort = event.target.closest?.("[data-tp-sort]");
      if (sort) { rerender(() => { state.sort = sort.value; state.shown = pageSize; }); return; }
      const input = event.target.closest?.("[data-tp-file]");
      if (input?.files?.[0]) takeFile(input.files[0]);
    });
    root.addEventListener("dragover", (event) => {
      if (state.step !== "start") return;
      event.preventDefault();
      root.querySelector("[data-tp-drop]")?.classList.add("is-over");
    });
    root.addEventListener("dragleave", () => root.querySelector("[data-tp-drop]")?.classList.remove("is-over"));
    root.addEventListener("drop", (event) => {
      if (state.step !== "start") return;
      event.preventDefault();
      takeFile(event.dataTransfer?.files?.[0]);
    });
  }

  function open() {
    const root = sheet();
    if (!root) return;
    bind();
    render();
    if (typeof root.showModal === "function") { if (!root.open) root.showModal(); }
    else root.setAttribute("open", "");
    root.focus({ preventScroll: true });
  }

  return { open };
}
