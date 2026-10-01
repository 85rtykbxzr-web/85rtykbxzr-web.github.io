// Draws a 1080x1920 "today's movie" ticket for Instagram stories on a canvas.
// Pure drawing: the caller passes the session details and gets a canvas back.

export const ticketThemes = {
  butter: { label: "버터", bgTop: "#fff7dc", bgBottom: "#ffe39a", accent: "#ff8a3d", ink: "#2b2620", sub: "#8a7d6b", onBg: "#2b2620", onBgSub: "#8a6f3a" },
  peach: { label: "피치", bgTop: "#ffeef2", bgBottom: "#ffc6d5", accent: "#ff5c8a", ink: "#2d2226", sub: "#8f7480", onBg: "#3a2229", onBgSub: "#a05a72" },
  mint: { label: "민트", bgTop: "#e8f8f1", bgBottom: "#b5e8d3", accent: "#25a57c", ink: "#1f2a26", sub: "#6c8279", onBg: "#1f3a31", onBgSub: "#3f7a65" },
  night: { label: "밤", bgTop: "#26252d", bgBottom: "#131217", accent: "#f5c86b", ink: "#22201c", sub: "#857c70", onBg: "#f5f1e8", onBgSub: "#b9b1a4" }
};

const W = 1080;
const H = 1920;
const SANS = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", sans-serif';
const BRAND = '"BM Kkubulim Brand", ' + SANS;
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

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

function sparkle(ctx, x, y, size, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.quadraticCurveTo(x, y, x + size, y);
  ctx.quadraticCurveTo(x, y, x, y + size);
  ctx.quadraticCurveTo(x, y, x - size, y);
  ctx.quadraticCurveTo(x, y, x, y - size);
  ctx.fill();
  ctx.restore();
}

