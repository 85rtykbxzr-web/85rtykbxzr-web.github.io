// Draws a 1080x1920 "today's movie" image for Instagram stories on a canvas.
// Pure drawing: the caller passes the session details and gets a canvas back.

const W = 1080;
const H = 1920;
const SANS = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", sans-serif';
const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];
// Instagram covers roughly the bottom 20% of a story with the reply bar, so the text
// block ends above this line.
const SAFE_BOTTOM = H - 400;

// Pretendard is tight by design at display sizes; a little negative tracking keeps titles crisp.
function setTitleFont(ctx, size) {
  ctx.font = `700 ${size}px ${SANS}`;
  ctx.letterSpacing = `${-Math.round(size * 0.025)}px`;
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

function dateParts(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return {
    yyyy: String(date.getFullYear()),
    mm: String(date.getMonth() + 1).padStart(2, "0"),
    dd: String(date.getDate()).padStart(2, "0"),
    ko: WEEKDAYS_KO[date.getDay()]
  };
}

function drawPosterStyle(ctx, ticket, poster, { typeScale: k = 1.05, gap: baseGap = 26, starColor = "#ffffff" } = {}) {
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
    const width = drawStars(ctx, ticket.rating, x, cy, size, starColor, "rgba(255,255,255,0.26)");
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

/**
 * @param {{ title: string, venue: string, screen?: string, date: string, time: string, rating?: number, posterUrl?: string }} ticket
 * @param {{ typeScale?: number, gap?: number, starColor?: string }} [options]
 */
export async function drawStoryTicket(ticket, options = {}) {
  const fontLoads = [`700 84px ${SANS}`, `600 32px ${SANS}`, `500 36px ${SANS}`].map((font) =>
    document.fonts?.load(font, `${ticket.title}${ticket.venue}${ticket.screen || ""}월일화수목금토요0123456789.:·`).catch(() => null)
  );
  const [poster] = await Promise.all([loadPoster(ticket.posterUrl), ...fontLoads]);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";
  drawPosterStyle(ctx, ticket, poster, options);
  return canvas;
}
