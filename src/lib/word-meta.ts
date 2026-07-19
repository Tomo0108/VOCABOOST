import type { ToeicWord } from "@/lib/vocab";

export type WordDifficulty = 1 | 2 | 3;

export const WORD_CATEGORY_IDS = [
  "n",
  "v",
  "adj",
  "adv",
  "prep_conj",
  "phr",
  "other",
] as const;

export type WordCategoryId = (typeof WORD_CATEGORY_IDS)[number];

export const WORD_CATEGORY_LABELS: Record<WordCategoryId, string> = {
  n: "名詞",
  v: "動詞",
  adj: "形容詞",
  adv: "副詞",
  prep_conj: "前置詞・接続詞",
  phr: "フレーズ",
  other: "その他",
};

/** TOEIC 場面タグ（データ `tags` と対応） */
export const SCENE_TAG_IDS = [
  "office",
  "meeting",
  "hr",
  "travel",
  "dining",
  "shopping",
  "finance",
  "manufacturing",
  "it",
  "marketing",
  "facilities",
  "healthcare",
  "daily",
] as const;

export type SceneTagId = (typeof SCENE_TAG_IDS)[number];

export const SCENE_TAG_LABELS: Record<SceneTagId, string> = {
  office: "オフィス",
  meeting: "会議",
  hr: "人事",
  travel: "出張・交通",
  dining: "飲食",
  shopping: "販売・接客",
  finance: "財務・契約",
  manufacturing: "製造・物流",
  it: "IT",
  marketing: "広告・広報",
  facilities: "施設",
  healthcare: "健康・安全",
  daily: "生活・娯楽",
};

export function isSceneTagId(s: string): s is SceneTagId {
  return (SCENE_TAG_IDS as readonly string[]).includes(s);
}

export function getSceneTags(w: ToeicWord): SceneTagId[] {
  if (!w.tags?.length) return [];
  return w.tags.filter(isSceneTagId);
}

export function isDailyWord(w: ToeicWord): boolean {
  return getSceneTags(w).includes("daily");
}

/** 品詞ベースのカテゴリ（データにタグがなくても一覧・絞り込みに使う） */
export function getWordCategoryId(w: ToeicWord): WordCategoryId {
  const p = w.partOfSpeech;
  if (!p) return "other";
  if (p === "prep" || p === "conj") return "prep_conj";
  if (p === "n" || p === "v" || p === "adj" || p === "adv" || p === "phr") return p;
  return "other";
}

export function getWordCategoryLabel(w: ToeicWord): string {
  return WORD_CATEGORY_LABELS[getWordCategoryId(w)];
}

/** 出題の重み付け用。明示 difficulty がなければ語長・品詞から推定 */
export function getWordDifficulty(w: ToeicWord): WordDifficulty {
  if (w.difficulty === 1 || w.difficulty === 2 || w.difficulty === 3) {
    return w.difficulty;
  }
  const len = w.term.replace(/[-']/g, "").length;
  let score: number = len <= 4 ? 1 : len <= 9 ? 2 : 3;
  const p = w.partOfSpeech;
  if (p === "prep" || p === "conj" || p === "adv" || p === "phr") {
    score = Math.min(3, score + 1);
  }
  if (isDailyWord(w)) score = Math.min(score, 1);
  return score as WordDifficulty;
}

export function difficultyLabel(d: WordDifficulty): string {
  if (d === 1) return "やさしい";
  if (d === 2) return "ふつう";
  return "むずかしい";
}

/** 指定レベルに含まれる単語だけに絞る（levels が 3 段階すべてならコピーせずそのまま返す） */
export function filterWordsByDifficulty(
  words: ToeicWord[],
  levels: readonly WordDifficulty[]
): ToeicWord[] {
  const set = new Set(levels);
  if (set.size === 0) return [];
  if (set.size === 3 && set.has(1) && set.has(2) && set.has(3)) {
    return words;
  }
  return words.filter((w) => set.has(getWordDifficulty(w)));
}

/** 生活語を除く（本番対策トラック） */
export function filterWordsByTrack(
  words: ToeicWord[],
  includeDailyVocab: boolean
): ToeicWord[] {
  if (includeDailyVocab) return words;
  return words.filter((w) => !isDailyWord(w));
}

export function filterWordsByScene(
  words: ToeicWord[],
  scene: SceneTagId | "all"
): ToeicWord[] {
  if (scene === "all") return words;
  return words.filter((w) => getSceneTags(w).includes(scene));
}