// Popcorn-bucket mascot peeking over the ticket edge: body first (the ticket covers it),
// then the little hands gripping the edge are drawn after the ticket.
function drawMascotBody(ctx, cx, edgeY, theme) {
  const top = edgeY - 170;
  const topW = 230;
  const bottomW = 190;
  const h = 260;
  ctx.save();
  // popcorn puffs
  const puffs = [[-80, -8, 44], [-30, -34, 50], [28, -30, 48], [80, -6, 42], [0, -2, 46], [-55, 18, 38], [56, 18, 38]];
  for (const [dx, dy, r] of puffs) {
    ctx.beginPath();
    ctx.arc(cx + dx, top + dy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#fff6d6";
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#2b2620";
    ctx.stroke();
  }
  // bucket with stripes
  ctx.beginPath();
  ctx.moveTo(cx - topW / 2, top + 20);
  ctx.lineTo(cx + topW / 2, top + 20);
  ctx.lineTo(cx + bottomW / 2, top + h);
  ctx.lineTo(cx - bottomW / 2, top + h);
  ctx.closePath();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(cx - topW / 2, top, topW, h + 20);
  ctx.fillStyle = theme === "mint" ? "#25a57c" : "#ff5a5f";
  for (let i = -3; i <= 3; i += 2) {
    ctx.beginPath();
    ctx.moveTo(cx + i * 28 - 14, top + 20);
    ctx.lineTo(cx + i * 28 + 14, top + 20);
    ctx.lineTo(cx + i * 23 + 12, top + h);
    ctx.lineTo(cx + i * 23 - 12, top + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.lineWidth = 7;
  ctx.strokeStyle = "#2b2620";
  ctx.stroke();
  // face (sits above the ticket edge)
  const faceY = top + 92;
  ctx.fillStyle = "#ffffff";
  roundRectPath(ctx, cx - 78, faceY - 44, 156, 96, 40);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = "#2b2620";
  for (const dx of [-34, 34]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx, faceY - 6, 9, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + dx + 3, faceY - 10, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.fillStyle = "#2b2620";
  }
  ctx.fillStyle = "rgba(255, 120, 140, 0.55)";
  for (const dx of [-56, 56]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx, faceY + 16, 14, 9, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.arc(cx, faceY + 8, 14, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

function drawMascotHands(ctx, cx, edgeY) {
  ctx.save();
  for (const dx of [-70, 70]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx, edgeY + 4, 24, 18, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#2b2620";
    ctx.stroke();
  }
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

function drawCover(ctx, image, x, y, w, h) {
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
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

/**
 * @param {{ title: string, venue: string, screen?: string, date: string, time: string, seat?: string, posterUrl?: string, id?: string }} ticket
 * @param {keyof typeof ticketThemes} themeKey
 */
export async function drawStoryTicket(ticket, themeKey = "butter") {
  const theme = ticketThemes[themeKey] || ticketThemes.butter;
  const fontLoads = [
    `800 64px ${SANS}`, `700 40px ${SANS}`, `600 34px ${SANS}`, `400 44px ${BRAND}`
  ].map((font) => document.fonts?.load(font, `${ticket.title}${ticket.venue}${ticket.screen || ""}서울독립영화관시간표0123456789.:TODAY`).catch(() => null));
  const [loaded] = await Promise.all([loadImage(ticket.posterUrl), ...fontLoads]);
  const poster = loaded && posterIsExportable(loaded) ? loaded : null;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, theme.bgTop);
  bg.addColorStop(1, theme.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const seed = hash(`${ticket.id}${ticket.title}`);
  for (let i = 0; i < 9; i++) {
    const x = 60 + ((seed >> (i * 3)) % 960);
    const y = 120 + ((seed >> (i * 2 + 1)) % 1700);
    if (y > 360 && y < 1600 && x > 110 && x < 970) continue;
    sparkle(ctx, x, y, 10 + (i % 3) * 8, i % 2 ? theme.accent : "rgba(255,255,255,0.9)");
  }

  // header
  const date = new Date(`${ticket.date}T00:00:00`);
  const dateText = Number.isNaN(date.getTime())
    ? ticket.date
    : `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} ${WEEKDAYS[date.getDay()]}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = theme.accent;
  ctx.font = `800 30px ${SANS}`;
  ctx.fillText("TODAY'S MOVIE", 130, 200);
  ctx.fillStyle = theme.onBg;
  ctx.font = `800 72px ${SANS}`;
  ctx.fillText(dateText, 130, 282);

  const tx = 130;
  const ty = 420;
  const tw = 820;
  const th = 1140;
  const mascotX = tx + tw - 190;

  drawMascotBody(ctx, mascotX, ty, themeKey);

  // ticket on its own layer so the side notches can be punched out
  const layer = document.createElement("canvas");
  layer.width = W;
  layer.height = H;
  const lc = layer.getContext("2d");
  lc.shadowColor = "rgba(40, 30, 20, 0.18)";
  lc.shadowBlur = 40;
  lc.shadowOffsetY = 18;
  lc.fillStyle = "#fffdf8";
  roundRectPath(lc, tx, ty, tw, th, 44);
  lc.fill();
  lc.shadowColor = "transparent";

  // poster window
  const px = tx + 40;
  const py = ty + 40;
  const pw = tw - 80;
  const ph = 560;
  lc.save();
  roundRectPath(lc, px, py, pw, ph, 28);
  lc.clip();
  lc.fillStyle = theme.accent;
  lc.fillRect(px, py, pw, ph);
  if (poster) {
    drawCover(lc, poster, px, py, pw, ph);
  } else {
    lc.fillStyle = "rgba(255,255,255,0.22)";
    for (let i = 0; i < 9; i++) {
      roundRectPath(lc, px + 28 + i * 84, py + 26, 40, 28, 8);
      lc.fill();
      roundRectPath(lc, px + 28 + i * 84, py + ph - 54, 40, 28, 8);
      lc.fill();
    }
    lc.fillStyle = "#ffffff";
    lc.font = `800 54px ${SANS}`;
    lc.textAlign = "center";
    lc.fillText("NOW SHOWING", px + pw / 2, py + ph / 2 + 18);
    lc.textAlign = "left";
  }
  lc.restore();

  // title + venue
  lc.fillStyle = theme.ink;
  lc.font = `800 64px ${SANS}`;
  const titleLines = wrapLines(lc, ticket.title, pw, 2);
  titleLines.forEach((line, index) => lc.fillText(line, px, py + ph + 96 + index * 78));
  const afterTitle = py + ph + 96 + (titleLines.length - 1) * 78;
  lc.fillStyle = theme.sub;
  lc.font = `600 34px ${SANS}`;
  lc.fillText([ticket.venue, ticket.screen].filter(Boolean).join(" · "), px, afterTitle + 58);

  // perforation + stub
  const cutY = ty + th - 230;
  lc.globalCompositeOperation = "destination-out";
  for (const x of [tx, tx + tw]) {
    lc.beginPath();
    lc.arc(x, cutY, 32, 0, Math.PI * 2);
    lc.fill();
  }
  lc.globalCompositeOperation = "source-over";
  lc.strokeStyle = "#e6dfd2";
  lc.lineWidth = 4;
  lc.setLineDash([14, 14]);
  lc.beginPath();
  lc.moveTo(tx + 50, cutY);
  lc.lineTo(tx + tw - 50, cutY);
  lc.stroke();
  lc.setLineDash([]);

  const infoY = cutY - 150;
  const columns = [["DATE", ticket.date.replaceAll("-", ".").slice(2)], ["TIME", ticket.time], ["SEAT", ticket.seat || "—"]];
  columns.forEach(([label, value], index) => {
    const x = px + index * (pw / 3);
    lc.fillStyle = theme.accent;
    lc.font = `800 24px ${SANS}`;
    lc.fillText(label, x, infoY);
    lc.fillStyle = theme.ink;
    lc.font = `800 44px ${SANS}`;
    lc.fillText(value, x, infoY + 58);
  });

  lc.fillStyle = theme.ink;
  lc.font = `800 34px ${SANS}`;
  lc.fillText("ADMIT ONE", px, cutY + 110);
  lc.fillStyle = theme.sub;
  lc.font = `600 24px ${SANS}`;
  lc.fillText(`No. ${String(seed % 10000).padStart(4, "0")}`, px, cutY + 152);
  // barcode
  let bx = tx + tw - 60;
  let bits = seed;
  lc.fillStyle = theme.ink;
  for (let i = 0; i < 34; i++) {
    const width = 2 + (bits & 3) * 2;
    bits = (bits >>> 2) | ((bits & 3) << 30);
    bx -= width + 5;
    lc.fillRect(bx, cutY + 66, width, 96);
  }

  ctx.drawImage(layer, 0, 0);
  drawMascotHands(ctx, mascotX, ty);

  // footer
  ctx.textAlign = "center";
  ctx.fillStyle = theme.onBg;
  ctx.font = `400 46px ${BRAND}`;
  ctx.fillText("서울독립영화관시간표", W / 2, 1720);
  ctx.fillStyle = theme.onBgSub;
  ctx.font = `600 26px ${SANS}`;
  ctx.fillText("seoulcinemaschedule.com", W / 2, 1772);
  return canvas;
}
