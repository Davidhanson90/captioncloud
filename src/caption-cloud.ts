/// <reference types="vite/client" />
import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { DEMO_VIDEO_ID, cleanCaptionText, loadYouTubeCaptions, parseVideoId, type LoadedCaptions } from "./captions";
import { layoutCloud, type PlacedWord } from "./cloud-layout";
import { captionInsights, formatClock, type CaptionInsights, type QuietGap, type RepeatedPhrase } from "./insights";
import { firstSeenWords, previewText, wordStats, type WordCount } from "./words";


const CLOUD_FAMILY = "ui-sans-serif, system-ui, sans-serif";

/** Absolute URL for this deployment, using Vite's base (`/captioncloud/` in dev and on Pages). */
export function shareUrl(videoId: string): string {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin);
  url.searchParams.set("v", videoId);
  return url.href;
}

/** YouTube watch page. Adds `&t=` only when a seek time is already known. */
export function youtubeWatchUrl(videoId: string, seconds?: number | null): string {
  const base = `https://www.youtube.com/watch?v=${videoId}`;
  if (seconds == null || !Number.isFinite(seconds)) return base;
  return `${base}&t=${Math.max(0, Math.floor(seconds))}`;
}

function replaceVideoParam(videoId: string): void {
  const url = new URL(window.location.href);
  if (videoId) {
    if (url.searchParams.get("v") === videoId) return;
    url.searchParams.set("v", videoId);
  } else if (!url.searchParams.has("v")) {
    return;
  } else {
    url.searchParams.delete("v");
  }
  const qs = url.searchParams.toString();
  history.replaceState(null, "", `${url.pathname}${qs ? `?${qs}` : ""}${url.hash}`);
}

function setCloudFont(ctx: CanvasRenderingContext2D, fontSize: number, fontWeight: number, dpr: number): void {
  ctx.font = `${fontWeight} ${fontSize * dpr}px ${CLOUD_FAMILY}`;
  const tracking = fontSize >= 36 ? -0.02 * fontSize * dpr : 0;
  ctx.letterSpacing = `${tracking}px`;
}


function gapLabel(gap: QuietGap): string {
  const clock = formatClock(gap.at);
  const quiet = formatQuiet(gap.seconds);
  const bridge = [gap.before, gap.after].filter(Boolean).join(" → ");
  return bridge ? `${clock} · ${quiet} · ${bridge}` : `${clock} · ${quiet}`;
}

function phraseLabel(phrase: RepeatedPhrase): string {
  return `${phrase.count}× ${phrase.text} · ${formatClock(phrase.at)}`;
}

