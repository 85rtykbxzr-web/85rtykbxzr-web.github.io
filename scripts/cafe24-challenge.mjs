import { createDecipheriv } from "node:crypto";

// These official cinema hosts return a small CUPID cookie challenge to cloud visitors.
// Decode only its known AES-CBC fields; never execute downloaded JavaScript.
export function readCafe24Challenge(html, requestUrl) {
  const origin = new URL(requestUrl);
  const allowedHosts = new Set(["www.cinematheque.seoul.kr", "www.arthousemomo.co.kr", "arthousemomo.co.kr"]);
  if (!allowedHosts.has(origin.hostname) || !html.includes("/cupid.js")) return null;
  const values = [...html.matchAll(/\b[abc]=toNumbers\("([a-f0-9]{32})"\)/gi)].map((match) => match[1]);
  const redirect = html.match(/location\.href="([^"]+)"/)?.[1];
  if (values.length !== 3 || !redirect || !html.includes('document.cookie="CUPID="')) {
    throw new Error("Unrecognized cinema browser challenge");
  }
  const target = new URL(redirect, origin);
  if (target.origin !== origin.origin || target.pathname !== origin.pathname || target.searchParams.get("ckattempt") !== "1") {
    throw new Error("Cinema browser challenge redirected outside the requested page");
  }
  const decipher = createDecipheriv("aes-128-cbc", Buffer.from(values[0], "hex"), Buffer.from(values[1], "hex"));
  decipher.setAutoPadding(false);
  let decoded = Buffer.concat([decipher.update(Buffer.from(values[2], "hex")), decipher.final()]);
  const padding = decoded.at(-1);
  if (padding > 0 && padding <= 16 && decoded.subarray(-padding).every((byte) => byte === padding)) decoded = decoded.subarray(0, -padding);
  if (!decoded.length) throw new Error("Cinema browser challenge returned an empty cookie");
  return { url: target.href, cookie: `CUPID=${decoded.toString("hex")}` };
}
