import type { WordCount } from "./words";

export interface PlacedWord {
  text: string;
  count: number;
  /** Center, in the same pixel space as the canvas buffer. */
  x: number;
  y: number;
  /** CSS pixels. Drawing multiplies by devicePixelRatio. */
  fontSize: number;
  fontWeight: number;
  /** Unrotated glyph box, canvas-buffer pixels. */
  width: number;
  height: number;
  /** Radians. Most words stay horizontal. */
  rotation: number;
  color: string;
}

export interface TextSize {
  width: number;
  height: number;
}

export type MeasureFn = (text: string, fontSize: number, fontWeight: number) => TextSize;

/** Cool ink on the dark stage, plus one rare warm accent. */
const ICE = "#f4f7fb";
const PERIWINKLE = "#b7cff2";
const SKY = "#8ec6e0";
const TEAL = "#7dcec4";
const SAND = "#e6d2a4";
const MIST = "#9aafc2";

const MIN_FONT = 14;
const MAX_FONT = 72;

interface Occupant {
  x: number;
  y: number;
  hw: number;
  hh: number;
  /** cos(rotation), sin(rotation). */
  c: number;
  s: number;
  reach: number;
}

export function layoutCloud(
  words: WordCount[],
  width: number,
  height: number,
  measure: MeasureFn
): PlacedWord[] {
  if (width < 40 || height < 40 || words.length === 0) return [];

  let best: PlacedWord[] = [];
  let bestScore = -1;
  for (const scale of [1, 0.94]) {
    const placed = pack(words, width, height, measure, scale);
    const cov = coverage(placed, width, height);
    const minFont = placed.reduce((min, word) => Math.min(min, word.fontSize), MAX_FONT);
    const maxFont = placed.reduce((max, word) => Math.max(max, word.fontSize), 0);
    const keep = placed.length / words.length;
    const contrast = maxFont / Math.max(minFont, 1);
    const score = keep * 80 + Math.min(cov.w, 1) * 20 + Math.min(cov.h, 1) * 12 + Math.min(contrast, 5) * 8 + (maxFont >= 68 ? 6 : 0);
    if (score > bestScore) {
      best = placed;
      bestScore = score;
    }
    if (keep >= 0.9 && cov.w >= 0.8 && cov.h >= 0.68 && minFont <= 17 && maxFont >= 68) return placed;
  }
  return best;
}

function pack(words: WordCount[], width: number, height: number, measure: MeasureFn, scale: number): PlacedWord[] {
  const maxCount = Math.max(1, words[0]?.count ?? 1);
  const total = words.length;
  const placed: PlacedWord[] = [];
  const occupants: Occupant[] = [];
  const cx = width / 2;
  const cy = height / 2;

  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (!word) continue;
    let fontSize = fontSizeFor(word.count, maxCount, index, total, scale);
    let fontWeight = weightFor(fontSize);
    let rotation = rotationFor(index, word.text, fontSize);
    let size = fitToCanvas(word.text, fontSize, fontWeight, rotation, width, height, measure, index);
    fontSize = size.fontSize;
    fontWeight = size.fontWeight;
    rotation = size.rotation;
    let box = size.box;

    for (let shrink = 0; shrink < 5; shrink++) {
      const padX = Math.max(2, box.width * 0.04);
      const padY = Math.max(2, box.height * 0.1);
      const spot =
        index === 0 && shrink === 0
          ? centerIfFits(cx, cy, box.width, box.height, rotation, padX, padY, width, height)
          : seek(box.width, box.height, rotation, padX, padY, width, height, occupants, index);
      if (spot) {
        placed.push({
          text: word.text,
          count: word.count,
          x: spot.x,
          y: spot.y,
          fontSize,
          fontWeight,
          width: box.width,
          height: box.height,
          rotation,
          color: colorFor(index, total, word.count / maxCount, spot.x, spot.y, placed, width, height)
        });
        occupants.push(occupant(spot.x, spot.y, box.width / 2 + padX, box.height / 2 + padY, rotation));
        break;
      }
      if (fontSize <= MIN_FONT + 0.25) break;
      fontSize = Math.max(MIN_FONT, Math.round(fontSize * 0.86 * 2) / 2);
      fontWeight = weightFor(fontSize);
      rotation = rotationFor(index, word.text, fontSize);
      box = measure(word.text, fontSize, fontWeight);
    }
  }

  spreadToFill(placed, width, height);
  return placed;
}

