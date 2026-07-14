/**
 * Did-you-mean support: classic Levenshtein distance plus a picker that
 * only suggests a candidate when it is plausibly a typo (distance scaled
 * to the word length), so cfgvet never proposes nonsense corrections.
 */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min((prev[j] as number) + 1, (curr[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[lb] as number;
}

/**
 * Return the closest candidate if it is close enough to be a plausible
 * typo (case-insensitive; threshold: 1 for short words, ~1/3 of length
 * otherwise), else null.
 */
export function nearest(word: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  const lower = word.toLowerCase();
  for (const cand of candidates) {
    const d = levenshtein(lower, cand.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  if (best === null) return null;
  // A distance of 0 is a case-only mismatch — still worth suggesting.
  const threshold = Math.max(1, Math.floor(Math.max(word.length, best.length) / 3));
  return bestDist <= threshold ? best : null;
}
