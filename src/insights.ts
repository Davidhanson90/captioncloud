import type { CaptionCue } from "./captions";
import { cleanCaptionText } from "./captions";
import { isStopword, spokenTokens } from "./words";

export interface WpmBucket {
  start: number;
  end: number;
  wpm: number;
}

export interface QuietGap {
  /** When speech resumes, seconds. */
  at: number;
  /** Silence between cues, seconds. */
  seconds: number;
  before: string;
  after: string;
}

export interface RepeatedPhrase {
  text: string;
  count: number;
  /** First time the phrase is said, seconds. */
  at: number;
}

export interface SpeakerShare {
  name: string;
  words: number;
}

export interface CaptionInsights {
  wpm: number;
  buckets: WpmBucket[];
  gaps: QuietGap[];
  phrases: RepeatedPhrase[];
  speakers: SpeakerShare[];
}

const QUIET_SECONDS = 2;
const GAP_LIMIT = 5;
const PHRASE_LIMIT = 6;
const SPEAKER_LIMIT = 6;

/** `m:ss`, with minutes allowed to run past 59. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const remain = whole % 60;
  return `${minutes}:${remain.toString().padStart(2, "0")}`;
}

export function captionInsights(cues: CaptionCue[]): CaptionInsights | null {
  if (!cues.length) return null;
  const ordered = [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
  const pacing = wordsPerMinute(ordered);
  const gaps = quietGaps(ordered);
  const phrases = repeatedPhrases(ordered);
  const speakers = speakerShares(ordered);
  if (pacing.wpm <= 0 && !gaps.length && !phrases.length && !speakers.length) return null;
  return { wpm: pacing.wpm, buckets: pacing.buckets, gaps, phrases, speakers };
}

function wordsPerMinute(cues: CaptionCue[]): { wpm: number; buckets: WpmBucket[] } {
  const start = cues[0]?.start ?? 0;
  const end = cues.reduce((max, cue) => Math.max(max, cue.end, cue.start), start);
  const span = end - start;
  if (span < 1) return { wpm: 0, buckets: [] };
  const slices = span < 90 ? 6 : span < 8 * 60 ? 8 : 12;
  const width = span / slices;
  const counts = new Array<number>(slices).fill(0);
  let words = 0;
  for (const cue of cues) {
    const count = spokenTokens(cleanCaptionText(cue.text)).length;
    if (!count) continue;
    words += count;
    let index = Math.floor((Math.max(cue.start, start) - start) / width);
    if (index < 0) index = 0;
    if (index >= slices) index = slices - 1;
    counts[index] = (counts[index] ?? 0) + count;
  }
  if (!words) return { wpm: 0, buckets: [] };
  const buckets = counts.map((count, index) => ({
    start: start + index * width,
    end: start + (index + 1) * width,
    wpm: count / (width / 60)
  }));
  return { wpm: words / (span / 60), buckets };
}

function quietGaps(cues: CaptionCue[]): QuietGap[] {
  const gaps: QuietGap[] = [];
  for (let i = 0; i < cues.length - 1; i++) {
    const prev = cues[i];
    const next = cues[i + 1];
    if (!prev || !next) continue;
    if (prev.end <= prev.start + 0.05) continue;
    const silence = next.start - prev.end;
    if (silence < QUIET_SECONDS) continue;
    const before = nearbyWords(cues, i, -1);
    const after = nearbyWords(cues, i + 1, 1);
    if (!before && !after) continue;
    gaps.push({ at: next.start, seconds: silence, before, after });
  }
  gaps.sort((a, b) => b.seconds - a.seconds || a.at - b.at);
  return gaps.slice(0, GAP_LIMIT);
}

function nearbyWords(cues: CaptionCue[], from: number, step: -1 | 1): string {
  for (let i = from; i >= 0 && i < cues.length; i += step) {
    const cue = cues[i];
    if (!cue) continue;
    const words = spokenTokens(cleanCaptionText(cue.text)).map((token) => token.display);
    if (!words.length) continue;
    const slice = step < 0 ? words.slice(-6) : words.slice(0, 6);
    const clipped = step < 0 ? words.length > 6 : words.length > 6;
    const body = slice.join(" ");
    if (step < 0) return clipped ? `… ${body}` : body;
    return clipped ? `${body} …` : body;
  }
  return "";
}

interface PhraseHit {
  count: number;
  at: number;
  text: string;
}

function repeatedPhrases(cues: CaptionCue[]): RepeatedPhrase[] {
  const stream: { key: string; display: string; at: number }[] = [];
  let prevEnd = Number.NEGATIVE_INFINITY;
  for (const cue of cues) {
    if (Number.isFinite(prevEnd) && cue.start - prevEnd >= QUIET_SECONDS) {
      stream.push({ key: "", display: "", at: -1 });
    }
    for (const token of spokenTokens(cleanCaptionText(cue.text))) {
      stream.push({ key: token.key, display: token.display, at: cue.start });
    }
    prevEnd = Math.max(cue.end, cue.start);
  }
  const hits = new Map<string, PhraseHit>();
  for (let size = 2; size <= 4; size++) {
    for (let i = 0; i <= stream.length - size; i++) {
      const window = stream.slice(i, i + size);
      if (window.some((token) => !token.key)) continue;
      if (window.every((token) => token.key.length < 3 || isStopword(token.key))) continue;
      const id = window.map((token) => token.key).join(" ");
      const at = window[0]?.at ?? 0;
      const text = window.map((token) => token.display).join(" ");
      const existing = hits.get(id);
      if (!existing) {
        hits.set(id, { count: 1, at, text });
        continue;
      }
      existing.count += 1;
      if (at < existing.at) {
        existing.at = at;
        existing.text = text;
      }
    }
  }
  const ranked = [...hits.values()]
    .filter((hit) => hit.count > 1)
    .sort((a, b) => b.count - a.count || b.text.split(" ").length - a.text.split(" ").length || a.at - b.at);
  const kept: PhraseHit[] = [];
  for (const hit of ranked) {
    if (kept.length >= PHRASE_LIMIT) break;
    const words = hit.text.split(" ");
    const covered = kept.some((other) => {
      if (other.count !== hit.count) return false;
      const longer = other.text.split(" ");
      if (longer.length <= words.length) return false;
      for (let i = 0; i <= longer.length - words.length; i++) {
        if (longer.slice(i, i + words.length).join(" ") === hit.text) return true;
      }
      return false;
    });
    if (!covered) kept.push(hit);
  }
  return kept.map((hit) => ({ text: hit.text, count: hit.count, at: hit.at }));
}

const NOT_A_NAME = new Set([
  "so", "and", "but", "well", "now", "then", "ok", "okay", "yeah", "yes", "no", "oh", "ah", "hey", "hi",
  "um", "uh", "the", "this", "that", "what", "when", "why", "how", "please", "thank", "thanks", "music",
  "applause", "laughter", "cheers", "cheering"
]);

function speakerShares(cues: CaptionCue[]): SpeakerShare[] {
  const totals = new Map<string, { name: string; words: number }>();
  let current: string | null = null;
  let labeled = false;
  const add = (name: string, words: number) => {
    if (!words) return;
    const key = name.toLowerCase();
    const row = totals.get(key);
    if (row) row.words += words;
    else totals.set(key, { name, words });
  };
  for (const cue of cues) {
    const pieces = splitSpeakerPieces(cue.text);
    if (!pieces) {
      if (current) add(current, spokenTokens(cleanCaptionText(cue.text)).length);
      continue;
    }
    for (const piece of pieces) {
      if (piece.name) {
        labeled = true;
        current = piece.name;
      }
      if (current) add(current, spokenTokens(cleanCaptionText(piece.rest)).length);
    }
  }
  if (!labeled) return [];
  return [...totals.values()]
    .sort((a, b) => b.words - a.words || a.name.localeCompare(b.name))
    .slice(0, SPEAKER_LIMIT);
}

function splitSpeakerPieces(raw: string): { name: string | null; rest: string }[] | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text.includes(">>") && !/^[A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+)*\s*:/u.test(text)) return null;
  const chunks = text.split(">>");
  const pieces: { name: string | null; rest: string }[] = [];
  let found = false;
  chunks.forEach((chunk, index) => {
    const part = chunk.trim();
    if (!part) return;
    if (index === 0) {
      const named = matchColonName(part);
      if (named) {
        found = true;
        pieces.push(named);
      } else {
        pieces.push({ name: null, rest: part });
      }
      return;
    }
    const named = matchColonName(part) ?? matchChevronName(part);
    if (named) {
      found = true;
      pieces.push(named);
      return;
    }
    pieces.push({ name: null, rest: part });
  });
  return found ? pieces : null;
}

function matchColonName(part: string): { name: string; rest: string } | null {
  const match = part.match(/^([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){0,3})\s*:\s*([\s\S]*)$/u);
  if (!match) return null;
  const name = match[1]?.trim() ?? "";
  if (!name || isGenericName(name)) return null;
  return { name, rest: match[2] ?? "" };
}

function matchChevronName(part: string): { name: string; rest: string } | null {
  const multi = part.match(/^([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){1,3})\b\s*([\s\S]*)$/u);
  if (multi) {
    const name = multi[1]?.trim() ?? "";
    if (name && !isGenericName(name)) return { name, rest: multi[2] ?? "" };
  }
  const single = part.match(/^([A-Z][\p{L}'’.-]{1,30})\b\s*([\s\S]*)$/u);
  if (!single) return null;
  const name = single[1]?.trim() ?? "";
  if (!name || isGenericName(name)) return null;
  return { name, rest: single[2] ?? "" };
}

function isGenericName(name: string): boolean {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return true;
  if (parts.length === 1) return NOT_A_NAME.has(parts[0]!.toLowerCase());
  return parts.every((part) => NOT_A_NAME.has(part.toLowerCase()));
}
