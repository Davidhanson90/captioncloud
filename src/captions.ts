/** Tim Urban, TED — confirmed English captions on 2026-10-04. */
export const DEMO_VIDEO_ID = "arj7oStGLkU";

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export interface CaptionCue {
  /** Cue start, seconds. */
  start: number;
  /** Cue end, seconds. Same as start when the track omits a duration. */
  end: number;
  /** Raw cue text, before word cleanup. */
  text: string;
}

export interface LoadedCaptions {
  videoId: string;
  title: string;
  languageCode: string;
  languageName: string;
  text: string;
  /** Timed cues when the track has them. Omitted for pasted text. */
  cues?: CaptionCue[];
}

export function parseVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (ID_RE.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return ID_RE.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v && ID_RE.test(v)) return v;
    const parts = url.pathname.split("/").filter(Boolean);
    const marker = parts.findIndex((p) => p === "embed" || p === "shorts" || p === "live" || p === "v");
    if (marker >= 0 && parts[marker + 1] && ID_RE.test(parts[marker + 1])) return parts[marker + 1];
  }
  return null;
}

interface NullOriginOk {
  nonce: string;
  ok: true;
  title: string;
  languageCode: string;
  languageName: string;
  body: string;
}

interface NullOriginErr {
  nonce: string;
  ok: false;
  error: "no-captions" | "empty" | "blocked" | "network";
  detail?: string;
}

type NullOriginMsg = NullOriginOk | NullOriginErr;

/**
 * YouTube's timedtext endpoint reflects Access-Control-Allow-Origin, but an
 * unsigned `v=&lang=` request comes back empty. The signed track URL lives on
 * the ANDROID Innertube player response. That response is readable from a
 * sandboxed iframe (opaque origin): YouTube answers `Origin: null` with
 * `Access-Control-Allow-Origin: null`. A normal page origin is rejected.
 * `text/plain` avoids a preflight OPTIONS that YouTube answers with 403.
 */
const CHILD_SCRIPT = `
const videoId = __VIDEO_ID__;
const nonce = __NONCE__;
function post(msg){ parent.postMessage(Object.assign({ nonce: nonce }, msg), "*"); }
function trackLabel(track){
  const name = track && track.name;
  if (!name) return track.languageCode || "";
  if (typeof name.simpleText === "string" && name.simpleText) return name.simpleText;
  if (Array.isArray(name.runs)) return name.runs.map(function(r){ return r.text || ""; }).join("");
  return track.languageCode || "";
}
function looksLikeCaptions(body){
  const s = (body || "").trim();
  if (s.length < 20) return false;
  if (s.indexOf("wireMagic") !== -1) return true;
  if (s.indexOf("<text") !== -1 || s.indexOf("<p ") !== -1 || s.indexOf("<p>") !== -1) return true;
  return false;
}
function withJson3(baseUrl){
  const u = new URL(baseUrl);
  u.searchParams.delete("fmt");
  u.searchParams.set("fmt", "json3");
  return u.toString();
}
function pickTrack(tracks){
  var i;
  for (i = 0; i < tracks.length; i++) {
    if (tracks[i].languageCode === "en" && tracks[i].kind !== "asr") return tracks[i];
  }
  for (i = 0; i < tracks.length; i++) {
    var code = (tracks[i].languageCode || "").toLowerCase();
    if (code === "en" || code.indexOf("en-") === 0) return tracks[i];
  }
  return tracks[0];
}
async function readTrack(track, title){
  if (!track || !track.baseUrl) {
    post({ ok: false, error: "no-captions" });
    return;
  }
  const res = await fetch(withJson3(track.baseUrl));
  const body = await res.text();
  if (!res.ok || !looksLikeCaptions(body)) {
    post({ ok: false, error: "empty", detail: "signed track " + res.status + " len " + body.length });
    return;
  }
  post({
    ok: true,
    title: title || "",
    languageCode: track.languageCode || "",
    languageName: trackLabel(track) || track.languageCode || "",
    body: body
  });
}
(async function(){
  try {
    const direct = await fetch("https://www.youtube.com/api/timedtext?v=" + encodeURIComponent(videoId) + "&lang=en&fmt=json3");
    const directBody = await direct.text();
    if (looksLikeCaptions(directBody)) {
      post({ ok: true, title: "", languageCode: "en", languageName: "English", body: directBody });
      return;
    }
    const player = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({
        context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34, hl: "en", gl: "US" } },
        videoId: videoId
      })
    });
    const raw = await player.text();
    if (!player.ok || raw.indexOf("<html") === 0 || raw.indexOf("<HTML") === 0 || raw.indexOf("Sorry") === 0) {
      post({ ok: false, error: "blocked", detail: "player " + player.status });
      return;
    }
    var data;
    try { data = JSON.parse(raw); } catch (e) {
      post({ ok: false, error: "blocked", detail: "player not json" });
      return;
    }
    const tracks = (((data.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks) || [];
    if (!tracks.length) {
      const status = (data.playabilityStatus || {}).status || "";
      const reason = (data.playabilityStatus || {}).reason || "";
      post({ ok: false, error: "no-captions", detail: status + " " + reason });
      return;
    }
    const title = (data.videoDetails && data.videoDetails.title) || "";
    await readTrack(pickTrack(tracks), title);
  } catch (err) {
    post({ ok: false, error: "network", detail: String(err) });
  }
})();
`;

