/**
 * CMU ARPABET → IPA（米語）変換。
 * - AH0 → ə、AH1/AH2 → ʌ
 * - ストレス記号を「強勢音節の頭」（母音直前の子音群の前）へ移動
 */

export const ARPA_TO_IPA = {
  AA: "ɑ",
  AE: "æ",
  AH: "ʌ",
  AO: "ɔ",
  AW: "aʊ",
  AY: "aɪ",
  EH: "ɛ",
  ER: "ɝ",
  EY: "eɪ",
  IH: "ɪ",
  IY: "i",
  OW: "oʊ",
  OY: "ɔɪ",
  UH: "ʊ",
  UW: "u",
  B: "b",
  CH: "tʃ",
  D: "d",
  DH: "ð",
  F: "f",
  G: "ɡ",
  HH: "h",
  JH: "dʒ",
  K: "k",
  L: "l",
  M: "m",
  N: "n",
  NG: "ŋ",
  P: "p",
  R: "ɹ",
  S: "s",
  SH: "ʃ",
  T: "t",
  TH: "θ",
  V: "v",
  W: "w",
  Y: "j",
  Z: "z",
  ZH: "ʒ",
};

const VOWELS = new Set([
  "AA",
  "AE",
  "AH",
  "AO",
  "AW",
  "AY",
  "EH",
  "ER",
  "EY",
  "IH",
  "IY",
  "OW",
  "OY",
  "UH",
  "UW",
]);

export function stripDiacritics(s) {
  return s.normalize("NFKD").replace(/\p{Diacritic}/gu, "");
}

export function normalizeKey(term) {
  return term
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\u2013|\u2014/g, "-");
}

/**
 * @param {string} arpa
 * @returns {string|null}
 */
export function arpaToIpa(arpa) {
  const parts = arpa.split(/\s+/).filter(Boolean);
  /** @type {{ base: string, ipa: string, stress: string|null, isVowel: boolean }[]} */
  const phones = [];
  for (const raw of parts) {
    const m = raw.match(/^(.*?)([012])$/);
    const base = m ? m[1] : raw;
    const stress = m ? m[2] : null;
    let ipa = ARPA_TO_IPA[base];
    if (!ipa) continue;
    if (base === "AH" && stress === "0") ipa = "ə";
    phones.push({ base, ipa, stress, isVowel: VOWELS.has(base) });
  }
  if (phones.length === 0) return null;

  // ストレスを強勢母音の音節頭（直前の子音群の前）へ移動
  /** @type {(string|null)[]} */
  const marks = phones.map(() => null);
  for (let i = 0; i < phones.length; i++) {
    const p = phones[i];
    if (!p.isVowel || (p.stress !== "1" && p.stress !== "2")) continue;
    let j = i;
    while (j > 0 && !phones[j - 1].isVowel) j -= 1;
    marks[j] = p.stress === "1" ? "ˈ" : "ˌ";
  }

  let out = "";
  for (let i = 0; i < phones.length; i++) {
    if (marks[i]) out += marks[i];
    out += phones[i].ipa;
  }
  return out || null;
}

/**
 * CMU 辞書値は複数発音を ", " 区切りで持つことがある。
 * 品詞ヒントで名詞寄り（第1強勢が前寄り）／動詞寄りを選ぶ簡易ヒューリスティクス。
 * @param {string} arpaField
 * @param {"n"|"v"|"adj"|"adv"|"prep"|"conj"|"phr"|undefined} pos
 */
export function pickArpaVariant(arpaField, pos) {
  const variants = arpaField
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (variants.length <= 1) return variants[0] ?? arpaField;

  const score = (arpa) => {
    const parts = arpa.split(/\s+/);
    let firstPrimary = -1;
    for (let i = 0; i < parts.length; i++) {
      if (/1$/.test(parts[i])) {
        firstPrimary = i;
        break;
      }
    }
    // 名詞・形容詞は前方強勢、動詞は後方強勢をやや優先
    if (pos === "n" || pos === "adj") return firstPrimary <= 1 ? 2 : 0;
    if (pos === "v") return firstPrimary >= 2 ? 2 : 0;
    return 1;
  };

  return [...variants].sort((a, b) => score(b) - score(a))[0];
}

/**
 * @param {string} term
 * @param {Record<string, string>} overrides
 * @param {Record<string, string>} dict
 * @param {"n"|"v"|"adj"|"adv"|"prep"|"conj"|"phr"|undefined} pos
 */
export function lookupIpa(term, overrides, dict, pos) {
  const key0 = normalizeKey(term);
  if (overrides[key0]) return overrides[key0];

  const tryKeys = [
    key0,
    stripDiacritics(key0),
    key0.replace(/-/g, ""),
    stripDiacritics(key0).replace(/-/g, ""),
  ];

  for (const k of tryKeys) {
    const arpaField = dict[k];
    if (!arpaField) continue;
    const arpa = pickArpaVariant(arpaField, pos);
    const ipa = arpaToIpa(arpa);
    if (ipa) return ipa;
  }

  const parts = key0.split(/[\s-]+/).filter(Boolean);
  if (parts.length >= 2) {
    const ipas = parts.map((p) => {
      if (overrides[p]) return overrides[p];
      const arpaField = dict[p] ?? dict[stripDiacritics(p)];
      if (!arpaField) return null;
      return arpaToIpa(pickArpaVariant(arpaField, pos));
    });
    if (ipas.every(Boolean)) return ipas.join(" ");
  }

  return null;
}
