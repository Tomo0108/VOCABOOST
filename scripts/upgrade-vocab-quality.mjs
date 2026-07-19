/**
 * 単語データの品質アップグレード:
 * - 和訳修正（同義語差・カタカナのみ・短すぎる訳）
 * - 例文修正（見出し語形）
 * - 場面タグ / 生活語タグ付与
 * - 明示 difficulty 付与
 * - IPA 再計算（ストレス位置・ə 修正）
 * - 品詞の軽微修正
 */
import fs from "node:fs/promises";
import path from "node:path";
import * as cmu from "cmu-pronouncing-dictionary";
import { lookupIpa } from "./lib/ipa-convert.mjs";

const TARGET = path.resolve("src/data/toeic/words.enriched.generated.ts");
const OVERRIDES = path.resolve("src/data/sources/ipa/overrides.json");
const MEANING_FIXES = path.resolve("src/data/sources/vocab-patches/meaning-fixes.json");
const EXAMPLE_FIXES = path.resolve("src/data/sources/vocab-patches/example-fixes.json");
const LIFESTYLE = path.resolve("src/data/sources/vocab-patches/lifestyle-terms.json");

const POS_FIXES = {
  bye: "phr",
  whoever: "phr",
  hourly: "adj",
  quarterly: "adj",
  yearly: "adj",
  chilly: "adj",
  costly: "adj",
};

/** @type {Record<string, { re: RegExp, weight: number }[]>} */
const SCENE_RULES = {
  hr: [
    { re: /採用|面接|人事|昇進|従業員|社員|休暇|給与|福利|履歴書|インターン/, weight: 3 },
    { re: /\b(hire|interview|employee|salary|resume|internship|promotion)\b/i, weight: 2 },
  ],
  meeting: [
    { re: /会議|プレゼン|議題|議事|交渉|合意|提案/, weight: 3 },
    { re: /\b(meeting|presentation|agenda|negotiate|proposal|conference)\b/i, weight: 2 },
  ],
  office: [
    { re: /オフィス|事務|部署|同僚|書類|報告書|メール/, weight: 2 },
    { re: /\b(office|department|colleague|document|report|email)\b/i, weight: 1 },
  ],
  travel: [
    { re: /空港|ホテル|飛行機|列車|搭乗|出張|チケット|予約|運賃/, weight: 3 },
    { re: /\b(airport|hotel|flight|train|travel|ticket|reservation|fare)\b/i, weight: 2 },
  ],
  dining: [
    { re: /レストラン|食事|メニュー|料理|カフェ|予約.*席/, weight: 3 },
    { re: /\b(restaurant|menu|dinner|lunch|café|cafe|appetizer|dessert)\b/i, weight: 2 },
  ],
  shopping: [
    { re: /店|商品|在庫|注文|配送|顧客|返品|割引|購入/, weight: 3 },
    { re: /\b(store|product|inventory|order|shipping|customer|discount|purchase)\b/i, weight: 2 },
  ],
  finance: [
    { re: /予算|売上|利益|請求|支払|契約|財務|会計|株主|投資|税/, weight: 3 },
    { re: /\b(budget|revenue|profit|invoice|payment|contract|finance|accounting|tax)\b/i, weight: 2 },
  ],
  manufacturing: [
    { re: /工場|製造|生産|部品|倉庫|出荷|品質|検査/, weight: 3 },
    { re: /\b(factory|manufactur|production|warehouse|shipment|quality|inspect)\b/i, weight: 2 },
  ],
  it: [
    { re: /ソフトウェア|システム|パスワード|ネットワーク|データ|オンライン|アプリ/, weight: 3 },
    { re: /\b(software|system|password|network|data|online|computer|digital)\b/i, weight: 2 },
  ],
  marketing: [
    { re: /広告|宣伝|ブランド|キャンペーン|広報|チラシ|パンフレット/, weight: 3 },
    { re: /\b(advertis|marketing|brand|campaign|brochure|flyer|poster)\b/i, weight: 2 },
  ],
  facilities: [
    { re: /建物|施設|会議室|駐車場|エレベーター|設備|改装/, weight: 2 },
    { re: /\b(building|facility|parking|elevator|renovation|lobby)\b/i, weight: 1 },
  ],
  healthcare: [
    { re: /医療|健康|病院|診療|アレルギー|安全/, weight: 2 },
    { re: /\b(medical|health|clinic|hospital|safety|allergy)\b/i, weight: 1 },
  ],
};

