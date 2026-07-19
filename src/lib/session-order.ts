import type { ToeicWord } from "@/lib/vocab";
import type { WordProgress } from "@/lib/progress";
import { getWordDifficulty } from "@/lib/word-meta";
import { shuffleRandom } from "@/lib/shuffle";

/** プール内の「慣れ」0..1（ease・復習回数から粗く推定） */
export function poolFamiliarityScore(words: ToeicWord[], progress: WordProgress): number {
  if (words.length === 0) return 0;
  let s = 0;
  let n = 0;
  for (const w of words) {
    const p = progress[w.id];
    if (!p) continue;
    n += 1;
    const easeN = Math.max(0, Math.min(1, (p.ease - 1.3) / 1.4));
    const repN = Math.min(1, p.reps / 4);
    s += 0.45 * easeN + 0.55 * repN;
  }
  if (n === 0) return 0;
  return s / n;
}

function pickWeightedIndex<T>(items: T[], weight: (t: T) => number): number {
  const ws = items.map(weight);
  const sum = ws.reduce((a, b) => a + b, 0);
  if (sum <= 0) return 0;
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i]!;
    if (r <= 0) return i;
  }
  return items.length - 1;
}

/**
 * 重み付きで順序を決める（preferHarder 時は難易度が高い語ほど先に出やすい）
 */
export function weightedShuffleByDifficulty(words: ToeicWord[], preferHarder: boolean): ToeicWord[] {
  const copy = [...words];
  const out: ToeicWord[] = [];
  while (copy.length) {
    const wi = preferHarder
      ? pickWeightedIndex(copy, (w) => {
          const d = getWordDifficulty(w);
          return d * d + 0.35;
        })
      : pickWeightedIndex(copy, () => 1);
    out.push(copy.splice(wi, 1)[0]!);
  }
  return out;
}

/**
 * セッション開始時: プールの慣れが高いほど難しい語を優先して並べる
 */
export function orderSessionCandidates(
  candidates: ToeicWord[],
  progress: WordProgress
): ToeicWord[] {
  const mixed = shuffleRandom([...candidates]);
  const familiar = poolFamiliarityScore(mixed, progress);
  const preferHarder = familiar >= 0.38;
  return weightedShuffleByDifficulty(mixed, preferHarder);
}

export type SessionResultLine = { wasCorrect: boolean };

/**
 * 不正解語を少し後に再挿入する（定着のための短期反復）。
 * afterIndex は「いま終わった問題の index」。
 */
export function insertRequeueAfter(
  words: ToeicWord[],
  afterIndex: number,
  word: ToeicWord,
  gap = 2
): ToeicWord[] {
  const insertAt = Math.min(words.length, Math.max(afterIndex + 1, afterIndex + 1 + gap));
  const next = [...words];
  next.splice(insertAt, 0, word);
  return next;
}

/**
 * 直近の正答率が高いとき、未出題の末尾を難易度重みで再シャッフル（チェックポイントの wordIds と整合）
 */
export function reshuffleRemainingForDifficulty(
  words: ToeicWord[],
  nextIndex: number,
  sessionResults: SessionResultLine[],
  opts?: { minAnswers?: number; threshold?: number }
): ToeicWord[] {
  const minA = opts?.minAnswers ?? 4;
  const th = opts?.threshold ?? 0.75;
  if (nextIndex >= words.length || sessionResults.length < minA) return words;
  const tailLen = words.length - nextIndex;
  if (tailLen <= 1) return words;
  const last = sessionResults.slice(-5);
  const rate = last.filter((r) => r.wasCorrect).length / Math.max(1, last.length);
  if (rate < th) return words;
  const head = words.slice(0, nextIndex);
  const tail = weightedShuffleByDifficulty(words.slice(nextIndex), true);
  return [...head, ...tail];
}
