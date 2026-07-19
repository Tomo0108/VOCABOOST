import { getProgress, type WordProgress } from "@/lib/progress";
import { getPreferences, setPreferences, type AppPreferences } from "@/lib/preferences";
import { setStored } from "@/lib/storage";
import {
  getMistakes,
  replaceMistakes,
  type MistakeEntry,
} from "@/lib/mistakes";

type BackupPayload = {
  version: 1;
  exportedAt: string;
  progress: WordProgress;
  preferences: AppPreferences;
  /** 任意（旧バックアップには無い） */
  mistakes?: MistakeEntry[];
};

/** progress.ts と同一（バックアップ検証用） */
const PROGRESS_KEY = "vocaboost.progress.v1";

export async function exportBackup(): Promise<string> {
  const [progress, preferences, mistakes] = await Promise.all([
    getProgress(),
    getPreferences(),
    getMistakes(),
  ]);
  const payload: BackupPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    progress,
    preferences,
    mistakes,
  };
  return JSON.stringify(payload, null, 2);
}

export async function importBackup(json: string): Promise<{ wordCount: number }> {
  const data = JSON.parse(json) as BackupPayload;
  if (data.version !== 1 || typeof data.progress !== "object") {
    throw new Error("対応していない形式です");
  }
  await setStored(PROGRESS_KEY, data.progress);
  if (data.preferences) {
    await setPreferences(data.preferences);
  }
  if (Array.isArray(data.mistakes)) {
    await replaceMistakes(data.mistakes);
  }
  return { wordCount: Object.keys(data.progress).length };
}