function formatQuiet(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}s quiet`;
}

@customElement("caption-cloud")
export class CaptionCloud extends LitElement {
  static override styles = css`
    :host {
      display: block;
      min-height: 100%;
      background: #0e1116;
      color: #e7edf4;
      font: 15px/1.45 ui-sans-serif, system-ui, sans-serif;
    }
    .wrap {
      max-width: 1200px;
      margin: 0 auto;
      padding: 22px 20px 40px;
      display: grid;
      gap: 16px;
    }
    h1 {
      margin: 0;
      font-size: 1.35rem;
      font-weight: 650;
      letter-spacing: -0.03em;
    }
    .hint,
    .meta,
    .status,
    .preview {
      margin: 0;
      color: #9aa8b8;
      font-size: 0.92rem;
    }
    .status.error {
      color: #ffb4a8;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }
    input[type="text"] {
      flex: 1 1 240px;
      min-width: 0;
      font: inherit;
      color: #e7edf4;
      background: #1a2330;
      border: 1px solid #2c3a4d;
      border-radius: 8px;
      padding: 8px 12px;
    }
    button {
      font: inherit;
      color: #e7edf4;
      background: #1a2330;
      border: 1px solid #2c3a4d;
      border-radius: 8px;
      padding: 8px 12px;
      cursor: pointer;
    }
    button.primary {
      background: #24344a;
      border-color: #3d5c86;
    }
    button:disabled {
      opacity: 0.45;
      cursor: default;
    }
    button.copied {
      border-color: #3d8f62;
      color: #b7f0c2;
    }
    .title {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 600;
    }
    .thumb-link {
      display: block;
      width: fit-content;
      max-width: 100%;
      border-radius: 12px;
    }
    .thumb-link:focus-visible {
      outline: 2px solid #8eb4e8;
      outline-offset: 3px;
    }
    .thumb {
      display: block;
      width: 100%;
      max-width: 480px;
      height: auto;
      border-radius: 12px;
      cursor: pointer;
    }
    .preview {
      max-width: 70ch;
    }
    .stage {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 230px;
      gap: 14px;
      align-items: start;
    }
    .cloud {
      background: #141a24;
      border: 1px solid #1c2430;
      border-radius: 12px;
      min-height: 520px;
      position: relative;
      box-shadow: inset 0 0 70px rgba(0, 0, 0, 0.22);
    }
    canvas {
      display: block;
      width: 100%;
      height: 520px;
      cursor: default;
    }
    .tip {
      position: absolute;
      pointer-events: none;
      background: #1a2330;
      border: 1px solid #3d5c86;
      color: #e7edf4;
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 0.82rem;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    aside {
      background: #141a24;
      border: 1px solid #1c2430;
      border-radius: 12px;
      max-height: 520px;
      overflow: auto;
    }
    .player {
      display: block;
      width: 100%;
      max-width: 480px;
      aspect-ratio: 16 / 9;
      border: 0;
      border-radius: 12px;
      background: #000;
    }
    aside h2 {
      margin: 0;
      padding: 12px 12px 6px;
      font-size: 0.78rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #9aa8b8;
      font-weight: 650;
      position: sticky;
      top: 0;
      background: #141a24;
    }
    aside ol {
      list-style: none;
      margin: 0;
      padding: 0 8px 10px;
    }
    aside li {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 4px 6px;
      border-radius: 6px;
      font-variant-numeric: tabular-nums;
      color: #c5d0dc;
    }
    aside li.on,
    aside li:hover {
      background: #1d2a3c;
      color: #e7edf4;
    }
    aside li.seek {
      cursor: pointer;
    }
    aside li span:last-child {
      color: #9aa8b8;
    }
    .insights {
      display: grid;
      gap: 16px;
      background: #141a24;
      border: 1px solid #1c2430;
      border-radius: 12px;
      padding: 14px 14px 16px;
    }
    .insights h2 {
      margin: 0;
      font-size: 0.78rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #9aa8b8;
      font-weight: 650;
    }
    .block {
      display: grid;
      gap: 8px;
    }
    .wpm {
      margin: 0;
      font-size: 1.2rem;
      font-weight: 650;
      letter-spacing: -0.03em;
    }
    .wpm span,
    .scale,
    .quiet {
      color: #9aa8b8;
      font-weight: 500;
    }
    .wpm span {
      font-size: 0.85rem;
    }
    .bars {
      display: flex;
      align-items: flex-end;
      gap: 3px;
      height: 64px;
    }
    .bars i {
      flex: 1;
      display: block;
      background: #7dcec4;
      border-radius: 2px 2px 0 0;
      min-height: 3px;
      opacity: 0.9;
    }
    .scale {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      font-variant-numeric: tabular-nums;
    }
    .jumps {
      display: grid;
      gap: 6px;
    }
    .insights button {
      width: 100%;
      text-align: left;
      line-height: 1.35;
    }
    .insights button strong {
      font-weight: 650;
    }
    .speaker {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 2px 10px;
      align-items: baseline;
      font-variant-numeric: tabular-nums;
    }
    .meter {
      grid-column: 1 / -1;
      height: 6px;
      border-radius: 99px;
      background: #1a2330;
      overflow: hidden;
    }
    .meter i {
      display: block;
      height: 100%;
      background: #8ec6e0;
    }
    details {
      color: #9aa8b8;
    }
    summary {
      cursor: pointer;
    }
    textarea {
      display: block;
      width: 100%;
      box-sizing: border-box;
      margin-top: 10px;
      min-height: 120px;
      font: inherit;
      color: #e7edf4;
      background: #1a2330;
      border: 1px solid #2c3a4d;
      border-radius: 8px;
      padding: 8px 12px;
      resize: vertical;
    }
    .paste-actions {
      margin-top: 8px;
    }
    @media (max-width: 800px) {
      .stage {
        grid-template-columns: 1fr;
      }
      .cloud {
        min-height: 440px;
      }
      canvas,
      aside {
        height: auto;
        max-height: 440px;
      }
      canvas {
        height: 440px;
      }
    }
  `;

  @state() private input = "";
  @state() private paste = "";
  @state() private loading = false;
  @state() private error = "";
  @state() private status = "";
  @state() private loaded: LoadedCaptions | null = null;
  @state() private words: WordCount[] = [];
  @state() private wordCount = 0;
  @state() private hover = "";
  @state() private tip = "";
  @state() private tipX = 0;
  @state() private tipY = 0;
  @state() private copied = false;
  @state() private thumbHidden = false;
  @state() private playAt: number | null = null;
  @state() private playNonce = 0;
  @state() private insights: CaptionInsights | null = null;

  @query("canvas") private canvas?: HTMLCanvasElement;

  private placed: PlacedWord[] = [];
  private layoutKey = "";
  private resizeObs?: ResizeObserver;
  private requestToken = 0;
  private copiedTimer = 0;
  private readQuery = false;

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.readQuery) return;
    this.readQuery = true;
    const raw = (new URLSearchParams(window.location.search).get("v") ?? "").trim();
    if (!raw) return;
    const id = parseVideoId(raw);
    if (!id) {
      this.input = raw;
      this.error = "Enter a YouTube URL or an 11-character video id.";
      return;
    }
    this.input = id;
    void this.loadId(id);
  }

  private watchCanvas(): void {
    const canvas = this.canvas;
    if (!canvas || this.resizeObs) return;
    this.resizeObs = new ResizeObserver(() => this.draw());
    this.resizeObs.observe(canvas);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObs?.disconnect();
    window.clearTimeout(this.copiedTimer);
  }

  override updated(): void {
    this.watchCanvas();
    this.draw();
  }

  private onInput(event: Event): void {
    this.input = (event.target as HTMLInputElement).value;
  }

  private onPaste(event: Event): void {
    this.paste = (event.target as HTMLTextAreaElement).value;
  }

  private async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const id = parseVideoId(this.input);
    if (!id) {
      this.error = "Enter a YouTube URL or an 11-character video id.";
      this.status = "";
      return;
    }
    await this.loadId(id);
  }

  private async loadDemo(): Promise<void> {
    this.input = `https://www.youtube.com/watch?v=${DEMO_VIDEO_ID}`;
    await this.loadId(DEMO_VIDEO_ID);
  }

  private async loadId(id: string): Promise<void> {
    const token = ++this.requestToken;
    this.loading = true;
    this.error = "";
    this.status = "Loading captions…";
    this.hover = "";
    this.tip = "";
    try {
      const loaded = await loadYouTubeCaptions(id);
      if (token !== this.requestToken) return;
      this.applyText(loaded);
      this.status = "";
    } catch (err) {
      if (token !== this.requestToken) return;
      this.error = err instanceof Error ? err.message : "Couldn't load captions.";
      this.status = "";
    } finally {
      if (token === this.requestToken) this.loading = false;
    }
  }

  private buildFromPaste(): void {
    const text = this.paste.trim();
    if (text.length < 20) {
      this.error = "Paste a longer transcript. Caption clouds need real text.";
      return;
    }
    this.requestToken += 1;
    this.error = "";
    this.status = "";
    this.applyText({
      videoId: "",
      title: "Pasted transcript",
      languageCode: "",
      languageName: "pasted text",
      text
    });
  }

  private applyText(loaded: LoadedCaptions): void {
    const cues = loaded.cues ?? [];
    const firstSeen = cues.length
      ? firstSeenWords(cues.map((cue) => ({ start: cue.start, text: cleanCaptionText(cue.text) })))
      : undefined;
    const stats = wordStats(loaded.text, 80, firstSeen);
    this.loaded = loaded;
    this.wordCount = stats.wordCount;
    this.words = stats.top;
    this.insights = cues.length ? captionInsights(cues) : null;
    this.hover = "";
    this.tip = "";
    this.copied = false;
    this.thumbHidden = false;
    this.playAt = null;
    this.playNonce = 0;
    replaceVideoParam(loaded.videoId);
  }

  private onThumbError(): void {
    this.thumbHidden = true;
  }

  private async copyShareLink(): Promise<void> {
    const id = this.loaded?.videoId;
    if (!id) return;
    const href = shareUrl(id);
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      const area = document.createElement("textarea");
      area.value = href;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      if (!ok) return;
    }
    this.copied = true;
    window.clearTimeout(this.copiedTimer);
    this.copiedTimer = window.setTimeout(() => {
      this.copied = false;
    }, 2000);
  }

  private onMove(event: MouseEvent): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const hit = this.hitWord(x, y);
    const seekable = hit?.firstAt != null && !!this.loaded?.videoId;
    canvas.style.cursor = seekable ? "pointer" : "default";
    const next = hit?.text ?? "";
    if (next !== this.hover) this.hover = next;
    if (hit) {
      this.tip = hit.firstAt == null ? `${hit.text} · ${hit.count}` : `${hit.text} · ${hit.count} · ${formatClock(hit.firstAt)}`;
      this.tipX = Math.max(8, Math.min(Math.max(8, rect.width - 210), event.clientX - rect.left + 12));
      this.tipY = Math.max(8, Math.min(rect.height - 28, event.clientY - rect.top + 14));
    } else if (this.tip) {
      this.tip = "";
    }
  }

  private hitWord(x: number, y: number): PlacedWord | undefined {
    const slop = 6;
    for (let i = this.placed.length - 1; i >= 0; i--) {
      const word = this.placed[i];
      if (!word) continue;
      const dx = x - word.x;
      const dy = y - word.y;
      const cos = Math.cos(word.rotation);
      const sin = Math.sin(word.rotation);
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      if (Math.abs(lx) <= word.width / 2 + slop && Math.abs(ly) <= word.height / 2 + slop) return word;
    }
    return undefined;
  }

  private onClick(event: MouseEvent): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    this.seekTo(this.hitWord(x, y)?.firstAt);
  }

  private seekTo(seconds: number | undefined): void {
    const videoId = this.loaded?.videoId;
    if (!videoId || seconds == null || !Number.isFinite(seconds)) return;
    const at = Math.max(0, Math.floor(seconds));
    this.playNonce += 1;
    this.playAt = at;
    window.open(youtubeWatchUrl(videoId, at), "_blank", "noopener,noreferrer");
  }

  private onLeave(): void {
    this.hover = "";
    this.tip = "";
    if (this.canvas) this.canvas.style.cursor = "default";
  }

  private draw(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const cssWidth = canvas.clientWidth || 900;
    const cssHeight = canvas.clientHeight || 520;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const key = `${width}x${height}:${this.words.map((word) => `${word.text}:${word.count}`).join("|")}`;
    if (key !== this.layoutKey) {
      const measure = (text: string, fontSize: number, fontWeight: number) => {
        setCloudFont(ctx, fontSize, fontWeight, dpr);
        const metrics = ctx.measureText(text);
        const ascent = metrics.actualBoundingBoxAscent || fontSize * dpr * 0.78;
        const descent = metrics.actualBoundingBoxDescent || fontSize * dpr * 0.22;
        const ink = (metrics.actualBoundingBoxLeft || 0) + (metrics.actualBoundingBoxRight || 0);
        return { width: Math.max(metrics.width, ink), height: Math.max(ascent + descent, fontSize * dpr * 0.7) };
      };
      this.placed = layoutCloud(this.words, width, height, measure);
      this.layoutKey = key;
    }
    for (const word of this.placed) {
      setCloudFont(ctx, word.fontSize, word.fontWeight, dpr);
      ctx.save();
      ctx.translate(word.x, word.y);
      ctx.rotate(word.rotation);
      if (word.text === this.hover) {
        const pad = 4 * dpr;
        ctx.fillStyle = "rgba(186, 210, 245, 0.16)";
        ctx.fillRect(-word.width / 2 - pad, -word.height / 2 - pad, word.width + pad * 2, word.height + pad * 2);
        ctx.fillStyle = "#f7fbff";
      } else {
        ctx.fillStyle = word.color;
      }
      ctx.fillText(word.text, 0, 0);
      ctx.restore();
    }
  }

  private renderInsights(insights: CaptionInsights): TemplateResult {
    const maxWpm = Math.max(1, ...insights.buckets.map((bucket) => bucket.wpm));
    const maxSpeaker = Math.max(1, ...insights.speakers.map((speaker) => speaker.words));
    const first = insights.buckets[0];
    const last = insights.buckets[insights.buckets.length - 1];
    return html`
      <section class="insights">
        ${insights.wpm > 0
          ? html`
              <div class="block">
                <h2>Pacing</h2>
                <p class="wpm">${Math.round(insights.wpm).toLocaleString()} <span>words per minute</span></p>
                ${insights.buckets.length
                  ? html`
                      <div
                        class="bars"
                        role="img"
                        aria-label=${`Words per minute across the video, averaging ${Math.round(insights.wpm)}`}
                      >
                        ${insights.buckets.map(
                          (bucket) => html`
                            <i
                              style=${`height:${Math.max(4, Math.round((bucket.wpm / maxWpm) * 64))}px`}
                              title=${`${formatClock(bucket.start)}–${formatClock(bucket.end)} · ${Math.round(bucket.wpm)} wpm`}
                            ></i>
                          `
                        )}
                      </div>
                      ${first && last
                        ? html`<div class="scale"><span>${formatClock(first.start)}</span><span>${formatClock(last.end)}</span></div>`
                        : null}
                    `
                  : null}
              </div>
            `
          : null}
        ${insights.gaps.length
          ? html`
              <div class="block">
                <h2>Quiet breaks</h2>
                <div class="jumps">
                  ${insights.gaps.map(
                    (gap) => html`
                      <button type="button" @click=${() => this.seekTo(gap.at)}>${gapLabel(gap)}</button>
                    `
                  )}
                </div>
              </div>
            `
          : null}
        ${insights.phrases.length
          ? html`
              <div class="block">
                <h2>Repeated phrases</h2>
                <div class="jumps">
                  ${insights.phrases.map(
                    (phrase) => html`
                      <button type="button" @click=${() => this.seekTo(phrase.at)}>${phraseLabel(phrase)}</button>
                    `
                  )}
                </div>
              </div>
            `
          : null}
        ${insights.speakers.length
          ? html`
              <div class="block">
                <h2>Who talks most</h2>
                ${insights.speakers.map(
                  (speaker) => html`
                    <div class="speaker">
                      <span>${speaker.name}</span>
                      <span class="quiet">${speaker.words.toLocaleString()} words</span>
                      <div class="meter"><i style=${`width:${(speaker.words / maxSpeaker) * 100}%`}></i></div>
                    </div>
                  `
                )}
              </div>
            `
          : null}
      </section>
    `;
  }

  override render() {
    const loaded = this.loaded;
    const preview = loaded ? previewText(loaded.text) : "";
    return html`
      <div class="wrap">
        <div>
          <h1>captioncloud</h1>
          <p class="hint">Load a YouTube video that already has captions and draw a word cloud from the words. Click a word to open YouTube at the first time it is said.</p>
        </div>
        <form class="row" @submit=${this.onSubmit}>
          <input
            type="text"
            name="video"
            .value=${this.input}
            placeholder="YouTube URL or video id — try https://www.youtube.com/watch?v=${DEMO_VIDEO_ID}"
            autocomplete="off"
            spellcheck="false"
            aria-label="YouTube URL or video id"
            @input=${this.onInput}
          />
          <button class="primary" type="submit" ?disabled=${this.loading}>Load captions</button>
          <button type="button" ?disabled=${this.loading} @click=${this.loadDemo}>Try a TED talk</button>
          ${loaded?.videoId
            ? html`<button
                type="button"
                class=${this.copied ? "copied" : ""}
                aria-live="polite"
                @click=${this.copyShareLink}
              >
                ${this.copied ? "Copied" : "Copy link"}
              </button>`
            : null}
        </form>
        ${this.status ? html`<p class="status">${this.status}</p>` : null}
        ${this.error ? html`<p class="status error">${this.error}</p>` : null}
        ${loaded
          ? html`
              <div>
                ${loaded.title ? html`<p class="title">${loaded.title}</p>` : null}
                <p class="meta">
                  ${loaded.languageName || loaded.languageCode || "Unknown language"}
                  ${loaded.languageCode ? html` · ${loaded.languageCode}` : null}
                  · ${this.wordCount.toLocaleString()} words
                  · top ${this.words.length} shown
                </p>
                <p class="preview">${preview}</p>
              </div>
              ${loaded.videoId && this.playAt != null
                ? keyed(
                    this.playNonce,
                    html`<iframe
                      class="player"
                      title=${loaded.title ? `Play ${loaded.title}` : "Play video"}
                      src=${`https://www.youtube.com/embed/${loaded.videoId}?start=${this.playAt}&autoplay=1`}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowfullscreen
                    ></iframe>`
                  )
                : loaded.videoId && !this.thumbHidden
                  ? html`<a
                      class="thumb-link"
                      href=${youtubeWatchUrl(loaded.videoId, this.playAt)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label=${loaded.title ? `Watch ${loaded.title} on YouTube` : "Watch on YouTube"}
                    >
                      <img
                        class="thumb"
                        alt=""
                        src="https://i.ytimg.com/vi/${loaded.videoId}/hqdefault.jpg"
                        @error=${this.onThumbError}
                      />
                    </a>`
                  : null}
              <div class="stage">
                <div class="cloud">
                  <canvas @mousemove=${this.onMove} @mouseleave=${this.onLeave} @click=${this.onClick}></canvas>
                  ${this.tip ? html`<div class="tip" style="left:${this.tipX}px;top:${this.tipY}px">${this.tip}</div>` : null}
                </div>
                <aside>
                  <h2>Counts</h2>
                  <ol>
                    ${this.words.map((word) => {
                      const seek = word.firstAt != null && !!loaded.videoId;
                      const cls = `${word.text === this.hover ? "on" : ""}${seek ? " seek" : ""}`;
                      return html`
                        <li
                          class=${cls}
                          @mouseenter=${() => (this.hover = word.text)}
                          @mouseleave=${this.onLeave}
                          @click=${() => this.seekTo(word.firstAt)}
                        >
                          <span>${word.text}</span>
                          <span>${seek ? `${word.count} · ${formatClock(word.firstAt ?? 0)}` : word.count}</span>
                        </li>
                      `;
                    })}
                  </ol>
                </aside>
              </div>
              ${this.insights ? this.renderInsights(this.insights) : null}
            `
          : null}
        <details>
          <summary>Paste a transcript instead</summary>
          <p class="hint">Pasted text has no timestamps. Clicking a word does not play a video.</p>
          <textarea
            .value=${this.paste}
            placeholder="If a video has no captions, you can paste the words here."
            @input=${this.onPaste}
          ></textarea>
          <div class="paste-actions">
            <button type="button" @click=${this.buildFromPaste}>Build cloud from text</button>
          </div>
        </details>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "caption-cloud": CaptionCloud;
  }
}
