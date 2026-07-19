import { getStored, setStored } from "@/lib/storage";

export type MistakeEntry = {
  wordId: string;
  at: number; // epoch ms
};

const MISTAKES_KEY = "vocaboost.mistakes.v1";
const RETRY_KEY = "vocaboost.retry-queue.v1";

/** 7日より古い誤答は捨てる */
const RETAIN_MS = 7 * 24 * 60 * 60 * 1000;

function startOfLocalDay(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function prune(entries: MistakeEntry[], now = Date.now()): MistakeEntry[] {
  const cutoff = now - RETAIN_MS;
  return entries.filter((e) => e.at >= cutoff);
}

export async function getMistakes(): Promise<MistakeEntry[]> {
  const raw = await getStored<MistakeEntry[]>(MISTAKES_KEY, []);
  if (!Array.isArray(raw)) return [];
  return prune(
    raw.filter(
      (e) => e && typeof e.wordId === "string" && typeof e.at === "number"
    )
  );
}

export async function recordMistake(wordId: string, now = Date.now()): Promise<void> {
  const cur = await getMistakes();
  cur.push({ wordId, at: now });
  await setStored(MISTAKES_KEY, prune(cur, now));
}

/** 今日間違えた語（重複なし・新しい順） */
export async function getTodaysMistakeWordIds(now = Date.now()): Promise<string[]> {
  const dayStart = startOfLocalDay(now);
  const seen = new Set<string>();
  const out: string[] = [];
  const list = await getMistakes();
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]!;
    if (e.at < dayStart) continue;
    if (seen.has(e.wordId)) continue;
    seen.add(e.wordId);
    out.push(e.wordId);
  }
  return out;
}

export async function countTodaysMistakes(now = Date.now()): Promise<number> {
  return (await getTodaysMistakeWordIds(now)).length;
}

/** 結果画面「間違いだけ再テスト」用の一時キュー */
export async function setRetryQueue(wordIds: string[]): Promise<void> {
  const uniq = [...new Set(wordIds.filter(Boolean))];
  await setStored(RETRY_KEY, { wordIds: uniq, updatedAt: Date.now() });
}

export async function getRetryQueue(): Promise<string[]> {
  const raw = await getStored<{ wordIds?: string[]; updatedAt?: number } | null>(
    RETRY_KEY,
    null
  );
  if (!raw || !Array.isArray(raw.wordIds)) return [];
  // 2時間以内のみ有効
  if (raw.updatedAt && Date.now() - raw.updatedAt > 2 * 60 * 60 * 1000) {
    return [];
  }
  return raw.wordIds.filter((id) => typeof id === "string");
}

export async function clearRetryQueue(): Promise<void> {
  await setStored(RETRY_KEY, null);
}

export async function replaceMistakes(entries: MistakeEntry[]): Promise<void> {
  await setStored(MISTAKES_KEY, prune(Array.isArray(entries) ? entries : []));
}