function nullOriginSrcdoc(videoId: string, nonce: string): string {
  const script = CHILD_SCRIPT
    .replace("__VIDEO_ID__", JSON.stringify(videoId))
    .replace("__NONCE__", JSON.stringify(nonce));
  return `<!doctype html><meta charset="utf-8"><script>${script}<\/script>`;
}

function fetchViaNullOrigin(videoId: string): Promise<NullOriginOk> {
  const nonce = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
    let settled = false;
    const timer = window.setTimeout(() => finish(new Error("timed out waiting for captions")), 25000);
    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      frame.remove();
    }
    function finish(err: Error | null, value?: NullOriginOk) {
      if (settled) return;
      settled = true;
      cleanup();
      if (err || !value) reject(err ?? new Error("caption load failed"));
      else resolve(value);
    }
    function onMessage(ev: MessageEvent) {
      if (ev.source !== frame.contentWindow) return;
      const data = ev.data as Partial<NullOriginMsg> | null;
      if (!data || data.nonce !== nonce || typeof data.ok !== "boolean") return;
      if (data.ok) {
        finish(null, data as NullOriginOk);
        return;
      }
      const failed = data as NullOriginErr;
      if (failed.error === "no-captions") {
        finish(new Error("This video has no caption track."));
        return;
      }
      if (failed.error === "empty") {
        finish(new Error("YouTube returned an empty caption track."));
        return;
      }
      if (failed.error === "blocked") {
        finish(new Error("YouTube blocked the caption request from this browser."));
        return;
      }
      finish(new Error("Couldn't reach YouTube for captions."));
    }
    window.addEventListener("message", onMessage);
    frame.srcdoc = nullOriginSrcdoc(videoId, nonce);
    document.body.appendChild(frame);
  });
}