function escapeTsString(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function loadJson(p, fallback) {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return fallback;
  }
}

function parseWordLine(line) {
  if (!line.includes("{ id:") || !line.includes("term:")) return null;
  const id = line.match(/id:\s*"([^"]+)"/)?.[1];
  const term = line.match(/term:\s*"([^"]+)"/)?.[1];
  if (!id || !term) return null;
  const ipa = line.match(/ipa:\s*"([^"]*)"/)?.[1];
  const meaningJa = line.match(/meaningJa:\s*"((?:\\.|[^"\\])*)"/)?.[1]?.replace(/\\"/g, '"');
  const partOfSpeech = line.match(/partOfSpeech:\s*"([^"]+)"/)?.[1];
  const exampleEn = line.match(/exampleEn:\s*"((?:\\.|[^"\\])*)"/)?.[1]?.replace(/\\"/g, '"');
  const exampleJa = line.match(/exampleJa:\s*"((?:\\.|[^"\\])*)"/)?.[1]?.replace(/\\"/g, '"');
  const diffM = line.match(/difficulty:\s*([123])/);
  const difficulty = diffM ? Number(diffM[1]) : undefined;
  const tagsM = line.match(/tags:\s*\[([^\]]*)\]/);
  let tags;
  if (tagsM) {
    tags = [...tagsM[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  }
  return {
    id,
    term,
    ipa,
    meaningJa: meaningJa ?? "",
    partOfSpeech,
    exampleEn,
    exampleJa,
    tags,
    difficulty,
  };
}

function assignTags(word, lifestyleSet) {
  const text = `${word.meaningJa} ${word.exampleEn ?? ""} ${word.exampleJa ?? ""}`;
  /** @type {Map<string, number>} */
  const scores = new Map();
  for (const [scene, rules] of Object.entries(SCENE_RULES)) {
    let s = 0;
    for (const { re, weight } of rules) {
      if (re.test(text)) s += weight;
    }
    if (s > 0) scores.set(scene, s);
  }

  const tags = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k);

  if (lifestyleSet.has(word.term.toLowerCase()) || lifestyleSet.has(word.term)) {
    if (!tags.includes("daily")) tags.push("daily");
  }

  if (tags.length === 0) {
    // ビジネス一般へフォールバック（生活語以外）
    tags.push(lifestyleSet.has(word.term.toLowerCase()) ? "daily" : "office");
  }

  return tags;
}

