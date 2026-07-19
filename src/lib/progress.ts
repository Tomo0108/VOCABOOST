import { getStored, setStored } from "@/lib/storage";
import { applyRating, initialSrsState, type Rating, type SrsState } from "@/lib/srs";
import { getAllWords } from "@/lib/vocab";
import { filterWordsByTrack } from "@/lib/word-meta";
import { getPreferences } from "@/lib/preferences";

export type WordProgress = Record<string, SrsState>;

const KEY = "vocaboost.progress.v1";

export async function getProgress(): Promise<WordProgress> {
  return await getStored<WordProgress>(KEY, {});
}

/** ホームなど用の集計（クライアント側ストレージ前提） */
export async function getHomeStats(now = Date.now()) {
  const [progress, prefs] = await Promise.all([getProgress(), getPreferences()]);
  const dueIds = await getDueWordIds(now);
  const trackWords = filterWordsByTrack(getAllWords(), prefs.includeDailyVocab);
  const trackIds = new Set(trackWords.map((w) => w.id));
  const dueInTrack = dueIds.filter((id) => trackIds.has(id));
  const touchedInTrack = Object.keys(progress).filter((id) => trackIds.has(id));
  return {
    dueCount: dueInTrack.length,
    touchedCount: touchedInTrack.length,
    listWordCount: trackWords.length,
  };
}

export async function rateWord(
  wordId: string,
  rating: Rating,
  opts?: { compactSchedule?: boolean }
): Promise<SrsState> {
  const now = Date.now();
  const progress = await getProgress();
  const prev = progress[wordId] ?? initialSrsState();
  let next = applyRating(prev, rating, now);
  if (opts?.compactSchedule && rating !== "again" && next.intervalDays > 0) {
    const scaled = Math.max(0.25, next.intervalDays * 0.68);
    next = {
      ...next,
      intervalDays: scaled,
      dueAt: now + scaled * 24 * 60 * 60 * 1000,
    };
  }
  progress[wordId] = next;
  await setStored(KEY, progress);
  return next;
}

export async function getDueWordIds(now = Date.now()): Promise<string[]> {
  const progress = await getProgress();
  return Object.entries(progress)
    .filter(([, s]) => (s?.dueAt ?? 0) <= now)
    .sort((a, b) => (a[1].dueAt ?? 0) - (b[1].dueAt ?? 0))
    .map(([id]) => id);
}