function spreadToFill(placed: PlacedWord[], width: number, height: number): void {
  if (placed.length < 2) return;
  const cx = width / 2;
  const cy = height / 2;
  const margin = edgeMargin(width, height);
  let room = 1.4;
  for (const word of placed) {
    const c = Math.cos(word.rotation);
    const s = Math.sin(word.rotation);
    const hw = word.width / 2;
    const hh = word.height / 2;
    const locals: Array<[number, number]> = [
      [hw, hh],
      [hw, -hh],
      [-hw, hh],
      [-hw, -hh]
    ];
    for (const [lx, ly] of locals) {
      const gx = lx * c - ly * s;
      const gy = lx * s + ly * c;
      room = Math.min(room, scaleRoom(word.x - cx, gx, margin, width - margin, cx));
      room = Math.min(room, scaleRoom(word.y - cy, gy, margin, height - margin, cy));
    }
  }
  const gain = Math.max(1, Math.min(room, 1.2));
  if (gain < 1.025) return;
  for (const word of placed) {
    word.x = cx + (word.x - cx) * gain;
    word.y = cy + (word.y - cy) * gain;
  }
}

function edgeMargin(width: number, height: number): number {
  return Math.max(12, Math.min(width, height) * 0.035);
}

function scaleRoom(delta: number, glyph: number, low: number, high: number, origin: number): number {
  if (delta > 0.5) return (high - origin - glyph) / delta;
  if (delta < -0.5) return (low - origin - glyph) / delta;
  return 99;
}

function fontSizeFor(count: number, maxCount: number, index: number, total: number, scale: number): number {
  const t = total <= 1 ? 0 : index / (total - 1);
  const countP = count / maxCount;
  const rankP = 1 - t;
  const fromCount = MIN_FONT + Math.pow(countP, 0.9) * (MAX_FONT - MIN_FONT);
  const fromRank = MIN_FONT + Math.pow(rankP, 1.65) * (MAX_FONT - MIN_FONT);
  const weight = Math.pow(countP, 1.05);
  const sized = fromCount * weight + fromRank * (1 - weight);
  const grown =
    scale >= 1 ? sized + (scale - 1) * (MAX_FONT - sized) * 0.28 : MIN_FONT + (sized - MIN_FONT) * scale;
  return Math.round(Math.max(MIN_FONT, Math.min(MAX_FONT, grown)) * 2) / 2;
}

function weightFor(fontSize: number): number {
  if (fontSize >= 46) return 800;
  if (fontSize >= 24) return 700;
  return 600;
}

function rotationFor(index: number, text: string, fontSize: number): number {
  if (index < 6) return 0;
  if (fontSize >= 48 || fontSize < 17) return 0;
  if (text.length > 10) return 0;
  if (text.length <= 8 && index % 8 === 5) return -Math.PI / 2;
  if (index % 12 === 7) return index % 2 === 0 ? 0.18 : -0.18;
  return 0;
}

function fitToCanvas(
  text: string,
  fontSize: number,
  fontWeight: number,
  rotation: number,
  width: number,
  height: number,
  measure: MeasureFn,
  index: number
): { fontSize: number; fontWeight: number; rotation: number; box: TextSize } {
  let size = fontSize;
  let weight = fontWeight;
  let rot = rotation;
  let box = measure(text, size, weight);
  const widthLimit = width * (Math.abs(rot) > 1 ? 0.46 : 0.58);
  while ((box.width > widthLimit || box.height > height * 0.5) && size > MIN_FONT) {
    size = Math.max(MIN_FONT, size - 1);
    weight = weightFor(size);
    rot = rotationFor(index, text, size);
    box = measure(text, size, weight);
  }
  return { fontSize: size, fontWeight: weight, rotation: rot, box };
}

function colorFor(
  index: number,
  total: number,
  prominence: number,
  x: number,
  y: number,
  placed: PlacedWord[],
  width: number,
  height: number
): string {
  const hex = avoidNeighbor(baseHex(index, total), x, y, placed, width, height);
  const alpha = index === 0 ? 1 : 0.66 + 0.34 * Math.pow(Math.min(1, prominence), 0.5);
  return rgba(hex, alpha);
}

function baseHex(index: number, total: number): string {
  const t = total <= 1 ? 0 : index / (total - 1);
  if (index === 0) return ICE;
  if (t < 0.08) return PERIWINKLE;
  if (t < 0.22) return SKY;
  if (t < 0.45) return TEAL;
  if (index % 13 === 8) return SAND;
  if (t < 0.72) return index % 2 === 0 ? MIST : TEAL;
  return MIST;
}

function altHex(hex: string): string {
  switch (hex) {
    case TEAL:
      return MIST;
    case MIST:
      return TEAL;
    case SKY:
      return PERIWINKLE;
    case PERIWINKLE:
      return SKY;
    case SAND:
      return MIST;
    default:
      return PERIWINKLE;
  }
}

