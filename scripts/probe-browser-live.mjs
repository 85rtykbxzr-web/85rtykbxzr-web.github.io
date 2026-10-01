// Temporary diagnostic: how each browser-collected venue answers, as a browser on the site would see it.
import { browserLiveConfigs, browserApiOrigin, fetchBrowserVenue } from "../src/browser-live-schedule.mjs";

const origin = "https://seoulcinemaschedule.com";
for (const config of browserLiveConfigs) {
  const params = new URLSearchParams({ BrandCd: config.brandCd, CinemaCd: config.cinemaCd, ChannelCd: "homepage", WorkGuID: config.dateGuid || config.workGuid, EngVerYn: "N", MovieCd: "" });
  const url = `${browserApiOrigin}/dtryx/cms/thirdparty/movie/third-party-type2-timetable-play-date-list?${params}`;
  const line = { venue: config.name };
  try {
    const started = Date.now();
    const response = await fetch(url, { headers: { origin, referer: `${origin}/` }, signal: AbortSignal.timeout(15000) });
    line.status = response.status;
    line.ms = Date.now() - started;
    line.acao = response.headers.get("access-control-allow-origin");
    const text = await response.text();
    line.body = text.slice(0, 160);
    const pre = await fetch(url, { method: "OPTIONS", headers: { origin, "access-control-request-method": "GET" }, signal: AbortSignal.timeout(15000) }).catch((e) => ({ status: `ERR ${e.message}`, headers: new Headers() }));
    line.preflight = `${pre.status} ${pre.headers.get("access-control-allow-origin")}`;
  } catch (error) {
    line.error = `${error.name}: ${error.message} ${error.cause?.code || ""}`;
  }
  try {
    const result = await fetchBrowserVenue(config);
    line.collect = `ok ${result.sessions.length} sessions`;
  } catch (error) {
    line.collect = `FAIL ${error.message} ${error.cause?.code || ""}`;
  }
  console.log(JSON.stringify(line));
}
