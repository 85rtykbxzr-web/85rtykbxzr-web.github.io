// Busan International Film Festival timetable for the festival planner.
// Reads the official per-day timetable (www.biff.kr/kor/html/schedule/date.asp?day1=N) and each
// film's page once for its runtime and section, and writes data/festival-biff.json.
//   node scripts/festival-biff.mjs            refresh while the festival window is near
//   node scripts/festival-biff.mjs --force    refresh regardless of the date
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./write-file-atomic.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(root, "data/festival-biff.json");
const origin = "https://www.biff.kr";
const headers = { "user-agent": "Mozilla/5.0 (compatible; seoulcinemaschedule)", "accept-language": "ko-KR,ko;q=0.9" };

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

function text(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

async function fetchText(url, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw lastError;
}

// One timetable page: rows per venue, cells per screening.
export function parseBiffDay(html, date) {
  const sessions = [];
  const rows = String(html || "").split('<div class="sch_li">').slice(1);
  for (const row of rows) {
    const venue = text(row.match(/class="sch_li_tit">([\s\S]*?)<\/div>/)?.[1]);
    if (!venue) continue;
    for (const cell of row.split(/<div class="sch_it sch_it\d+[^"]*">/).slice(1)) {
      const code = cell.match(/data-scode="([^"]+)"/)?.[1];
      const time = cell.match(/class="time en">\s*(\d{1,2}:\d{2})/)?.[1];
      const link = cell.match(/href\s*=\s*"([^"]+)"/)?.[1];
      if (!code || !time || !link) continue;
      const params = new URL(decodeEntities(link), origin).searchParams;
      const isFilm = /prog_view\.asp/.test(link);
      const flags = [...cell.matchAll(/class="ico_grade ([^"]+)"[^>]*>([^<]*)</g)].map((match) => ({ cls: match[1], label: text(match[2]) }));
      const rating = flags.find((flag) => /ico_(g|12|15|19|all)\b/i.test(flag.cls))?.label || "";
      sessions.push({
        id: `biff-${date}-${code}`,
        code,
        date,
        time: time.padStart(5, "0"),
        venue,
        title: text(cell.match(/class="film_tit_kor">([\s\S]*?)<\/span>/)?.[1]),
        titleEn: text(cell.match(/class="film_tit_eng[^"]*">([\s\S]*?)<\/span>/)?.[1]),
        filmId: isFilm ? params.get("idx") || "" : "",
        kind: isFilm ? "film" : "event",
        rating,
        gv: flags.some((flag) => /ico_gv/.test(flag.cls)),
        subtitles: flags.find((flag) => /ico_(ke|k|e|ad|no)\b/i.test(flag.cls))?.label || "",
        bundle: flags.some((flag) => flag.label === "묶"),
        url: new URL(decodeEntities(link), origin).href
      });
    }
  }
  return sessions;
}

// Film page: section name and runtime ("러닝타임 | 100min").
export function parseBiffFilm(html) {
  const flat = text(String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " | "));
  const runtime = Number(flat.match(/러닝타임[\s|]*(\d{1,3})\s*min/i)?.[1] || 0);
  const country = flat.match(/국가[\s|]*([^|]+?)\s*\|/)?.[1]?.trim() || "";
  const year = flat.match(/제작연도[\s|]*(\d{4})/)?.[1] || "";
  const section = text(String(html || "").match(/<div class="breadcrumb">[\s\S]*?<a href="prog_list\.asp[^"]*">([\s\S]*?)<\/a>/)?.[1]);
  return { runtime, country, year, section };
}

function datesBetween(start, end) {
  const dates = [];
  for (let day = new Date(`${start}T00:00:00Z`); day <= new Date(`${end}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

export async function refreshBiff({ force = false, now = new Date() } = {}) {
  const schedule = await readJson(join(root, "data/schedule.json"), {});
  const festival = (schedule.majorFestivals || []).find((item) => String(item.id || "").startsWith("biff-"));
  if (!festival?.startDate || !festival?.endDate) {
    console.log("BIFF: no dated festival entry; skipping.");
    return;
  }
  const today = now.toISOString().slice(0, 10);
  const opensSoon = new Date(`${festival.startDate}T00:00:00Z`).getTime() - now.getTime() < 45 * 86_400_000;
  if (!force && (!opensSoon || today > festival.endDate)) {
    console.log(`BIFF: outside the planning window (${festival.startDate}–${festival.endDate}); keeping the saved timetable.`);
    return;
  }
  const previous = await readJson(outputPath, { films: {} });
  const sessions = [];
  for (const date of datesBetween(festival.startDate, festival.endDate)) {
    const day = Number(date.slice(8));
    const html = await fetchText(`${origin}/kor/html/schedule/date.asp?day1=${day}`);
    sessions.push(...parseBiffDay(html, date));
  }
  if (sessions.length < 50) throw new Error(`BIFF: only ${sessions.length} screenings parsed; refusing to overwrite`);

  const films = {};
  const queue = [...new Set(sessions.map((session) => session.filmId).filter(Boolean))];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const cached = previous.films?.[id];
      if (cached?.runtime) {
        films[id] = cached;
        continue;
      }
      const session = sessions.find((item) => item.filmId === id && item.kind === "film");
      try {
        films[id] = parseBiffFilm(await fetchText(session.url));
      } catch (error) {
        console.warn(`BIFF film ${id} skipped: ${error.message}`);
        films[id] = { runtime: 0, country: "", year: "", section: "" };
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  const output = {
    festivalId: festival.id,
    name: festival.name,
    // BIFF began in 1996: 2026 is the 31st edition (제31회)
    officialName: `제${Number(festival.startDate.slice(0, 4)) - 1995}회 ${festival.name}`,
    startDate: festival.startDate,
    endDate: festival.endDate,
    ticketUrl: "https://www.biff.kr/kor/html/ticket/ticket_info.asp",
    generatedAt: now.toISOString(),
    sessions: sessions.sort((a, b) => `${a.date} ${a.time} ${a.code}`.localeCompare(`${b.date} ${b.time} ${b.code}`)),
    films
  };
  await writeFileAtomic(outputPath, `${JSON.stringify(output)}\n`);
  const withRuntime = Object.values(films).filter((film) => film.runtime).length;
  console.log(`BIFF: ${sessions.length} screenings, ${queue.length + Object.keys(films).length} films (${withRuntime} with runtime).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await refreshBiff({ force: process.argv.includes("--force") });
}