async function fetchOEmbedTitle(videoId: string): Promise<string> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`
    );
    if (!res.ok) return "";
    const data = (await res.json()) as { title?: string };
    return data.title ?? "";
  } catch {
    return "";
  }
}

export async function loadYouTubeCaptions(videoId: string): Promise<LoadedCaptions> {
  const [loaded, oembedTitle] = await Promise.all([fetchViaNullOrigin(videoId), fetchOEmbedTitle(videoId)]);
  const text = captionsToText(loaded.body);
  if (!text) throw new Error("This video's caption track had no words.");
  const cues = parseCaptionCues(loaded.body);
  return {
    videoId,
    title: loaded.title || oembedTitle,
    languageCode: loaded.languageCode,
    languageName: loaded.languageName || loaded.languageCode,
    text,
    ...(cues.length ? { cues } : {})
  };
}

/** Cue timings from a json3 or timed-text body. Empty when the body has no timestamps. */
export function parseCaptionCues(body: string): CaptionCue[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.includes('"wireMagic"')) {
    try {
      const cues = json3Cues(trimmed);
      if (cues.length) return cues;
    } catch {
      /* XML */
    }
  }
  return xmlCues(trimmed);
}

function json3Cues(raw: string): CaptionCue[] {
  const data = JSON.parse(raw) as {
    events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[];
  };
  const cues: CaptionCue[] = [];
  for (const event of data.events ?? []) {
    if (typeof event.tStartMs !== "number" || !event.segs?.length) continue;
    const text = event.segs.map((seg) => seg.utf8 ?? "").join("");
    if (!text.trim()) continue;
    const start = Math.max(0, event.tStartMs / 1000);
    const dur = typeof event.dDurationMs === "number" ? Math.max(0, event.dDurationMs / 1000) : 0;
    cues.push({ start, end: start + dur, text });
  }
  return cues;
}

function xmlCues(raw: string): CaptionCue[] {
  const doc = new DOMParser().parseFromString(raw, "text/xml");
  if (doc.querySelector("parsererror")) return [];
  const cues: CaptionCue[] = [];
  for (const node of doc.querySelectorAll("text, p")) {
    const text = node.textContent ?? "";
    if (!text.trim()) continue;
    const timed = xmlCueTiming(node);
    if (!timed) continue;
    cues.push({ start: timed.start, end: timed.end, text });
  }
  return cues;
}

function xmlCueTiming(node: Element): { start: number; end: number } | null {
  if (node.hasAttribute("t")) {
    const start = numberAttr(node, "t");
    if (start == null) return null;
    const dur = numberAttr(node, "d") ?? 0;
    const startSec = Math.max(0, start / 1000);
    return { start: startSec, end: startSec + Math.max(0, dur) / 1000 };
  }
  const start = numberAttr(node, "start");
  if (start == null) return null;
  const dur = numberAttr(node, "dur") ?? 0;
  const startSec = Math.max(0, start);
  return { start: startSec, end: startSec + Math.max(0, dur) };
}

function numberAttr(node: Element, name: string): number | null {
  const raw = node.getAttribute(name);
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function captionsToText(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{") || trimmed.includes('"wireMagic"')) {
    try {
      const text = cleanCaptionText(json3ToText(trimmed));
      if (text) return text;
    } catch {
      /* try XML */
    }
  }
  return cleanCaptionText(xmlToText(trimmed));
}

function json3ToText(raw: string): string {
  const data = JSON.parse(raw) as { events?: { segs?: { utf8?: string }[] }[] };
  const parts: string[] = [];
  for (const event of data.events ?? []) {
    if (!event.segs) continue;
    parts.push(event.segs.map((seg) => seg.utf8 ?? "").join(""));
  }
  return parts.join(" ");
}

function xmlToText(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, "text/xml");
  if (doc.querySelector("parsererror")) return "";
  const nodes = [...doc.querySelectorAll("text, p")];
  return nodes.map((node) => node.textContent ?? "").join(" ");
}

const SOUND_CUE =
  /^(?:music|applause|laughter|laughs|cheering|cheer|inaudible|silence|blank_audio|noise|cough(?:ing)?|sigh(?:s)?|gasps?|clapping|background noise|upbeat music|soft music)$/i;

function soundOrKeep(inner: string): string {
  const t = inner.replace(/\s+/g, " ").trim();
  if (!t) return " ";
  if (SOUND_CUE.test(t)) return " ";
  if (/^(?:music|applause|laughter|cheering)\b/i.test(t) && t.length < 48) return " ";
  return ` ${t} `;
}

function decodeEntities(value: string): string {
  const el = document.createElement("textarea");
  el.innerHTML = value;
  return el.value;
}

/** Drop timestamps (already not in the text), tags, and stage-direction noise. */
export function cleanCaptionText(input: string): string {
  let text = input.replace(/\r/g, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/>>+/g, " ");
  text = text.replace(/\[([^\]]*)\]/g, (_match, inner: string) => soundOrKeep(inner));
  text = text.replace(/\(([^)]*)\)/g, (_match, inner: string) => soundOrKeep(inner));
  return text.replace(/\s+/g, " ").trim();
}
