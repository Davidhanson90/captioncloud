import { LitElement, css, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { DEMO_VIDEO_ID, loadYouTubeCaptions, parseVideoId, type LoadedCaptions } from "./captions";
import { layoutCloud, type PlacedWord } from "./cloud-layout";
import { previewText, wordStats, type WordCount } from "./words";

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
      max-width: 1100px;
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
    .title {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 600;
    }
    .preview {
      max-width: 70ch;
    }
    .stage {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 250px;
      gap: 14px;
      align-items: start;
    }
    .cloud {
      background: #141a24;
      border: 1px solid #1c2430;
      border-radius: 12px;
      min-height: 420px;
      position: relative;
    }
    canvas {
      display: block;
      width: 100%;
      height: 560px;
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
    }
    aside {
      background: #141a24;
      border: 1px solid #1c2430;
      border-radius: 12px;
      max-height: 560px;
      overflow: auto;
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
    ol {
      list-style: none;
      margin: 0;
      padding: 0 8px 10px;
    }
    li {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 4px 6px;
      border-radius: 6px;
      font-variant-numeric: tabular-nums;
      color: #c5d0dc;
    }
    li.on,
    li:hover {
      background: #1d2a3c;
      color: #e7edf4;
    }
    li span:last-child {
      color: #9aa8b8;
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
      canvas,
      aside {
        height: auto;
        max-height: 480px;
      }
      canvas {
        height: 460px;
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

  @query("canvas") private canvas?: HTMLCanvasElement;

  private placed: PlacedWord[] = [];
  private resizeObs?: ResizeObserver;
  private requestToken = 0;

  private watchCanvas(): void {
    const canvas = this.canvas;
    if (!canvas || this.resizeObs) return;
    this.resizeObs = new ResizeObserver(() => this.draw());
    this.resizeObs.observe(canvas);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObs?.disconnect();
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
    const stats = wordStats(loaded.text);
    this.loaded = loaded;
    this.wordCount = stats.wordCount;
    this.words = stats.top;
    this.hover = "";
    this.tip = "";
  }

  private onMove(event: MouseEvent): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const hit = this.placed.find((word) => {
      const left = word.x - word.width / 2;
      const top = word.y - word.height / 2;
      return x >= left && x <= left + word.width && y >= top && y <= top + word.height;
    });
    const next = hit?.text ?? "";
    if (next !== this.hover) this.hover = next;
    if (hit) {
      this.tip = `${hit.text} · ${hit.count}`;
      this.tipX = event.clientX - rect.left + 12;
      this.tipY = event.clientY - rect.top + 14;
    } else if (this.tip) {
      this.tip = "";
    }
  }

  private onLeave(): void {
    this.hover = "";
    this.tip = "";
  }

  private draw(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const cssWidth = canvas.clientWidth || 640;
    const cssHeight = canvas.clientHeight || 560;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
    const measure = (text: string, fontSize: number) => {
      ctx.font = `600 ${fontSize * dpr}px ui-sans-serif, system-ui, sans-serif`;
      const metrics = ctx.measureText(text);
      const ascent = metrics.actualBoundingBoxAscent || fontSize * dpr * 0.8;
      const descent = metrics.actualBoundingBoxDescent || fontSize * dpr * 0.2;
      return { width: metrics.width, height: ascent + descent };
    };
    this.placed = layoutCloud(this.words, width, height, measure);
    for (const word of this.placed) {
      ctx.font = `600 ${word.fontSize * dpr}px ui-sans-serif, system-ui, sans-serif`;
      if (word.text === this.hover) {
        ctx.fillStyle = "rgba(142, 180, 255, 0.18)";
        const pad = 6 * dpr;
        ctx.fillRect(word.x - word.width / 2 - pad, word.y - word.height / 2 - pad, word.width + pad * 2, word.height + pad * 2);
      }
      ctx.fillStyle = word.color;
      ctx.fillText(word.text, word.x, word.y);
    }
  }

  override render() {
    const loaded = this.loaded;
    const preview = loaded ? previewText(loaded.text) : "";
    return html`
      <div class="wrap">
        <div>
          <h1>captioncloud</h1>
          <p class="hint">Load a YouTube video that already has captions and draw a word cloud from the words.</p>
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
              <div class="stage">
                <div class="cloud">
                  <canvas @mousemove=${this.onMove} @mouseleave=${this.onLeave}></canvas>
                  ${this.tip ? html`<div class="tip" style="left:${this.tipX}px;top:${this.tipY}px">${this.tip}</div>` : null}
                </div>
                <aside>
                  <h2>Counts</h2>
                  <ol>
                    ${this.words.map(
                      (word) => html`
                        <li class=${word.text === this.hover ? "on" : ""} @mouseenter=${() => (this.hover = word.text)} @mouseleave=${this.onLeave}>
                          <span>${word.text}</span><span>${word.count}</span>
                        </li>
                      `
                    )}
                  </ol>
                </aside>
              </div>
            `
          : null}
        <details>
          <summary>Paste a transcript instead</summary>
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
