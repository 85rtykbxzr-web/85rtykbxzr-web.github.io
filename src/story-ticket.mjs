// Draws a 1080x1920 "today's movie" image for Instagram stories on a canvas.
// Pure drawing: the caller passes the session details and gets a canvas back.

export const ticketStyles = {
  poster: { label: "포스터" },
  ticket: { label: "티켓" },
  receipt: { label: "영수증" }
};

const W = 1080;
const H = 1920;
const SANS = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", sans-serif';
const BRAND = '"BM Kkubulim Brand", ' + SANS;
const WEEKDAYS_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];
const INK = "#1d1b18";
// Instagram covers roughly the top 14% (progress bar, profile) and bottom 20% (reply bar)
// of a story, so everything that must stay readable sits between these two lines.
const SAFE_TOP = 290;
const SAFE_BOTTOM = H - 400;
const PAPER = "#f3eee4";

// Pretendard is tight by design at display sizes; a little negative tracking keeps titles crisp.
function setTitleFont(ctx, size) {
  ctx.font = `700 ${size}px ${SANS}`;
  ctx.letterSpacing = `${-Math.round(size * 0.025)}px`;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Korean titles have few spaces, so lines break per character when a word is too long.
function wrapLines(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let line = "";
  for (const char of Array.from(String(text || ""))) {
    const next = line + char;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line.trimEnd());
      line = char.trimStart();
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  const used = lines.join("").length;
  if (used < Array.from(String(text || "")).length && lines.length) {
    let last = lines[lines.length - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

function hash(text) {
  let value = 2166136261;
  for (const char of String(text)) value = Math.imul(value ^ char.codePointAt(0), 16777619);
  return value >>> 0;
}

// Canvas letterSpacing is not everywhere yet, so tracked labels are laid out by hand.
function trackedWidth(ctx, text, spacing) {
  return Array.from(text).reduce((sum, char) => sum + ctx.measureText(char).width + spacing, -spacing);
}

function drawTracked(ctx, text, x, y, spacing, align = "left") {
  const width = trackedWidth(ctx, text, spacing);
  let cx = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
  const previous = ctx.textAlign;
  ctx.textAlign = "left";
  for (const char of Array.from(text)) {
    ctx.fillText(char, cx, y);
    cx += ctx.measureText(char).width + spacing;
  }
  ctx.textAlign = previous;
}

function starPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 ? r * 0.45 : r;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

// Five stars starting at x (or centred on it); rating is 0.5–5 in half steps. Returns the width.
function drawStars(ctx, rating, x, cy, size, color, emptyColor, align = "left") {
  const gap = size * 0.18;
  const width = size * 5 + gap * 4;
  let sx = align === "center" ? x - width / 2 : x;
  for (let i = 0; i < 5; i++) {
    const cx = sx + size / 2;
    starPath(ctx, cx, cy, size / 2);
    ctx.fillStyle = emptyColor;
    ctx.fill();
    const fill = Math.max(0, Math.min(1, rating - i));
    if (fill > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, cy - size / 2, size * fill, size);
      ctx.clip();
      starPath(ctx, cx, cy, size / 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    }
    sx += size + gap;
  }
  return width;
}

function ratingText(rating) {
  return Number.isInteger(rating) ? `${rating}.0` : String(rating);
}

let grainTile = null;
function grain(ctx, alpha) {
  if (!grainTile) {
    grainTile = document.createElement("canvas");
    grainTile.width = 160;
    grainTile.height = 160;
    const tc = grainTile.getContext("2d");
    const data = tc.createImageData(160, 160);
    for (let i = 0; i < data.data.length; i += 4) {
      const v = Math.random() * 255;
      data.data[i] = v;
      data.data[i + 1] = v;
      data.data[i + 2] = v;
      data.data[i + 3] = 255;
    }
    tc.putImageData(data, 0, 0);
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = ctx.createPattern(grainTile, "repeat");
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

// Most cinema sites send no CORS headers, so a direct load would taint the canvas.
// Fall back to a CORS-enabled image proxy before giving up on the poster.
async function loadPoster(src) {
  if (!src) return null;
  const direct = await loadImage(src);
  if (direct && posterIsExportable(direct)) return direct;
  const proxied = await loadImage(`https://wsrv.nl/?url=${encodeURIComponent(src)}&w=900&output=jpg`);
  return proxied && posterIsExportable(proxied) ? proxied : null;
}

function drawCover(ctx, image, x, y, w, h) {
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(image, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

// A poster from a host without CORS would taint the canvas and block the export,
// so it is tried on a scratch canvas first.
function posterIsExportable(image) {
  try {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const context = probe.getContext("2d");
    context.drawImage(image, 0, 0, 1, 1);
    context.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

// Downscale-then-upscale blur: works on browsers without ctx.filter (older Safari).
function drawBlurredBackdrop(ctx, poster, fallback) {
  if (!poster) {
    ctx.fillStyle = fallback;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  let source = poster;
  for (const divisor of [8, 40]) {
    const step = document.createElement("canvas");
    step.width = Math.round(W / divisor);
    step.height = Math.round(H / divisor);
    const sc = step.getContext("2d");
    sc.imageSmoothingQuality = "high";
    if (source === poster) drawCover(sc, poster, 0, 0, step.width, step.height);
    else sc.drawImage(source, 0, 0, step.width, step.height);
    source = step;
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, -40, -40, W + 80, H + 80);
  ctx.fillStyle = "rgba(20, 18, 15, 0.22)";
  ctx.fillRect(0, 0, W, H);
}

function dateParts(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return {
    yyyy: String(date.getFullYear()),
    mm: String(date.getMonth() + 1).padStart(2, "0"),
    dd: String(date.getDate()).padStart(2, "0"),
    en: WEEKDAYS_EN[date.getDay()],
    ko: WEEKDAYS_KO[date.getDay()]
  };
}

// Draws a day line like "10월 1일  목요일 14:30": the date heavier, the rest lighter, centred as one.
function drawDayLine(ctx, ticket, cx, y, big, small) {
  const d = dateParts(ticket.date);
  const day = d ? `${Number(d.mm)}월 ${Number(d.dd)}일` : ticket.date;
  const rest = d ? `${d.ko}요일  ${ticket.time}` : ticket.time;
  ctx.font = `700 ${big}px ${SANS}`;
  const dayWidth = ctx.measureText(day).width;
  ctx.font = `500 ${small}px ${SANS}`;
  const restWidth = ctx.measureText(rest).width;
  const gap = Math.round(small * 0.5);
  const left = cx - (dayWidth + gap + restWidth) / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${big}px ${SANS}`;
  ctx.fillText(day, left, y);
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = `500 ${small}px ${SANS}`;
  ctx.fillText(rest, left + dayWidth + gap, y);
}

function drawPosterStyle(ctx, ticket, poster, { typeScale: k = 1.05, gap: baseGap = 26 } = {}) {
  // Fill the story; a 2:3 poster loses about 8% on each side, which keeps the full-bleed look.
  if (poster) drawCover(ctx, poster, 0, 0, W, H);
  else {
    ctx.fillStyle = "#1b1a18";
    ctx.fillRect(0, 0, W, H);
  }
  const top = ctx.createLinearGradient(0, 0, 0, 520);
  top.addColorStop(0, "rgba(0,0,0,0.5)");
  top.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, 520);
  const shade = ctx.createLinearGradient(0, 900, 0, H);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(0.5, "rgba(0,0,0,0.62)");
  shade.addColorStop(1, "rgba(0,0,0,0.86)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 900, W, H - 900);
  grain(ctx, 0.1);

  const x = 84;
  const d = dateParts(ticket.date);
  const titleSize = Math.round(84 * k);
  setTitleFont(ctx, titleSize);
  const titleLines = wrapLines(ctx, ticket.title, W - x * 2, 3);
  const meta = [ticket.venue, ticket.screen].filter(Boolean).join("  ·  ");
  // Laid out from the bottom up on measured ink boxes, so the gaps between date, title,
  // stars and venue look even whatever the glyphs; the block ends above the reply bar.
  const ink = (font, sample = "가") => {
    ctx.font = font;
    const m = ctx.measureText(sample);
    return { asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent };
  };
  const gap = Math.round(baseGap * k);
  const metaFont = `500 ${Math.round(32 * k)}px ${SANS}`;
  const titleFont = `700 ${titleSize}px ${SANS}`;
  const dayFont = `700 ${Math.round(54 * k)}px ${SANS}`;
  const restFont = `500 ${Math.round(36 * k)}px ${SANS}`;
  const ratingFont = `600 ${Math.round(32 * k)}px ${SANS}`;

  let bottom = SAFE_BOTTOM + 20;
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.74)";
  ctx.font = metaFont;
  ctx.fillText(meta, x, bottom);
  bottom -= ink(metaFont).asc + gap;

  if (ticket.rating) {
    const size = Math.round(48 * k);
    // Optical box: the star's thin points reach r above / 0.81r below the centre, but its
    // visible mass sits closer in, so spacing uses a slightly tighter box.
    const cy = bottom - size * 0.33;
    const width = drawStars(ctx, ticket.rating, x, cy, size, "#ffffff", "rgba(255,255,255,0.26)");
    const digits = ink(ratingFont, "4.5");
    ctx.fillStyle = "#ffffff";
    ctx.font = ratingFont;
    ctx.fillText(ratingText(ticket.rating), x + width + 18, cy + (digits.asc - digits.desc) / 2);
    bottom = cy - size * 0.4 - gap;
  }

  const titleInk = ink(titleFont);
  const lineHeight = Math.round(titleSize * 1.16);
  let baseline = bottom - titleInk.desc;
  ctx.fillStyle = "#ffffff";
  setTitleFont(ctx, titleSize);
  for (let i = titleLines.length - 1; i >= 0; i--) {
    ctx.fillText(titleLines[i], x, baseline);
    if (i) baseline -= lineHeight;
  }
  ctx.letterSpacing = "0px";

  const dayBaseline = baseline - titleInk.asc - gap - ink(dayFont, "1").desc;
  const day = d ? `${Number(d.mm)}월 ${Number(d.dd)}일` : ticket.date;
  ctx.fillStyle = "#ffffff";
  ctx.font = dayFont;
  ctx.fillText(day, x, dayBaseline);
  const dayWidth = ctx.measureText(day).width;
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = restFont;
  ctx.fillText(d ? `${d.ko}요일  ${ticket.time}` : ticket.time, x + dayWidth + 18 * k, dayBaseline);
}

function drawTicketStyle(ctx, ticket, poster, seed) {
  drawBlurredBackdrop(ctx, poster, "#cbc4b7");
  grain(ctx, 0.1);

  const tw = 720;
  const tx = (W - tw) / 2;
  const pad = 64;
  const inner = tw - pad * 2;
  const d = dateParts(ticket.date);
  setTitleFont(ctx, 70);
  const titleLines = wrapLines(ctx, ticket.title, inner, 3);
  ctx.letterSpacing = "0px";
  const rows = [["극장", ticket.venue], ["상영관", ticket.screen], ["시간", ticket.time]].filter(([, value]) => value);
  const ratingH = ticket.rating ? 76 : 0;
  const bodyH = 150 + titleLines.length * 84 + ratingH + 44 + rows.length * 78 + 40;
  const stubH = 190;
  const th = bodyH + stubH;
  const ty = Math.round(SAFE_TOP + (SAFE_BOTTOM - SAFE_TOP - th) / 2);
  const cutY = ty + bodyH;

  const layer = document.createElement("canvas");
  layer.width = W;
  layer.height = H;
  const lc = layer.getContext("2d");
  lc.fillStyle = PAPER;
  roundRectPath(lc, tx, ty, tw, th, 10);
  lc.fill();
  lc.save();
  lc.clip();
  grain(lc, 0.18);
  lc.restore();

  lc.fillStyle = "rgba(29,27,24,0.55)";
  lc.font = `600 22px ${SANS}`;
  drawTracked(lc, d ? `${d.yyyy}.${d.mm}.${d.dd} ${d.en}` : ticket.date, tx + pad, ty + 86, 3);
  drawTracked(lc, `NO. ${String(seed % 100000).padStart(5, "0")}`, tx + tw - pad, ty + 86, 3, "right");
  lc.fillStyle = INK;
  lc.fillRect(tx + pad, ty + 112, inner, 3);

  let y = ty + 150 + 56;
  setTitleFont(lc, 70);
  for (const line of titleLines) {
    lc.fillText(line, tx + pad, y);
    y += 84;
  }
  y -= 84;
  lc.letterSpacing = "0px";
  if (ticket.rating) {
    const width = drawStars(lc, ticket.rating, tx + pad, y + 56, 36, INK, "rgba(29,27,24,0.16)");
    lc.fillStyle = INK;
    lc.font = `700 28px ${SANS}`;
    lc.fillText(ratingText(ticket.rating), tx + pad + width + 16, y + 66);
    y += ratingH;
  }
  y += 44;
  for (const [label, value] of rows) {
    lc.fillStyle = "rgba(29,27,24,0.16)";
    lc.fillRect(tx + pad, y, inner, 2);
    lc.fillStyle = "rgba(29,27,24,0.55)";
    lc.font = `500 26px ${SANS}`;
    lc.textAlign = "left";
    lc.fillText(label, tx + pad, y + 50);
    lc.fillStyle = INK;
    lc.font = `700 30px ${SANS}`;
    lc.textAlign = "right";
    lc.fillText(value, tx + tw - pad, y + 51);
    lc.textAlign = "left";
    y += 78;
  }

  // perforation: punched notches plus a row of dots
  lc.globalCompositeOperation = "destination-out";
  for (const x of [tx, tx + tw]) {
    lc.beginPath();
    lc.arc(x, cutY, 26, 0, Math.PI * 2);
    lc.fill();
  }
  lc.globalCompositeOperation = "source-over";
  lc.fillStyle = "rgba(29,27,24,0.28)";
  for (let x = tx + 48; x <= tx + tw - 48; x += 18) {
    lc.beginPath();
    lc.arc(x, cutY, 3, 0, Math.PI * 2);
    lc.fill();
  }

  lc.fillStyle = INK;
  lc.textAlign = "center";
  lc.font = `700 30px ${SANS}`;
  lc.fillText("서울독립영화관시간표", W / 2, cutY + 96);
  lc.fillStyle = "rgba(29,27,24,0.5)";
  lc.font = `500 20px ${SANS}`;
  drawTracked(lc, "SEOULCINEMASCHEDULE.COM", W / 2, cutY + 138, 3, "center");
  lc.textAlign = "left";

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.2)";
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 14;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

function zigzagPath(ctx, x, y, w, h, tooth) {
  const count = Math.round(w / tooth);
  const step = w / count;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 0; i < count; i++) {
    ctx.lineTo(x + step * (i + 0.5), y - tooth / 2);
    ctx.lineTo(x + step * (i + 1), y);
  }
  ctx.lineTo(x + w, y + h);
  for (let i = count - 1; i >= 0; i--) {
    ctx.lineTo(x + step * (i + 0.5), y + h + tooth / 2);
    ctx.lineTo(x + step * i, y + h);
  }
  ctx.closePath();
}

function drawReceiptStyle(ctx, ticket, poster, seed) {
  drawBlurredBackdrop(ctx, poster, "#d6d0c5");
  grain(ctx, 0.1);

  const rw = 640;
  const rx = (W - rw) / 2;
  const pad = 56;
  const inner = rw - pad * 2;
  const d = dateParts(ticket.date);
  setTitleFont(ctx, 54);
  const titleLines = wrapLines(ctx, ticket.title, inner, 3);
  ctx.letterSpacing = "0px";
  const rows = [["극장", ticket.venue], ["상영관", ticket.screen], ["시간", ticket.time]].filter(([, value]) => value);
  const rh = 232 + titleLines.length * 66 + (ticket.rating ? 70 : 0) + 70 + rows.length * 52 + 134 + 250;
  const ry = Math.round(SAFE_TOP + (SAFE_BOTTOM - SAFE_TOP - rh) / 2);

  const layer = document.createElement("canvas");
  layer.width = W;
  layer.height = H;
  const lc = layer.getContext("2d");
  lc.fillStyle = "#fbfaf6";
  zigzagPath(lc, rx, ry, rw, rh, 22);
  lc.fill();
  lc.save();
  lc.clip();
  grain(lc, 0.14);
  lc.restore();

  const dashed = (y) => {
    lc.fillStyle = "rgba(29,27,24,0.45)";
    for (let x = rx + pad; x < rx + rw - pad; x += 14) lc.fillRect(x, y, 7, 2);
  };
  const row = (label, value, y, bold = false) => {
    lc.fillStyle = bold ? INK : "rgba(29,27,24,0.62)";
    lc.font = `${bold ? 800 : 500} ${bold ? 32 : 26}px ${SANS}`;
    lc.textAlign = "left";
    lc.fillText(label, rx + pad, y);
    lc.fillStyle = INK;
    lc.font = `${bold ? 800 : 600} ${bold ? 32 : 26}px ${SANS}`;
    lc.textAlign = "right";
    lc.fillText(value, rx + rw - pad, y);
    lc.textAlign = "left";
  };

  const cx = W / 2;
  let y = ry + 96;
  lc.textAlign = "center";
  lc.fillStyle = INK;
  lc.font = `700 32px ${SANS}`;
  lc.fillText("서울독립영화관시간표", cx, y);
  y += 44;
  lc.fillStyle = "rgba(29,27,24,0.55)";
  lc.font = `500 20px ${SANS}`;
  drawTracked(lc, "SEOULCINEMASCHEDULE.COM", cx, y, 3, "center");
  y += 56;
  lc.font = `500 24px ${SANS}`;
  lc.fillStyle = "rgba(29,27,24,0.7)";
  lc.textAlign = "center";
  lc.fillText(d ? `${d.yyyy}-${d.mm}-${d.dd} (${d.ko})` : ticket.date, cx, y);
  y += 36;
  dashed(y);

  lc.fillStyle = INK;
  setTitleFont(lc, 54);
  lc.textAlign = "center";
  y += 22;
  for (const line of titleLines) {
    y += 66;
    lc.fillText(line, cx, y);
  }
  lc.letterSpacing = "0px";
  if (ticket.rating) {
    drawStars(lc, ticket.rating, cx, y + 50, 34, INK, "rgba(29,27,24,0.16)", "center");
    y += 70;
  }
  y += 44;
  dashed(y);
  y += 26;
  for (const [label, value] of rows) {
    y += 52;
    row(label, value, y - 12);
  }
  y += 30;
  dashed(y);
  y += 62;
  row("TOTAL", "1편", y, true);
  y += 42;
  dashed(y);

  // barcode
  y += 46;
  let bx = cx - 190;
  let bits = seed;
  lc.fillStyle = INK;
  while (bx < cx + 186) {
    const width = 2 + (bits & 3) * 1.5;
    bits = (bits >>> 2) | ((bits & 3) << 30);
    lc.fillRect(bx, y, width, 84);
    bx += width + 4 + ((bits >>> 7) & 1) * 3;
  }
  y += 128;
  lc.fillStyle = "rgba(29,27,24,0.55)";
  lc.font = `600 20px ${SANS}`;
  drawTracked(lc, "THANK YOU FOR WATCHING", cx, y, 4, "center");
  lc.textAlign = "left";

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.22)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 20;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

/**
 * @param {{ title: string, venue: string, screen?: string, date: string, time: string, rating?: number, posterUrl?: string, id?: string }} ticket
 * @param {keyof typeof ticketStyles} styleKey
 */
export async function drawStoryTicket(ticket, styleKey = "poster", options = {}) {
  const fontLoads = [`700 84px ${SANS}`, `600 32px ${SANS}`, `500 36px ${SANS}`, `400 36px ${BRAND}`].map((font) =>
    document.fonts?.load(font, `${ticket.title}${ticket.venue}${ticket.screen || ""}서울독립영화관시간표극장상영관시간좌석편월일화수목금토요0123456789.:·TOTALSEOUL`).catch(() => null)
  );
  const [poster] = await Promise.all([loadPoster(ticket.posterUrl), ...fontLoads]);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";
  const seed = hash(`${ticket.id}${ticket.title}`);
  if (styleKey === "ticket") drawTicketStyle(ctx, ticket, poster, seed);
  else if (styleKey === "receipt") drawReceiptStyle(ctx, ticket, poster, seed);
  else drawPosterStyle(ctx, ticket, poster, options);
  return canvas;
}
