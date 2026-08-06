const festivalSignalPattern = /영화제|페스티벌|프라이드시네마|KQFF/i;
const genericFestivalNamePattern = /^(?:영화제|페스티벌|영화제\s*(?:상영|프로그램)|페스티벌\s*(?:상영|프로그램))$/i;
const genericFestivalSectionPattern = /^(?:일반|상영시간표|날짜별\s*시간표|작품별\s*상영일정|영화제|페스티벌|프로그램|상영|2D(?:[-\s]?(?:영화제|페스티벌))?)$/i;
const generatedFestivalNameSources = new Set([
  "program-card",
  "program-window",
  "session-program",
  "session-title",
  "preserved",
  "venue-fallback"
]);

function normalizedText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizedMovieTitle(value) {
  return normalizedText(value)
    .replace(/\((?:확장판|감독판|디지털|자막|영문자막|무삭제판|리마스터링|4K|2D|3D|더빙)[^)]*\)/gi, "")
    .replace(/[“”‘’"']/g, "")
    .trim();
}

function comparableMovieTitle(value) {
  return normalizedMovieTitle(value)
    .toLocaleLowerCase("ko")
    .replace(/[\s:：·,./\\_-]+/g, "");
}

function isoDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function programRange(program) {
  const dates = Array.isArray(program?.dates)
    ? program.dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(String(date))).sort()
    : [];
  if (dates.length) return { start: dates[0], end: dates[dates.length - 1] };

  const period = normalizedText(program?.period).replace(/[년월]/g, ".").replace(/일/g, "");
  const range = period.match(
    /(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*(?:[-~–—]|부터|to)\s*(?:(20\d{2})\s*[.\-/]\s*)?(?:(\d{1,2})\s*[.\-/]\s*)?(\d{1,2})/i
  );
  if (range) {
    const startYear = Number(range[1]);
    const startMonth = Number(range[2]);
    const endYear = Number(range[4] || startYear);
    const endMonth = Number(range[5] || startMonth);
    return {
      start: isoDate(startYear, startMonth, range[3]),
      end: isoDate(endYear, endMonth, range[6])
    };
  }

  const single = period.match(/(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  if (!single) return null;
  const date = isoDate(single[1], single[2], single[3]);
  return { start: date, end: date };
}

function rangeLength(range) {
  if (!range?.start || !range?.end) return Number.POSITIVE_INFINITY;
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function festivalProgramMatch(program, session) {
  const sessionTitle = normalizedMovieTitle(session?.title);
  const movieTitles = Array.isArray(program?.movies) ? program.movies.map(normalizedMovieTitle).filter(Boolean) : [];
  const exactMovieMatch = Boolean(sessionTitle && movieTitles.includes(sessionTitle));
  const sessionMovieKey = comparableMovieTitle(sessionTitle);
  const containedMovieMatch = Boolean(
    !exactMovieMatch &&
      sessionMovieKey &&
      movieTitles.some((movieTitle) => {
        const movieKey = comparableMovieTitle(movieTitle);
        return movieKey.length >= 4 && (sessionMovieKey.includes(movieKey) || movieKey.includes(sessionMovieKey));
      })
  );
  const sessionText = normalizedText(
    [session?.title, session?.program, sourceFestivalName(session), ...(session?.tags || [])].filter(Boolean).join(" ")
  );
  const programName = cleanFestivalDisplayTitle(program?.title);
  const programTokens = programName
    .replace(/제?\s*\d+\s*회/gi, " ")
    .replace(/영화제|페스티벌|국제/gi, " ")
    .split(/[\s:·,.'‘’"()[\]\-]+/)
    .filter((token) => token.length >= 2 && !/^(?:서울|영화|상영|프로그램)$/i.test(token));
  const tokenHits = programTokens.filter((token) => sessionText.includes(token)).length;
  const directNameMatch = Boolean(
    programName && normalizedText(sessionText).replace(/\s+/g, "").includes(programName.replace(/\s+/g, ""))
  );

  return {
    score: Number(exactMovieMatch) * 1000 + Number(containedMovieMatch) * 800 + Number(directNameMatch) * 500 + tokenHits * 20,
    exactMovieMatch,
    containedMovieMatch,
    directNameMatch,
    tokenHits
  };
}

function sourceFestivalName(session) {
  if (!session?.festivalName || generatedFestivalNameSources.has(session?.festivalNameSource)) return "";
  return session.festivalName;
}

function hasFestivalSessionSignal(session, { includeGeneratedName = false } = {}) {
  const festivalName = includeGeneratedName ? session?.festivalName : sourceFestivalName(session);
  return festivalSignalPattern.test(
    normalizedText([session?.program, festivalName, session?.eventName, ...(session?.tags || [])].filter(Boolean).join(" "))
  );
}

function festivalProgramResolution(session, programs) {
  const candidates = (Array.isArray(programs) ? programs : [])
    .filter((program) => isNamedFestivalLabel(program?.title))
    .filter((program) => !program?.venueId || !session?.venueId || program.venueId === session.venueId)
    .map((program) => {
      const range = programRange(program);
      if (range && session?.date && (session.date < range.start || session.date > range.end)) return null;
      return {
        program,
        match: festivalProgramMatch(program, session),
        range,
        span: rangeLength(range)
      };
    })
    .filter(Boolean);

  const strongMatches = candidates
    .filter((candidate) => candidate.match.score > 0)
    .sort(
      (a, b) =>
        b.match.score - a.match.score ||
        a.span - b.span ||
        String(a.program.title).localeCompare(String(b.program.title), "ko")
    );
  if (strongMatches.length) {
    const [bestMatch, runnerUp] = strongMatches;
    const hasUniqueEvidence =
      !runnerUp ||
      bestMatch.match.score > runnerUp.match.score ||
      (bestMatch.match.score === runnerUp.match.score && bestMatch.span < runnerUp.span);
    if (hasUniqueEvidence) {
      return { ...bestMatch, source: "program-card", confidence: "high" };
    }
  }

  const windowMatches = candidates.filter((candidate) => candidate.range);
  if (isFestivalSession(session) && windowMatches.length === 1) {
    return { ...windowMatches[0], source: "program-window", confidence: "medium" };
  }
  return null;
}

export function cleanFestivalDisplayTitle(value) {
  return normalizedText(value)
    .replace(/^2D-?/, "")
    .replace(/^#+/, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/^\d{1,2}\s*월\s*\d{1,2}\s*일?\s*/i, "")
    .replace(/^\d{1,2}\s*[.\-/]\s*\d{1,2}(?:\s*[월화수목금토일])?\s*/i, "")
    .replace(/^\d+\s*회\s+(?=.{0,40}(?:영화제|페스티벌))/i, "")
    .replace(/\s*[|｜]\s*[^|｜]+$/g, "")
    .replace(/^(.*?(?:영화제|페스티벌))\s*['"‘’“”]([^'"‘’“”]+)['"‘’“”]\s*$/i, "$1: $2")
    .replace(/\s+/g, " ")
    .trim();
}

export function isNamedFestivalLabel(value) {
  const label = cleanFestivalDisplayTitle(value);
  return festivalSignalPattern.test(label) && !genericFestivalNamePattern.test(label);
}

export function isGenericFestivalSectionLabel(value) {
  const label = cleanFestivalDisplayTitle(value);
  return !label || genericFestivalSectionPattern.test(label);
}

export function isFestivalSession(session) {
  if (session?.kind === "festival") return true;
  return hasFestivalSessionSignal(session, { includeGeneratedName: true });
}

export function extractFestivalNameFromTitle(value) {
  const title = normalizedText(value);
  if (!title) return "";
  if (/\bKQFF\b/i.test(title)) return "KQFF";

  const ordinal = title.match(/제\s*\d+\s*회\s*[A-Za-z0-9가-힣·'‘’:\s-]{1,48}?(?:영화제|페스티벌)(?![가-힣])/i);
  if (ordinal) return cleanFestivalDisplayTitle(ordinal[0]);

  const named = title.match(
    /(?:^|[\s:|｜<〈>〉"'‘’“”()[\]-])((?:\d+\s*회\s*)?[A-Za-z0-9가-힣·'‘’:-]{2,}(?:\s+[A-Za-z0-9가-힣·'‘’:-]{1,20}){0,5}\s*(?:영화제|페스티벌))(?![가-힣])/i
  );
  const candidate = cleanFestivalDisplayTitle(named?.[1] || "");
  return isNamedFestivalLabel(candidate) ? candidate : "";
}

export function findFestivalProgram(session, programs) {
  return festivalProgramResolution(session, programs)?.program || null;
}

export function resolveFestivalIdentity({ session, programs, venueName = "상영관" }) {
  const explicitName = [sourceFestivalName(session), session?.eventName]
    .map(cleanFestivalDisplayTitle)
    .find(isNamedFestivalLabel);
  if (isNamedFestivalLabel(explicitName)) {
    return { name: explicitName, source: "source-field", confidence: "high", programId: session?.festivalProgramId || "" };
  }

  const matchedProgram = festivalProgramResolution(session, programs);
  if (matchedProgram) {
    return {
      name: cleanFestivalDisplayTitle(matchedProgram.program.title),
      source: matchedProgram.source,
      confidence: matchedProgram.confidence,
      programId: matchedProgram.program.id || ""
    };
  }

  const programName = cleanFestivalDisplayTitle(session?.program);
  if (isNamedFestivalLabel(programName)) {
    return { name: programName, source: "session-program", confidence: "high", programId: "" };
  }

  const titleName = extractFestivalNameFromTitle(session?.title);
  if (titleName) return { name: titleName, source: "session-title", confidence: "medium", programId: "" };

  const preservedName = cleanFestivalDisplayTitle(session?.festivalName);
  if (isNamedFestivalLabel(preservedName)) {
    return { name: preservedName, source: "preserved", confidence: "low", programId: session?.festivalProgramId || "" };
  }

  return {
    name: `${normalizedText(venueName) || "상영관"} 영화제 상영`,
    source: "venue-fallback",
    confidence: "low",
    programId: ""
  };
}

export function resolveFestivalName(options) {
  return resolveFestivalIdentity(options).name;
}

export function normalizeFestivalSessions(schedule) {
  const venueNames = new Map((schedule?.venues || []).map((venue) => [venue.id, venue.name]));
  const sessions = (schedule?.sessions || []).map((session) => {
    const sourceIdentifiesFestival = session?.kind === "festival" || hasFestivalSessionSignal(session);
    if (!sourceIdentifiesFestival) {
      if (!generatedFestivalNameSources.has(session?.festivalNameSource)) return session;
      const next = { ...session };
      delete next.festivalName;
      delete next.festivalNameSource;
      delete next.festivalNameConfidence;
      delete next.festivalProgramId;
      return next;
    }

    const identity = resolveFestivalIdentity({
      session,
      programs: schedule?.programs,
      venueName: venueNames.get(session.venueId) || "상영관"
    });
    const next = {
      ...session,
      festivalName: identity.name,
      festivalNameSource: identity.source,
      festivalNameConfidence: identity.confidence
    };
    if (identity.programId) next.festivalProgramId = identity.programId;
    else delete next.festivalProgramId;
    return next;
  });

  return { ...schedule, sessions };
}
