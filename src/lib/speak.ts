import { getPreferences } from "@/lib/preferences";

export type SpeakOptions = {
  /** 0.5〜1.5。未指定時は設定値 */
  rate?: number;
  lang?: string;
};

let cachedRate: number | null = null;
let listenerBound = false;

function ensurePrefsListener() {
  if (listenerBound || typeof window === "undefined") return;
  listenerBound = true;
  window.addEventListener("vocaboost:prefs-updated", () => {
    cachedRate = null;
  });
}

function clampRate(n: number): number {
  return Math.max(0.5, Math.min(1.5, n));
}

async function resolveRate(override?: number): Promise<number> {
  ensurePrefsListener();
  if (typeof override === "number" && Number.isFinite(override)) {
    return clampRate(override);
  }
  if (cachedRate != null) return cachedRate;
  try {
    const prefs = await getPreferences();
    cachedRate = clampRate(prefs.speechRate ?? 1);
  } catch {
    cachedRate = 1;
  }
  return cachedRate;
}

/**
 * 英語テキストを読み上げる（設定の速度を反映）。
 * fire-and-forget 用。失敗しても投げない。
 */
export function speakEnglish(text: string, opts?: SpeakOptions): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const t = text.trim();
  if (!t) return;

  window.speechSynthesis.cancel();
  void resolveRate(opts?.rate).then((rate) => {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = opts?.lang ?? "en-US";
    u.rate = rate;
    try {
      window.speechSynthesis.speak(u);
    } catch {
      /* ignore */
    }
  });
}
