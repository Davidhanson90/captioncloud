# captioncloud

Paste a YouTube URL and draw a word cloud from that video's public caption track. Everything runs in the browser. There is no API key and no speech-to-text. The video has to already have captions.

**Live:** [https://davidhanson90.github.io/captioncloud/](https://davidhanson90.github.io/captioncloud/)

## Run

```bash
npm install
npm run dev
```

Vite serves the app at `http://localhost:5173/captioncloud/`.

```bash
npm run build
npm run preview
```

## Use

1. Paste a YouTube URL or an 11-character video id.
2. Press **Load captions**.
3. Hover a word in the cloud, or the list beside it, to see how many times it appears.

After a YouTube video loads, the address bar gains `?v=VIDEO_ID` (via `history.replaceState`, so it can be copied). **Copy link** copies the full URL for this deployment, built from the Vite base: on the live site that is `https://davidhanson90.github.io/captioncloud/?v=VIDEO_ID`, and in dev it is `http://localhost:5173/captioncloud/?v=VIDEO_ID`. Opening that link fills the input and loads the cloud with no extra click. Pasted transcripts stay on the page only. They clear `?v=`, and they are not shareable links.

**Try a TED talk** loads [Inside the Mind of a Master Procrastinator](https://www.youtube.com/watch?v=arj7oStGLkU) (`arj7oStGLkU`). That video has an English caption track. It was the one checked while building this demo: the track starts "So in college,".

The page shows the video title when YouTube returns it, the caption language, how many words were in the track, and the first ~400 characters.

English stopwords are dropped, and so are words shorter than 3 letters. The cloud is the top 80 remaining words, sized by count. Stage directions such as `(Laughter)` and `[Music]` are removed. Timestamps are not shown.

If a video has no caption track, the page says so. **Paste a transcript instead** builds a cloud from text you already have. That path is only a fallback. A normal captioned video does not need it.

## How captions are fetched

Two public YouTube requests, no key:

1. `https://www.youtube.com/api/timedtext?v=VIDEO_ID&lang=en&fmt=json3`. This URL allows browser CORS, but without a signed track it usually comes back empty.
2. When that body is empty, the page asks YouTube's Innertube player endpoint for the ANDROID client (`youtubei/v1/player`, no API key). The response lists caption tracks and a signed `timedtext` URL. That URL is fetched with `fmt=json3`.

Innertube does not send `Access-Control-Allow-Origin` for a normal website, so a page on GitHub Pages cannot read it directly. It does answer an opaque `Origin: null` with `Access-Control-Allow-Origin: null`. The requests above run inside a sandboxed iframe (`allow-scripts`, not `allow-same-origin`) and the caption payload is posted back to the page. The player POST uses `Content-Type: text/plain` so the browser does not send a preflight YouTube rejects.

The signed track URL has to be fetched from the same browser that asked for the player response. A server-side copy of that URL is often empty.

English (human, not auto-generated) is preferred, then any English track, then the first track YouTube returns. The title comes from the player response, or from YouTube oEmbed if that is all that is available.

This uses an undocumented player endpoint. If YouTube changes it, loading by URL can break until the client payload is updated.
