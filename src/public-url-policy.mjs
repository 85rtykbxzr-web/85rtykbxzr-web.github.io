const trustedPublicHostnames = new Set([
  "a.ltrbxd.com",
  "api.dtryx.com",
  "arthousemomo.co.kr",
  "blog.kakaocdn.net",
  "cdn.imweb.me",
  "cine.arirang.go.kr",
  "dmzdocs.com",
  "forms.gle",
  "i1.daumcdn.net",
  "img.dtryx.com",
  "img1.daumcdn.net",
  "indiespace.kr",
  "kucinema.net",
  "laikacinema.com",
  "litt.ly",
  "map.naver.com",
  "mjff.or.kr",
  "moviee.co.kr",
  "movieland.co",
  "scinema.org",
  "seff.kr",
  "siff.kr",
  "upload.wikimedia.org",
  "www.arthousemomo.co.kr",
  "www.bifan.kr",
  "www.biff.kr",
  "www.cinecube.co.kr",
  "www.cinematheque.seoul.kr",
  "www.dtryx.com",
  "www.emuartspace.com",
  "www.filmforum.kr",
  "www.jeonjufest.kr",
  "www.koreafilm.or.kr",
  "www.sangsangmadang.com",
  "www.siwff.or.kr",
  "www.tinyticket.net",
  "www.youtube.com"
]);

const legacyHttpHostnames = new Set(["www.emuartspace.com", "www.filmforum.kr"]);
const trustedNonDefaultPorts = new Set(["api.dtryx.com:30443", "cine.arirang.go.kr:8443"]);

export function safePublicUrl(value, fallback = "#") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (/^#[A-Za-z][A-Za-z0-9:_-]*$/.test(raw)) return raw;
  if (!/^https?:\/\//i.test(raw)) return fallback;

  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const endpoint = `${hostname}:${url.port}`;
    if (url.username || url.password || (url.port && !trustedNonDefaultPorts.has(endpoint)) || !trustedPublicHostnames.has(hostname)) {
      return fallback;
    }
    if (url.protocol === "https:") return url.href;
    if (url.protocol === "http:" && legacyHttpHostnames.has(hostname)) return url.href;
    return fallback;
  } catch {
    return fallback;
  }
}

export function isTrustedPublicUrl(value) {
  return Boolean(safePublicUrl(value, ""));
}
