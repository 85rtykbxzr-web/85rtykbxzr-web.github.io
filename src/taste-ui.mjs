// The 취향 추천 sheet: upload a ratings CSV, pick streaming services, read the report and the
// picks. All work happens in the browser; see taste-engine.mjs for the logic.
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
    shown: 12,
    log: [],
    progress: 0,
    get: null,
    runId: 0,
    bound: false
  };

  const sheet = () => $("#tasteSheet");
  const body = () => $("#tpBody");
  const apiKey = () => document.querySelector('meta[name="tmdb-key"]')?.content || "";

  // ---------- rendering ----------

  function ottChips() {
    return ottServices.map((service) => {
      const on = state.selected.includes(service.id);
      return `<button type="button" class="tp-ott is-${service.id}${on ? " is-on" : ""}" data-tp-ott="${service.id}" aria-pressed="${on}"><i aria-hidden="true">${escapeHtml(service.short)}</i>${escapeHtml(service.name)}</button>`;
    }).join("");
  }

  function toggles() {
    return `
      <div class="tp-toggles">
        <button type="button" class="tp-switch${state.includeRent ? " is-on" : ""}" data-tp-toggle="includeRent" aria-pressed="${state.includeRent}"><span aria-hidden="true"></span>대여·구매도 포함</button>
        <button type="button" class="tp-switch${state.hiddenGems ? " is-on" : ""}" data-tp-toggle="hiddenGems" aria-pressed="${state.hiddenGems}"><span aria-hidden="true"></span>덜 알려진 영화 위주</button>
      </div>`;
  }

  function renderStart() {
    const saved = state.csv;
    return `
      <section class="tp-intro">
        <p class="tp-kicker">왓챠피디아 · 레터박스드 별점 기록으로</p>
        <h3>내 별점이 고른<br />오늘 밤 영화</h3>
        <p>평가 기록 CSV를 올리면 취향을 읽어서, <b>내가 쓰는 OTT에서 지금 볼 수 있는 영화</b>만 골라드려요.</p>
      </section>
      <section class="tp-step">
        <h4><span>1</span>쓰는 OTT</h4>
        <div class="tp-otts" role="group" aria-label="OTT 선택">${ottChips()}</div>
        ${toggles()}
      </section>
      <section class="tp-step">
        <h4><span>2</span>별점 기록 CSV</h4>
        <label class="tp-drop" data-tp-drop>
          <input type="file" accept=".csv,.tsv,.txt,text/csv" data-tp-file />
          <svg class="ui-icon" aria-hidden="true"><use href="/assets/lucide-sprite.svg#film"></use></svg>
          <strong>CSV 파일 올리기</strong>
          <span>눌러서 고르거나 여기로 끌어다 놓기</span>
        </label>
        ${saved ? `<button type="button" class="tp-reuse" data-tp-reuse>지난번 파일로 바로 보기 <small>${escapeHtml(saved.name)} · ${saved.count.toLocaleString("ko-KR")}편</small></button>` : ""}
        <details class="tp-how">
          <summary>CSV 파일은 어떻게 받나요?</summary>
          <div>
            <p><b>왓챠피디아</b>는 공식 내보내기가 없어서, PC 크롬에서 공개 도구로 받아요.</p>
            <ol>
              <li>크롬에 <b>Tampermonkey</b> 확장 프로그램 설치</li>
              <li><a href="https://github.com/pottq577/watchapedia-export" target="_blank" rel="noopener noreferrer">WatchaPedia Ratings Exporter</a> 스크립트 설치</li>
              <li>왓챠피디아에 로그인해서 내 평가 페이지에서 내보내기 → CSV 저장</li>
            </ol>
            <p><b>레터박스드</b>는 Settings → Import &amp; Export → Export Your Data로 받은 압축 파일 안의 <code>ratings.csv</code>를 올리면 돼요.</p>
          </div>
        </details>
      </section>
      <p class="tp-note">파일은 이 브라우저 안에서만 읽고 어디에도 저장하거나 올리지 않아요. 작품 정보만 TMDB에서 찾아와요.</p>`;
  }

  function renderLoading() {
    const stats = state.items ? ratingStats(state.items) : null;
    const lines = state.log.slice(-5).map((line, index, list) => `<li class="${index === list.length - 1 ? "is-now" : ""}">${escapeHtml(line)}</li>`).join("");
    return `
      <section class="tp-loading" aria-live="polite">
        <div class="tp-reel" aria-hidden="true"><span></span><span></span><span></span></div>
        <h3>취향을 읽는 중</h3>
        ${stats ? `<p class="tp-loading-sub">평가 ${stats.total.toLocaleString("ko-KR")}개 · 평균 ${stats.avg.toFixed(2)}점</p>` : ""}
        <div class="tp-bar"><i data-tp-progress></i></div>
        <ul class="tp-log">${lines}</ul>
      </section>`;
  }

  function stars(score) {
    return `${score}`;
  }

  function renderHistogram(stats) {
    const max = Math.max(1, ...stats.buckets.map((bucket) => bucket.count));
    return `
      <div class="tp-hist" role="img" aria-label="별점 분포">
        ${stats.buckets.map((bucket) => `<div class="tp-hist-col${Math.abs(bucket.score - stats.avg) < 0.25 ? " is-avg" : ""}"><span data-tp-h="${Math.round((bucket.count / max) * 100)}"></span><b>${bucket.score % 1 ? "" : stars(bucket.score)}</b></div>`).join("")}
      </div>`;
  }

  function chipRow(label, values, className = "") {
    if (!values?.length) return "";
    return `<div class="tp-taste-row"><span>${escapeHtml(label)}</span><p>${values.map((value) => `<em class="${className}">${escapeHtml(value)}</em>`).join("")}</p></div>`;
  }

  function serviceBadges(where) {
    return (where?.services || []).map((service) => `<span class="tp-badge is-${service.id}">${escapeHtml(service.name)}${service.mode === "대여" ? " 대여" : ""}</span>`).join("");
  }

  function recCard(rec, index) {
    const poster = rec.poster ? `<img src="${posterBase}w342${escapeHtml(rec.poster)}" alt="" loading="${index < 4 ? "eager" : "lazy"}" decoding="async" referrerpolicy="no-referrer" />` : `<span class="tp-noposter">${escapeHtml(rec.title)}</span>`;
    const facts = [rec.year, rec.runtime ? `${rec.runtime}분` : "", rec.genres.join("·")].filter(Boolean).join(" · ");
    const seedReason = rec.reasons.find((reason) => reason.kind === "seed");
    const directorReason = rec.reasons.find((reason) => reason.kind === "director");
    const tags = rec.reasons.find((reason) => reason.kind === "keywords");
    const link = rec.where?.link || `https://www.themoviedb.org/movie/${rec.id}/watch?locale=KR`;
    return `
      <article class="tp-rec">
        <a class="tp-rec-poster" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(rec.title)} 어디서 보는지 보기">${poster}<span class="tp-match">${rec.match}<small>%</small></span></a>
        <div class="tp-rec-body">
          <h4>${escapeHtml(rec.title)}</h4>
          ${rec.originalTitle ? `<p class="tp-rec-orig">${escapeHtml(rec.originalTitle)}</p>` : ""}
          <p class="tp-rec-facts">${escapeHtml(facts)}${rec.director ? `<br />${escapeHtml(rec.director)}` : ""}</p>
          <div class="tp-badges">${serviceBadges(rec.where)}</div>
          ${seedReason ? `<p class="tp-why">${escapeHtml(seedReason.text)}</p>` : ""}
          ${directorReason ? `<p class="tp-why is-director">${escapeHtml(directorReason.text)}</p>` : ""}
          ${tags ? `<p class="tp-tags">${escapeHtml(tags.text)}</p>` : ""}
          ${rec.overview ? `<p class="tp-overview">${escapeHtml(rec.overview)}</p>` : ""}
        </div>
      </article>`;
  }

  function theaterCard(rec) {
    const reason = rec.reasons.find((item) => item.kind === "director") || rec.reasons.find((item) => item.kind === "keywords");
    return `
      <button type="button" class="tp-theater" data-tp-theater="${escapeHtml(rec.title)}">
        ${rec.poster ? `<img src="${posterBase}w185${escapeHtml(rec.poster)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />` : ""}
        <span><b>${escapeHtml(rec.title)}</b><small>${escapeHtml([rec.year, rec.director].filter(Boolean).join(" · "))}</small>${reason ? `<em>${escapeHtml(reason.text)}</em>` : ""}<i>상영시간표 보기 →</i></span>
      </button>`;
  }

  function renderResult() {
    const { stats, profile, seeds, recs, theater } = state.result;
    const mosaic = seeds.filter((seed) => seed.detail.poster_path && seed.rating >= 4).slice(0, 12)
      .map((seed) => `<img src="${posterBase}w185${escapeHtml(seed.detail.poster_path)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`).join("");
    const filtered = state.filter === "all" ? recs : recs.filter((rec) => rec.where?.services.some((service) => service.id === state.filter));
    const visible = filtered.slice(0, state.shown);
    const filters = [["all", "전체"], ...ottServices.filter((service) => state.selected.includes(service.id)).map((service) => [service.id, service.name])]
      .map(([id, name]) => {
        const count = id === "all" ? recs.length : recs.filter((rec) => rec.where?.services.some((service) => service.id === id)).length;
        return `<button type="button" class="tp-filter${state.filter === id ? " is-on" : ""}" data-tp-filter="${id}"${count ? "" : " disabled"}>${escapeHtml(name)} <small>${count}</small></button>`;
      }).join("");
    const topCountries = stats.countries.slice(0, 4).map((entry) => `${entry.key} ${entry.count}`);
    const facts = [
      ["평가", `${stats.total.toLocaleString("ko-KR")}편`],
      ["평균 별점", stats.avg.toFixed(2)],
      ["5점 비율", `${(stats.fiveShare * 100).toFixed(1)}%`],
      stats.oldest ? ["가장 오래된 영화", `${stats.oldest}년`] : null,
      stats.busiestMonth ? ["가장 많이 본 달", stats.busiestMonth.key.replace("-", ".")] : null
    ].filter(Boolean);
    return `
      <section class="tp-report">
        <div class="tp-mosaic" aria-hidden="true">${mosaic}</div>
        <div class="tp-report-in">
          <p class="tp-kicker">당신의 영화 취향은</p>
          <h3>${escapeHtml(profile.persona.title)}</h3>
          ${profile.persona.why ? `<p>${escapeHtml(profile.persona.why)}</p>` : ""}
          <p>${escapeHtml(profile.persona.adjectiveWhy)}</p>
        </div>
      </section>
      <section class="tp-facts">${facts.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join("")}</section>
      <section class="tp-card">
        <h4>내 별점 분포</h4>
        ${renderHistogram(stats)}
      </section>
      <section class="tp-card tp-taste">
        <h4>취향 지도</h4>
        ${chipRow("끌리는 장르", profile.lovedGenres.map((genre) => genre.name))}
        ${chipRow("좋아하는 감독", profile.directors)}
        ${chipRow("자주 고른 이야기", profile.keywords.map((keyword) => `#${keyword}`), "is-tag")}
        ${chipRow("많이 본 나라", topCountries)}
        ${chipRow("덜 맞는 장르", profile.avoidedGenres, "is-off")}
      </section>
      ${theater.length ? `
        <section class="tp-card">
          <h4>지금 서울 극장에서 하는 취향 영화</h4>
          <div class="tp-theaters">${theater.map(theaterCard).join("")}</div>
        </section>` : ""}
      <section class="tp-recs">
        <div class="tp-recs-head">
          <h4>내 OTT에서 지금 볼 수 있는 영화 <b>${recs.length}</b></h4>
          <button type="button" class="tp-link" data-tp-restart>OTT·파일 바꾸기</button>
        </div>
        ${toggles()}
        <div class="tp-filters" role="group" aria-label="OTT별 보기">${filters}</div>
        ${visible.length ? `<div class="tp-rec-list">${visible.map(recCard).join("")}</div>` : `<p class="tp-empty">고른 OTT에서 찾은 영화가 없어요. OTT를 더 고르거나 대여·구매를 포함해 보세요.</p>`}
        ${filtered.length > state.shown ? `<button type="button" class="tp-more" data-tp-more>더 보기 <small>${filtered.length - state.shown}편 더</small></button>` : ""}
      </section>
      <p class="tp-credit">작품 정보 TMDB · OTT 정보 JustWatch. 쿠팡플레이·라프텔은 데이터가 없어 고를 수 없어요. 추천은 내 별점과 TMDB 정보로만 계산해요.</p>`;
  }

  function renderError() {
    return `
      <section class="tp-error">
        <h3>잠깐, 문제가 있어요</h3>
        <p>${escapeHtml(state.error)}</p>
        <button type="button" class="tp-primary" data-tp-restart>처음으로</button>
      </section>`;
  }

  function render() {
    const target = body();
    if (!target) return;
    const html = state.step === "loading" ? renderLoading() : state.step === "result" ? renderResult() : state.step === "error" ? renderError() : renderStart();
    target.innerHTML = html;
    // bar heights and progress go through the CSSOM: the page's CSP has no inline style attributes
    target.querySelectorAll("[data-tp-h]").forEach((bar) => { bar.style.height = `${Math.max(2, Number(bar.dataset.tpH))}%`; });
    const progress = target.querySelector("[data-tp-progress]");
    if (progress) progress.style.width = `${Math.round(state.progress * 100)}%`;
    sheet()?.classList.toggle("is-result", state.step === "result");
  }

  function updateLoading() {
    if (state.step !== "loading") return;
    const target = body();
    const progress = target?.querySelector("[data-tp-progress]");
    if (progress) progress.style.width = `${Math.round(state.progress * 100)}%`;
    const log = target?.querySelector(".tp-log");
    if (log) log.innerHTML = state.log.slice(-5).map((line, index, list) => `<li class="${index === list.length - 1 ? "is-now" : ""}">${escapeHtml(line)}</li>`).join("");
  }

  // ---------- running ----------

  function say(line) {
    if (state.log.at(-1) !== line) state.log.push(line);
    updateLoading();
  }

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

  async function run() {
    if (!state.csv) return;
    const key = apiKey();
    if (!key) {
      state.step = "error";
      state.error = "작품 정보 연결이 아직 준비되지 않았어요. 잠시 뒤 다시 시도해 주세요.";
      render();
      return;
    }
    const runId = ++state.runId;
    try {
      state.items = readRatings(state.csv.text).items;
    } catch (error) {
      state.step = "error";
      state.error = error.message;
      render();
      return;
    }
    const stats = ratingStats(state.items);
    state.step = "loading";
    state.log = [`별점 ${stats.rated.toLocaleString("ko-KR")}개를 읽었어요`, `5점은 ${(stats.fiveShare * 100).toFixed(1)}%, 2점 이하는 ${(stats.lowShare * 100).toFixed(1)}%`];
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
          if (step.phase === "match") { state.progress = 0.05 + 0.25 * (step.done / Math.max(1, step.total)); say(`좋아한 영화와 싫어한 영화 ${step.total}편을 찾는 중`); }
          else if (step.phase === "read") { state.progress = 0.3 + 0.25 * (step.done / Math.max(1, step.total)); say(`‘${step.title}’에서 취향을 뽑는 중`); }
          else if (step.phase === "gather") { state.progress = 0.58; say("내 OTT에 있는 후보를 모으는 중"); }
          else if (step.phase === "score") { state.progress = 0.6 + 0.38 * (step.done / Math.max(1, step.total)); if (step.done % 20 === 0) say(`후보 ${step.total}편에 점수를 매기는 중 (${step.done})`); }
        }
      });
      if (runId !== state.runId) return;
      state.result = result;
      state.step = "result";
      state.filter = "all";
      state.shown = 12;
      render();
      body()?.scrollTo({ top: 0 });
    } catch (error) {
      if (runId !== state.runId) return;
      state.step = "error";
      state.error = error.message || "추천을 만들지 못했어요.";
      render();
    }
  }

  async function takeFile(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      showToast("파일이 너무 커요 (8MB까지)");
      return;
    }
    const text = await file.text();
    let count = 0;
    try {
      count = readRatings(text).items.length;
    } catch (error) {
      state.step = "error";
      state.error = error.message;
      render();
      return;
    }
    if (!count) {
      showToast("CSV에서 작품을 찾지 못했어요");
      return;
    }
    state.csv = { name: file.name, count, text };
    store.set(keys.csv, state.csv);
    run();
  }

  // ---------- events ----------

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
        state.selected = state.selected.includes(id) ? state.selected.filter((value) => value !== id) : [...state.selected, id];
        store.set(keys.otts, state.selected);
        render();
        return;
      }
      const toggle = target.closest("[data-tp-toggle]");
      if (toggle) {
        const name = toggle.dataset.tpToggle;
        state[name] = !state[name];
        store.set(keys.options, { includeRent: state.includeRent, hiddenGems: state.hiddenGems });
        if (state.step === "result") run();
        else render();
        return;
      }
      if (target.closest("[data-tp-reuse]")) { run(); return; }
      if (target.closest("[data-tp-restart]")) { state.runId += 1; state.step = "start"; render(); return; }
      const filter = target.closest("[data-tp-filter]");
      if (filter) { state.filter = filter.dataset.tpFilter; state.shown = 12; render(); return; }
      if (target.closest("[data-tp-more]")) {
        const scroll = body()?.scrollTop || 0;
        state.shown += 12;
        render();
        body()?.scrollTo({ top: scroll });
        return;
      }
      const theater = target.closest("[data-tp-theater]");
      if (theater) { root.close?.(); onTheater?.(theater.dataset.tpTheater); }
    });
    root.addEventListener("change", (event) => {
      const input = event.target.closest?.("[data-tp-file]");
      if (input?.files?.[0]) {
        if (!state.selected.length) showToast("OTT를 하나도 안 고르면 모든 영화를 보여줘요");
        takeFile(input.files[0]);
      }
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
    if (state.step === "loading" && !state.runId) state.step = "start";
    render();
    if (typeof root.showModal === "function") { if (!root.open) root.showModal(); }
    else root.setAttribute("open", "");
    root.focus({ preventScroll: true });
  }

  return { open };
}
