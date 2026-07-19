import type { ToeicWord } from "@/lib/vocab";

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function foldDiacritics(s: string) {
  return s.normalize("NFKD").replace(/\p{Diacritic}/gu, "");
}

/** 不規則変化など、単純な接尾では拾えない見出し語形 */
const IRREGULAR_FORMS: Record<string, string[]> = {
  dive: ["dove", "dived", "diving"],
  shrink: ["shrank", "shrunk", "shrinking"],
  undergo: ["underwent", "undergone", "undergoing"],
  overcome: ["overcame", "overcoming"],
  tally: ["tallied", "tallies", "tallying"],
};

/** 見出し語から例文中に現れうる屈折形パターンを生成 */
function inflectionPatterns(term: string): string[] {
  const t = term.trim().toLowerCase();
  if (!t || /\s/.test(t)) return [t];

  const pats = new Set<string>([t]);
  pats.add(`${t}'s`);
  pats.add(`${t}s`);
  pats.add(`${t}es`);
  pats.add(`${t}ed`);
  pats.add(`${t}ing`);

  if (t.endsWith("y") && t.length > 2 && !/[aeiou]y$/i.test(t)) {
    const stem = t.slice(0, -1);
    pats.add(`${stem}ies`);
    pats.add(`${stem}ied`);
    pats.add(`${t}ing`);
  }

  if (t.endsWith("e")) {
    const stem = t.slice(0, -1);
    pats.add(`${stem}ed`);
    pats.add(`${stem}ing`);
    pats.add(`${stem}es`);
  }

  if (t.endsWith("ie")) {
    pats.add(`${t.slice(0, -2)}ying`);
  }

  for (const alt of IRREGULAR_FORMS[t] ?? []) pats.add(alt);

  return [...pats].sort((a, b) => b.length - a.length);
}

/** 例文中の見出し語の範囲（語尾変化・句動詞の前置詞1語まで） */
export function findTermRange(
  example: string,
  term: string,
  pos?: ToeicWord["partOfSpeech"]
): { start: number; end: number } | null {
  const t = term.trim();
  if (!t || !example) return null;
  const lower = example.toLowerCase();
  const tl = t.toLowerCase();

  if (/\s/.test(t)) {
    const i = lower.indexOf(tl);
    if (i >= 0) return { start: i, end: i + t.length };
    return null;
  }

  for (const form of inflectionPatterns(t)) {
    const re = new RegExp(`\\b${escapeRe(form)}\\b`, "i");
    const m = example.match(re);
    if (m != null && m.index !== undefined) {
      const start = m.index;
      let end = start + m[0].length;
      if (pos === "v") {
        const rest = example.slice(end);
        const pm = rest.match(
          /^\s+(by|to|for|with|from|into|onto|up|out|off|on|in|over|away|across|along|through)\b/i
        );
        if (pm) end += pm[0].length;
      }
      return { start, end };
    }
  }

  // アクセント記号の差（café / cafe など）
  const foldedExample = foldDiacritics(lower);
  for (const form of inflectionPatterns(t)) {
    const foldedForm = foldDiacritics(form);
    const idx = foldedExample.indexOf(foldedForm);
    if (idx < 0) continue;
    // 単語境界相当（前後が英字でない）
    const before = foldedExample[idx - 1] ?? " ";
    const after = foldedExample[idx + foldedForm.length] ?? " ";
    if (/[a-z]/i.test(before) || /[a-z]/i.test(after)) continue;
    return { start: idx, end: idx + foldedForm.length };
  }

  // 最後の手段: 語幹前方一致（短すぎる語は誤爆しやすいので長さ制限）
  if (tl.length >= 5) {
    const re2 = new RegExp(`\\b${escapeRe(tl)}[a-z]*\\b`, "i");
    const m2 = example.match(re2);
    if (m2 != null && m2.index !== undefined) {
      return { start: m2.index, end: m2.index + m2[0].length };
    }
  }

  return null;
}

/** 英語例文を見出し語で分割（ハイライト用） */
export function splitExampleAroundTerm(
  example: string,
  term: string,
  pos?: ToeicWord["partOfSpeech"]
): { before: string; match: string; after: string; found: boolean } {
  const range = findTermRange(example, term, pos);
  if (!range) {
    return { before: example, match: "", after: "", found: false };
  }
  return {
    before: example.slice(0, range.start),
    match: example.slice(range.start, range.end),
    after: example.slice(range.end),
    found: true,
  };
}