function assignDifficulty(word, tags) {
  const term = word.term.replace(/[-']/g, "");
  const len = term.length;
  let score = len <= 4 ? 1 : len <= 9 ? 2 : 3;

  if (tags.includes("daily")) score = Math.min(score, 1);

  // 抽象的な長語をやや難しく
  if (/(tion|sion|ment|ance|ence|ity|ology)$/i.test(term) && len >= 8) {
    score = Math.max(score, 2);
  }
  if (len >= 12) score = 3;

  // 機能語・短い副詞は中〜難寄り
  const p = word.partOfSpeech;
  if ((p === "adv" || p === "prep" || p === "conj" || p === "phr") && score < 3) {
    score = Math.min(3, score + 1);
  }

  return /** @type {1|2|3} */ (score);
}

function serializeWord(w) {
  const parts = [
    `id: "${escapeTsString(w.id)}"`,
    `term: "${escapeTsString(w.term)}"`,
  ];
  if (w.ipa) parts.push(`ipa: "${escapeTsString(w.ipa)}"`);
  parts.push(`meaningJa: "${escapeTsString(w.meaningJa)}"`);
  if (w.partOfSpeech) parts.push(`partOfSpeech: "${w.partOfSpeech}"`);
  if (w.exampleEn) parts.push(`exampleEn: "${escapeTsString(w.exampleEn)}"`);
  if (w.exampleJa) parts.push(`exampleJa: "${escapeTsString(w.exampleJa)}"`);
  if (w.tags?.length) {
    parts.push(`tags: [${w.tags.map((t) => `"${escapeTsString(t)}"`).join(", ")}]`);
  }
  if (w.difficulty === 1 || w.difficulty === 2 || w.difficulty === 3) {
    parts.push(`difficulty: ${w.difficulty}`);
  }
  return `  { ${parts.join(", ")} },`;
}

async function main() {
  const [src, overrides, meaningFixes, exampleFixes, lifestyleList] = await Promise.all([
    fs.readFile(TARGET, "utf8"),
    loadJson(OVERRIDES, {}),
    loadJson(MEANING_FIXES, {}),
    loadJson(EXAMPLE_FIXES, {}),
    loadJson(LIFESTYLE, []),
  ]);

  const lifestyleSet = new Set(
    lifestyleList.map((t) => String(t).toLowerCase())
  );
  const dict = cmu?.dictionary ?? cmu?.default?.dictionary ?? cmu?.default ?? cmu;

  const lines = src.split(/\r?\n/);
  const out = [];
  let upgraded = 0;
  let meaningChanged = 0;
  let exampleChanged = 0;
  let ipaChanged = 0;

  // 型コメントを強化（先頭の type ブロックを差し替え）
  const header = `// GENERATED / MAINTAINED FILE.
// Base: TOEIC Service List (TSL) 1.1 + curated business/daily enrichment.
// Upgrade: npm run data:upgrade
//
// tags: 場面（office, meeting, travel, dining, shopping, finance,
// manufacturing, it, marketing, facilities, healthcare, hr, daily）
// daily = 生活・娯楽寄り（設定で本番対策から除外可能）
// difficulty: 1=やさしい … 3=むずかしい（明示値）

export type ToeicWord = {
  id: string;
  term: string;
  /** 発音記号（IPA, 米語）。例: əˈbaɪd */
  ipa?: string;
  meaningJa: string;
  partOfSpeech?: "n" | "v" | "adj" | "adv" | "prep" | "conj" | "phr";
  exampleEn?: string;
  exampleJa?: string;
  /** 場面タグ。daily は生活語彙トラック */
  tags?: string[];
  /** 1=やさしい … 3=難しい */
  difficulty?: 1 | 2 | 3;
};

export const TOEIC_WORDS: ToeicWord[] = [
`;

  let inArray = false;
  for (const line of lines) {
    if (line.startsWith("export const TOEIC_WORDS")) {
      inArray = true;
      out.push(header.trimEnd());
      continue;
    }
    if (!inArray) {
      // 旧ヘッダは捨てる（header で置換）
      continue;
    }
    if (line.trim() === "];") {
      out.push("];");
      out.push("");
      break;
    }

    const parsed = parseWordLine(line);
    if (!parsed) {
      out.push(line);
      continue;
    }

    const termKey = parsed.term;
    const termLower = termKey.toLowerCase();

    if (meaningFixes[termKey] || meaningFixes[termLower]) {
      const next = meaningFixes[termKey] ?? meaningFixes[termLower];
      if (next !== parsed.meaningJa) {
        parsed.meaningJa = next;
        meaningChanged++;
      }
    }

    const exFix = exampleFixes[termKey] ?? exampleFixes[termLower];
    if (exFix) {
      if (exFix.exampleEn && exFix.exampleEn !== parsed.exampleEn) {
        parsed.exampleEn = exFix.exampleEn;
        exampleChanged++;
      }
      if (exFix.exampleJa) parsed.exampleJa = exFix.exampleJa;
    }

    if (POS_FIXES[termLower]) {
      parsed.partOfSpeech = POS_FIXES[termLower];
    }

    const tags = assignTags(parsed, lifestyleSet);
    parsed.tags = tags;
    parsed.difficulty = assignDifficulty(parsed, tags);

    const ipa = lookupIpa(
      parsed.term,
      overrides,
      dict,
      /** @type {any} */ (parsed.partOfSpeech)
    );
    if (ipa) {
      if (ipa !== parsed.ipa) ipaChanged++;
      parsed.ipa = ipa;
    }

    out.push(serializeWord(parsed));
    upgraded++;
  }

  // id 規約の軽い正規化は参照互換のため行わない（進捗キー破壊を避ける）

  await fs.writeFile(TARGET, out.join("\n"), "utf8");
  console.log(
    JSON.stringify(
      {
        upgraded,
        meaningChanged,
        exampleChanged,
        ipaChanged,
        lifestyleTagged: lifestyleSet.size,
      },
      null,
      2
    )
  );
}

await main();
