import assert from "node:assert/strict";
import {
  extractFestivalNameFromTitle,
  findFestivalProgram,
  isFestivalSession,
  isGenericFestivalSectionLabel,
  normalizeFestivalSessions,
  resolveFestivalIdentity,
  resolveFestivalName
} from "../src/festival-labels.mjs";

const programs = [
  {
    title: "제15회 아랍영화제",
    venueId: "momo",
    dates: ["2026-08-14", "2026-08-17"],
    movies: ["목화의 여왕", "싱크: 가라앉다", "튀니지의 샬라", "뷰티 앤 더 독스", "해피 버스데이"]
  },
  {
    title: "제1회 서울청소년실험영화제",
    venueId: "momo",
    dates: ["2026-08-07", "2026-08-08"],
    movies: ["소영의 노력"]
  }
];

const momoSession = {
  date: "2026-08-15",
  title: "목화의 여왕",
  venueId: "momo",
  program: "일반",
  kind: "festival",
  tags: ["12세이상관람가", "93분", "2D-영화제(자막)"]
};

assert.equal(isFestivalSession(momoSession), true);
assert.equal(findFestivalProgram(momoSession, programs)?.title, "제15회 아랍영화제");
assert.equal(
  resolveFestivalName({ session: momoSession, programs, venueName: "아트하우스 모모" }),
  "제15회 아랍영화제"
);

const lectureSession = {
  date: "2026-08-25",
  title: "4강. 영화제를 만드는 프로그래머의 일 + 강의 조지훈",
  venueId: "sac",
  program: "상영시간표",
  kind: "program"
};
assert.equal(isFestivalSession(lectureSession), false);
assert.equal(extractFestivalNameFromTitle(lectureSession.title), "");

const kofaSession = {
  date: "2026-08-20",
  title: "개막식 + 개막작",
  venueId: "kofa",
  program: "28회 서울국제여성영화제",
  kind: "program"
};
assert.equal(isFestivalSession(kofaSession), true);
assert.equal(resolveFestivalName({ session: kofaSession, programs: [], venueName: "시네마테크KOFA" }), "서울국제여성영화제");

const kqffSession = {
  date: "2026-09-20",
  title: "경쟁 단편 1",
  venueId: "indiespace",
  program: "KQFF",
  kind: "program"
};
assert.equal(isFestivalSession(kqffSession), true);
assert.equal(resolveFestivalName({ session: kqffSession, programs: [], venueName: "인디스페이스" }), "KQFF");

const heyriSession = {
  date: "2026-09-11",
  title: "전주 단편 - 제27회 전주국제영화제 한국영화 앙코르 기획전",
  venueId: "heyri",
  program: "일반",
  kind: "festival"
};
assert.equal(resolveFestivalName({ session: heyriSession, programs: [], venueName: "헤이리시네마" }), "제27회 전주국제영화제");

const anonymousFestivalSession = {
  date: "2026-08-30",
  title: "상영작",
  venueId: "momo",
  program: "일반",
  kind: "festival"
};
assert.equal(
  resolveFestivalName({ session: anonymousFestivalSession, programs: [], venueName: "아트하우스 모모" }),
  "아트하우스 모모 영화제 상영"
);
assert.equal(isGenericFestivalSectionLabel("일반"), true);
assert.equal(isGenericFestivalSectionLabel("영화제"), true);
assert.equal(isGenericFestivalSectionLabel("개막"), false);

const futurePrograms = [
  {
    id: "future-blue",
    title: "제31회 푸른빛영화제",
    venueId: "future-cinema",
    dates: ["2027-04-03", "2027-04-05"],
    movies: ["파도 너머", "밤의 지도"]
  },
  {
    id: "future-forest",
    title: "제9회 도시숲영화제",
    venueId: "future-cinema",
    dates: ["2027-04-03", "2027-04-05"],
    movies: ["초록의 시간"]
  }
];
const futureSession = {
  id: "future-session",
  date: "2027-04-04",
  title: "파도 너머 + 관객과의 대화",
  venueId: "future-cinema",
  program: "일반",
  kind: "festival",
  tags: ["2D-영화제(자막)"]
};
assert.equal(findFestivalProgram(futureSession, futurePrograms)?.id, "future-blue");
assert.deepEqual(
  resolveFestivalIdentity({ session: futureSession, programs: futurePrograms, venueName: "미래극장" }),
  { name: "제31회 푸른빛영화제", source: "program-card", confidence: "high", programId: "future-blue" }
);
const tagOnlyFutureSession = { ...futureSession, id: "future-tag-only", kind: "program" };
assert.equal(isFestivalSession(tagOnlyFutureSession), true);
assert.equal(
  resolveFestivalName({ session: tagOnlyFutureSession, programs: futurePrograms, venueName: "미래극장" }),
  "제31회 푸른빛영화제"
);

const ambiguousFutureSession = {
  ...futureSession,
  id: "future-ambiguous",
  title: "신작 특별상영"
};
assert.equal(findFestivalProgram(ambiguousFutureSession, futurePrograms), null);
assert.equal(
  resolveFestivalName({ session: ambiguousFutureSession, programs: futurePrograms, venueName: "미래극장" }),
  "미래극장 영화제 상영"
);

const tiedMovieSession = {
  ...futureSession,
  id: "future-tied-movie",
  title: "공동 상영작"
};
const tiedMoviePrograms = futurePrograms.map((program) => ({
  ...program,
  movies: [...program.movies, "공동 상영작"]
}));
assert.equal(findFestivalProgram(tiedMovieSession, tiedMoviePrograms), null);
assert.equal(
  resolveFestivalName({ session: tiedMovieSession, programs: tiedMoviePrograms, venueName: "미래극장" }),
  "미래극장 영화제 상영"
);

const broaderContaminatedProgram = {
  id: "future-recruitment",
  title: "제16회 붉은빛영화제 서포터즈 모집",
  venueId: "future-cinema",
  dates: ["2027-03-20", "2027-04-05"],
  movies: ["공동 상영작", "파도 너머"]
};
assert.equal(findFestivalProgram(futureSession, [...futurePrograms, broaderContaminatedProgram])?.id, "future-blue");

const singleWindowIdentity = resolveFestivalIdentity({
  session: ambiguousFutureSession,
  programs: [futurePrograms[0]],
  venueName: "미래극장"
});
assert.deepEqual(singleWindowIdentity, {
  name: "제31회 푸른빛영화제",
  source: "program-window",
  confidence: "medium",
  programId: "future-blue"
});

const normalizedSchedule = normalizeFestivalSessions({
  venues: [{ id: "future-cinema", name: "미래극장" }],
  programs: futurePrograms,
  sessions: [
    futureSession,
    {
      id: "stale-generated-name",
      date: "2027-04-04",
      title: "영화제를 만드는 사람들",
      venueId: "future-cinema",
      program: "상영시간표",
      kind: "program",
      festivalName: "지난 영화제",
      festivalNameSource: "program-card",
      festivalNameConfidence: "high",
      festivalProgramId: "past-program"
    }
  ]
});
assert.deepEqual(
  normalizedSchedule.sessions[0],
  {
    ...futureSession,
    festivalName: "제31회 푸른빛영화제",
    festivalNameSource: "program-card",
    festivalNameConfidence: "high",
    festivalProgramId: "future-blue"
  }
);
assert.equal(normalizedSchedule.sessions[1].festivalName, undefined);
assert.equal(isFestivalSession(normalizedSchedule.sessions[1]), false);
assert.deepEqual(normalizeFestivalSessions(normalizedSchedule), normalizedSchedule);

console.log("Festival label tests passed.");
