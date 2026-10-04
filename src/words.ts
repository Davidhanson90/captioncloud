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
`;

const STOPWORDS = new Set(
  STOPWORD_TEXT.split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase().replace(/'/g, ""))
    .filter((word) => !["id", "ill", "im", "lets", "well", "hes", "shes"].includes(word))
);

export interface WordCount {
  text: string;
  count: number;
}

export interface WordStats {
  /** Letter-words in the cleaned transcript, including stopwords. */
  wordCount: number;
  top: WordCount[];
}

const TOKEN = /[a-z0-9]+(?:'[a-z0-9]+)*/gi;

export function wordStats(text: string, limit = 80): WordStats {
  const counts = new Map<string, number>();
  let wordCount = 0;
  for (const match of text.matchAll(TOKEN)) {
    const raw = match[0].toLowerCase().replace(/^'+|'+$/g, "");
    const letters = raw.replace(/'/g, "");
    if (!letters || /^\d+$/.test(letters)) continue;
    wordCount += 1;
    if (letters.length < 3) continue;
    if (STOPWORDS.has(letters)) continue;
    counts.set(letters, (counts.get(letters) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([text, count]) => ({ text, count }));
  return { wordCount, top };
}

export function previewText(text: string, max = 400): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max).trimEnd()}…`;
}
