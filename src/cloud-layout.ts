import type { WordCount } from "./words";

export interface PlacedWord {
  text: string;
  count: number;
  x: number;
  y: number;
  fontSize: number;
  width: number;
  height: number;
  color: string;
}

const COLORS = ["#d7e6ff", "#8eb4ff", "#9ad7c8", "#f0d59a", "#e7b3c8", "#c5d0dc", "#b7c7ff"];

export interface TextSize {
  width: number;
  height: number;
}

export function layoutCloud(
  words: WordCount[],
  width: number,
  height: number,
  measure: (text: string, fontSize: number) => TextSize
): PlacedWord[] {
  if (width < 40 || height < 40 || words.length === 0) return [];
  const maxCount = words[0]?.count ?? 1;
  const placed: PlacedWord[] = [];
  const cx = width / 2;
  const cy = height / 2;
  words.forEach((word, index) => {
    const weight = Math.sqrt(word.count / maxCount);
    let fontSize = Math.round(14 + weight * 54);
    let size = measure(word.text, fontSize);
    const maxW = width * 0.72;
    while (size.width > maxW && fontSize > 12) {
      fontSize -= 2;
      size = measure(word.text, fontSize);
    }
    const pad = 5;
    const boxW = size.width + pad * 2;
    const boxH = size.height + pad * 2;
    let spot: { x: number; y: number } | null = null;
    let theta = index * 0.35;
    for (let attempt = 0; attempt < 900; attempt++) {
      theta += 0.42;
      const radius = 2.4 * theta;
      const x = cx + Math.cos(theta) * radius;
      const y = cy + Math.sin(theta) * radius * 0.72;
      const left = x - boxW / 2;
      const top = y - boxH / 2;
      if (left < 2 || top < 2 || left + boxW > width - 2 || top + boxH > height - 2) continue;
      const hit = placed.some((other) => {
        const ol = other.x - other.width / 2 - pad;
        const ot = other.y - other.height / 2 - pad;
        return left < ol + other.width + pad * 2 && left + boxW > ol && top < ot + other.height + pad * 2 && top + boxH > ot;
      });
      if (!hit) {
        spot = { x, y };
        break;
      }
    }
    if (!spot) return;
    placed.push({
      text: word.text,
      count: word.count,
      x: spot.x,
      y: spot.y,
      fontSize,
      width: size.width,
      height: size.height,
      color: COLORS[index % COLORS.length] ?? COLORS[0]
    });
  });
  return placed;
}