function avoidNeighbor(hex: string, x: number, y: number, placed: PlacedWord[], width: number, height: number): string {
  const limit = Math.min(width, height) * 0.18;
  let nearest: PlacedWord | null = null;
  let best = limit * limit;
  const start = Math.max(0, placed.length - 14);
  for (let i = placed.length - 1; i >= start; i--) {
    const other = placed[i];
    if (!other) continue;
    const dx = other.x - x;
    const dy = other.y - y;
    const dist = dx * dx + dy * dy;
    if (dist < best) {
      best = dist;
      nearest = other;
    }
  }
  if (!nearest) return hex;
  const ink = rgba(hex, 1);
  const prefix = ink.slice(0, ink.lastIndexOf(","));
  return nearest.color.startsWith(prefix) ? altHex(hex) : hex;
}

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

function centerIfFits(
  cx: number,
  cy: number,
  boxW: number,
  boxH: number,
  rot: number,
  padX: number,
  padY: number,
  width: number,
  height: number
): { x: number; y: number } | null {
  const body = occupant(cx, cy, boxW / 2 + padX, boxH / 2 + padY, rot);
  return inside(body, width, height, edgeMargin(width, height)) ? { x: cx, y: cy } : null;
}

function seek(
  boxW: number,
  boxH: number,
  rot: number,
  padX: number,
  padY: number,
  width: number,
  height: number,
  occupants: Occupant[],
  index: number
): { x: number; y: number } | null {
  const cx = width / 2;
  const cy = height / 2;
  const yScale = height / width;
  const maxAttempts = 1800;
  const turns = 18;
  const maxTheta = turns * Math.PI * 2;
  const dTheta = maxTheta / maxAttempts;
  const radial = (Math.max(width, height) * 0.6) / maxTheta;
  const start = index * 2.399963;
  const hw = boxW / 2 + padX;
  const hh = boxH / 2 + padY;
  const template = occupant(0, 0, hw, hh, rot);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const travel = attempt * dTheta;
    const radius = radial * travel;
    const theta = start + travel;
    const x = cx + Math.cos(theta) * radius;
    const y = cy + Math.sin(theta) * radius * yScale;
    template.x = x;
    template.y = y;
    if (!inside(template, width, height, edgeMargin(width, height))) continue;
    if (!collides(template, occupants)) return { x, y };
  }
  return null;
}

function occupant(x: number, y: number, hw: number, hh: number, rot: number): Occupant {
  return { x, y, hw, hh, c: Math.cos(rot), s: Math.sin(rot), reach: hw + hh };
}

function inside(box: Occupant, width: number, height: number, margin: number): boolean {
  const xs = [box.hw, box.hw, -box.hw, -box.hw];
  const ys = [box.hh, -box.hh, box.hh, -box.hh];
  for (let i = 0; i < 4; i++) {
    const lx = xs[i] ?? 0;
    const ly = ys[i] ?? 0;
    const px = box.x + lx * box.c - ly * box.s;
    const py = box.y + lx * box.s + ly * box.c;
    if (px < margin || py < margin || px > width - margin || py > height - margin) return false;
  }
  return true;
}

function collides(candidate: Occupant, occupants: Occupant[]): boolean {
  for (const other of occupants) {
    const dx = other.x - candidate.x;
    const dy = other.y - candidate.y;
    const limit = candidate.reach + other.reach;
    if (dx * dx + dy * dy > limit * limit) continue;
    if (obbsOverlap(candidate, other)) return true;
  }
  return false;
}

function obbsOverlap(a: Occupant, b: Occupant): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (separated(a, b, dx, dy, a.c, a.s)) return false;
  if (separated(a, b, dx, dy, -a.s, a.c)) return false;
  if (separated(a, b, dx, dy, b.c, b.s)) return false;
  if (separated(a, b, dx, dy, -b.s, b.c)) return false;
  return true;
}

function separated(a: Occupant, b: Occupant, dx: number, dy: number, ax: number, ay: number): boolean {
  const aProj = a.hw * Math.abs(a.c * ax + a.s * ay) + a.hh * Math.abs(-a.s * ax + a.c * ay);
  const bProj = b.hw * Math.abs(b.c * ax + b.s * ay) + b.hh * Math.abs(-b.s * ax + b.c * ay);
  const dist = Math.abs(dx * ax + dy * ay);
  return dist > aProj + bProj - 0.5;
}

function coverage(placed: PlacedWord[], width: number, height: number): { w: number; h: number } {
  if (!placed.length) return { w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const word of placed) {
    const c = Math.cos(word.rotation);
    const s = Math.sin(word.rotation);
    const hw = word.width / 2;
    const hh = word.height / 2;
    const xs = [hw, hw, -hw, -hw];
    const ys = [hh, -hh, hh, -hh];
    for (let i = 0; i < 4; i++) {
      const lx = xs[i] ?? 0;
      const ly = ys[i] ?? 0;
      const px = word.x + lx * c - ly * s;
      const py = word.y + lx * s + ly * c;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }
  return { w: (maxX - minX) / width, h: (maxY - minY) / height };
}
