import { getStored, setStored } from "@/lib/storage";
import {
  DEFAULT_COLOR_PRESET_ID,
  type ColorPresetId,
  isColorPresetId,
} from "@/lib/color-presets";
import type { WordDifficulty } from "@/lib/word-meta";

const KEY = "vocaboost.prefs.v1";

export type AppPreferences = {
  /** UI アクセントカラーのプリセット */
  colorPreset: ColorPresetId;
  /** 復習間隔をやや詰める（SRS の日数に倍率を適用） */
  compactSchedule: boolean;
  /** 和訳展開時に例文ブロックを出す */
  showExample: boolean;
  /** 学習セッションで問題（4択）表示時に英語を自動読み上げ（既定はオフ） */
  autoSpeakEnglish: boolean;
  /** 学習セッションの問題文で品詞を表示する */
  showPartOfSpeechInQuestion: boolean;
  /** 出題する難易度（1=やさしい … 3=むずかしい）。未指定の語は語長・品詞から推定 */
  difficultyLevels: WordDifficulty[];
  /**
   * 生活・娯楽寄りの語（tags に daily）も出題する。
   * 既定はオフ＝ビジネス／本番対策トラックのみ。
   */
  includeDailyVocab: boolean;
};

const DEFAULTS: AppPreferences = {
  colorPreset: DEFAULT_COLOR_PRESET_ID,
  compactSchedule: false,
  showExample: true,
  autoSpeakEnglish: false,
  showPartOfSpeechInQuestion: true,
  difficultyLevels: [1, 2, 3],
  includeDailyVocab: false,
};

function normalizeDifficultyLevels(raw: unknown): WordDifficulty[] {
  if (!Array.isArray(raw)) return [1, 2, 3];
  const set = new Set<WordDifficulty>();
  for (const x of raw) {
    if (x === 1 || x === 2 || x === 3) set.add(x);
  }
  if (set.size === 0) return [1, 2, 3];
  return [...set].sort((a, b) => a - b);
}

function normalizePreferences(raw: Partial<AppPreferences>): AppPreferences {
  const colorPreset =
    raw.colorPreset != null && isColorPresetId(raw.colorPreset)
      ? raw.colorPreset
      : DEFAULT_COLOR_PRESET_ID;
  const difficultyLevels = normalizeDifficultyLevels(raw.difficultyLevels);
  const includeDailyVocab = Boolean(raw.includeDailyVocab);
  return { ...DEFAULTS, ...raw, colorPreset, difficultyLevels, includeDailyVocab };
}

export async function getPreferences(): Promise<AppPreferences> {
  const raw = await getStored<Partial<AppPreferences>>(KEY, {});
  return normalizePreferences(raw);
}

export async function setPreferences(
  patch: Partial<AppPreferences>
): Promise<AppPreferences> {
  const cur = await getPreferences();
  const next = normalizePreferences({ ...cur, ...patch });
  await setStored(KEY, next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("vocaboost:prefs-updated"));
  }
  return next;
}
