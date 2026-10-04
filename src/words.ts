const STOPWORD_TEXT = `
a about above after again against all am an and any are aren't as at be because been
before being below between both but by can can't cannot could couldn't did didn't do
does doesn't doing don't down during each few for from further had hadn't has hasn't
have haven't having he he'd he'll he's her here here's hers herself him himself his
how how's i i'd i'll i'm i've if in into is isn't it it's its itself just let's me
more most my myself no nor not of off on once only or other ought our ours ourselves
out over own same shan't she she'd she'll she's should shouldn't so some such than
that that's the their theirs them themselves then there there's these they they'd
they'll they're they've this those through to too under until up very was wasn't we
we'd we'll we're we've were weren't what what's when when's where where's which
while who who's whom why why's with won't would wouldn't you you'd you'll you're
you've your yours yourself yourselves
ah uh um hmm oh okay ok yeah yes no hey hi hello gonna wanna kinda sorta like just
really very actually basically literally right well thing things something anything
everything nothing someone anyone everyone
across almost along already also although always among amongst another anyhow
anyway anyways anywhere around beside besides beyond despite either else
elsewhere enough even ever every everybody everywhere get going got gotta
however indeed know least less let many may maybe might mine moreover mostly
much must neither never nevertheless nobody none nowhere now often one onto
others otherwise per perhaps probably quite rather several shall somehow
sometime sometimes somewhere still therefore think though throughout thus
together toward towards unless upon us via whatever whenever whereas whereby
wherever whether whichever whoever whose will within without yet
`;

const STOPWORDS = new Set(
  STOPWORD_TEXT.split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase().replace(/'/g, ""))
    .filter((word) => !["id", "ill", "im", "lets", "hes", "shes"].includes(word))
);

export interface WordCount {
  text: string;
  count: number;
  /** First caption time that says this word, in seconds, when the source is timed. */
  firstAt?: number;
}

export interface SpokenToken {
  /** Letters only, used for counts and stopwords. */
  key: string;
  /** Lowercase token with internal apostrophes kept, for phrase display. */
  display: string;
}

export interface WordStats {
  /** Letter-words in the cleaned transcript, including stopwords. */
  wordCount: number;
  top: WordCount[];
}

const TOKEN = /[a-z0-9]+(?:'[a-z0-9]+)*/gi;

export function spokenTokens(text: string): SpokenToken[] {
  const tokens: SpokenToken[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const display = match[0].toLowerCase().replace(/^'+|'+$/g, "");
    const key = display.replace(/'/g, "");
    if (!key || /^\d+$/.test(key)) continue;
    tokens.push({ key, display });
  }
  return tokens;
}

export function isStopword(word: string): boolean {
  return STOPWORDS.has(word);
}

/** First cue time for each cloud word. `text` must already be cleaned caption text. */
export function firstSeenWords(parts: { start: number; text: string }[]): Map<string, number> {
  const seen = new Map<string, number>();
  for (const part of parts) {
    if (!Number.isFinite(part.start)) continue;
    for (const token of spokenTokens(part.text)) {
      if (token.key.length < 3 || STOPWORDS.has(token.key) || seen.has(token.key)) continue;
      seen.set(token.key, part.start);
    }
  }
  return seen;
}

export function wordStats(text: string, limit = 80, firstSeen?: ReadonlyMap<string, number>): WordStats {
  const counts = new Map<string, number>();
  let wordCount = 0;
  for (const token of spokenTokens(text)) {
    wordCount += 1;
    if (token.key.length < 3 || STOPWORDS.has(token.key)) continue;
    counts.set(token.key, (counts.get(token.key) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([text, count]) => {
      const firstAt = firstSeen?.get(text);
      return firstAt == null ? { text, count } : { text, count, firstAt };
    });
  return { wordCount, top };
}

export function previewText(text: string, max = 400): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max).trimEnd()}…`;
}
