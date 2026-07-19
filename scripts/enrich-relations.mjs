/**
 * 全単語にコロケーション・語族を付与して word-relations.generated.ts を生成する。
 * - 例文ウィンドウ / 前置詞結合 / 動詞パターンからコロケーション
 * - 語幹グループ + 収録内の形態変換から語族（未収録の造語は出さない）
 * - overrides JSON で上書き
 */
import fs from "node:fs/promises";
import path from "node:path";

const WORDS = path.resolve("src/data/toeic/words.enriched.generated.ts");
const OVERRIDES = path.resolve(
  "src/data/sources/vocab-patches/relations-overrides.json"
);
const OUT = path.resolve("src/data/toeic/word-relations.generated.ts");

const SUFFIXES = [
  "ization",
  "isation",
  "ational",
  "ation",
  "ition",
  "sion",
  "ment",
  "ance",
  "ence",
  "ness",
  "ability",
  "ibility",
  "able",
  "ible",
  "ally",
  "fully",
  "ously",
  "ively",
  "ator",
  "itor",
  "ency",
  "ancy",
  "ship",
  "hood",
  "ical",
  "ious",
  "eous",
  "ive",
  "ize",
  "ise",
  "ify",
  "ing",
  "ers",
  "ors",
  "ies",
  "ied",
  "er",
  "or",
  "ly",
  "al",
  "ed",
  "es",
  "s",
  "y",
];

const PREPS =
  "by|to|for|with|from|on|in|into|onto|of|about|over|under|against|after|before|through|across|along|around|at|up|out|off|away";

const ALLOWED_PREPS = new Set([
  "by",
  "on",
  "in",
  "for",
  "with",
  "from",
  "to",
  "out",
  "off",
  "about",
  "into",
  "of",
  "after",
  "before",
  "against",
  "through",
]);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stem(term) {
  let t = term.toLowerCase().replace(/[-']/g, "");
  for (let pass = 0; pass < 2; pass++) {
    let cut = false;
    for (const s of SUFFIXES) {
      if (t.length > s.length + 3 && t.endsWith(s)) {
        t = t.slice(0, -s.length);
        cut = true;
        break;
      }
    }
    if (!cut) break;
  }
  if (t.endsWith("i") && t.length > 3) t = `${t.slice(0, -1)}y`;
  return t.length >= 3 ? t : term.toLowerCase().replace(/[-']/g, "");
}

function parseWords(src) {
  const rows = [];
  for (const line of src.split(/\r?\n/)) {
    if (!line.includes("{ id:") || !line.includes("term:")) continue;
    const id = line.match(/id:\s*"([^"]+)"/)?.[1];
    const term = line.match(/term:\s*"([^"]+)"/)?.[1];
    const pos = line.match(/partOfSpeech:\s*"([^"]+)"/)?.[1];
    const exampleEn = line
      .match(/exampleEn:\s*"((?:\\.|[^"\\])*)"/)?.[1]
      ?.replace(/\\"/g, '"');
    if (id && term) rows.push({ id, term, pos, exampleEn });
  }
  return rows;
}

function normalizeToken(tok) {
  return tok.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, "");
}

function findTermIndex(tokens, term) {
  const t = term.toLowerCase();
  const re = new RegExp(`^${escapeRe(t)}(?:'s|s|es|ed|ing)?$`, "i");
  for (let i = 0; i < tokens.length; i++) {
    if (re.test(normalizeToken(tokens[i]))) return i;
  }
  for (let i = 0; i < tokens.length; i++) {
    const n = normalizeToken(tokens[i]).toLowerCase();
    if (n.startsWith(t) && n.length <= t.length + 3) return i;
  }
  return -1;
}

function extractPhraseWindow(term, exampleEn) {
  if (!exampleEn) return null;
  const tokens = exampleEn.split(/\s+/).filter(Boolean);
  const idx = findTermIndex(tokens, term);
  if (idx < 0) return null;
  const start = Math.max(0, idx - 2);
  const end = Math.min(tokens.length, idx + 4);
  let phrase = tokens
    .slice(start, end)
    .join(" ")
    .replace(/^[^A-Za-z"]+/, "")
    .replace(/[.,;:!?]+$/g, "")
    .trim();
  phrase = phrase.replace(/^[“"]|[”"]$/g, "");
  if (phrase.length < term.length) return null;
  return phrase;
}

function extractCollocations(term, exampleEn, pos) {
  const out = [];
  const seen = new Set();
  const add = (c) => {
    const s = c?.trim();
    if (!s) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  if (exampleEn) {
    const t = term.toLowerCase();
    const escaped = escapeRe(t);
    const re = new RegExp(
      `\\b${escaped}(?:s|es|ed|ing)?\\s+(${PREPS})\\b(?!\\s+to\\b)`,
      "gi"
    );
    let m;
    while ((m = re.exec(exampleEn)) != null) {
      const prep = m[1].toLowerCase();
      if (!ALLOWED_PREPS.has(prep) || prep === "up") continue;
      add(`${term} ${prep}`);
    }

    const ahead = new RegExp(
      `\\b(make|take|place|hold|attend|submit|sign|cancel|confirm|fill|pay|send|receive|offer|provide|require|request|reach|meet)\\s+(?:an?\\s+|the\\s+)?${escaped}\\b`,
      "i"
    );
    const am = exampleEn.match(ahead);
    if (am) add(`${am[1].toLowerCase()} ${term}`);

    const phrase = extractPhraseWindow(term, exampleEn);
    if (phrase) add(phrase);
  }

  if (out.length === 0) {
    if (pos === "v") add(`to ${term}`);
    else if (pos === "n") add(`the ${term}`);
    else if (pos === "adj") add(`${term} + noun`);
    else if (pos === "adv") add(term);
    else add(term);
  }

  return out.slice(0, 4);
}

/**
 * 収録語集合に存在する形態だけを返す（造語は出さない）
 * @param {string} term
 * @param {Set<string>} termSet lowercase
 */
function relatedInList(term, termSet) {
  const t = term.toLowerCase();
  /** @type {string[]} */
  const cands = [];
  const push = (x) => {
    if (!x || x.length < 3) return;
    if (termSet.has(x)) cands.push(x);
  };

  // 双方向のよくある変換
  push(`${t}ly`);
  push(`${t}ness`);
  push(`${t}er`);
  push(`${t}or`);
  push(`${t}ment`);
  push(`${t}able`);
  push(`${t}ible`);
  push(`${t}al`);
  push(`${t}ous`);
  push(`${t}ive`);
  push(`${t}ion`);
  push(`${t}ation`);
  push(`${t}ize`);
  push(`${t}ise`);
  push(`${t}ing`);
  push(`${t}ed`);
  push(`${t}s`);
  push(`${t}es`);

  if (t.endsWith("e")) {
    const s = t.slice(0, -1);
    push(`${s}ing`);
    push(`${s}ion`);
    push(`${s}ation`);
    push(`${s}able`);
    push(`${s}or`);
    push(`${s}er`);
  }
  if (t.endsWith("y") && t.length > 3) {
    const s = t.slice(0, -1);
    push(`${s}ies`);
    push(`${s}ied`);
    push(`${s}iness`);
  }
  if (t.endsWith("ly") && t.length > 4) push(t.slice(0, -2));
  if (t.endsWith("ness") && t.length > 5) push(t.slice(0, -4));
  if (t.endsWith("ment") && t.length > 5) push(t.slice(0, -4));
  if (t.endsWith("tion") && t.length > 5) {
    push(t.replace(/ation$/, "ate"));
    push(t.replace(/ition$/, "ite"));
    push(`${t.slice(0, -4)}e`);
  }
  if (t.endsWith("sion") && t.length > 5) push(`${t.slice(0, -4)}e`);
  if (t.endsWith("ence")) push(`${t.slice(0, -4)}ent`);
  if (t.endsWith("ance")) push(`${t.slice(0, -4)}ant`);
  if (t.endsWith("ent") && t.length > 4) push(`${t.slice(0, -3)}ence`);
  if (t.endsWith("ant") && t.length > 4) push(`${t.slice(0, -3)}ance`);
  if (t.endsWith("ity") && t.length > 4) {
    push(`${t.slice(0, -3)}e`);
    push(`${t.slice(0, -3)}y`);
  }
  if (t.endsWith("acy") && t.length > 4) {
    push(`${t.slice(0, -3)}ate`);
    push(`${t.slice(0, -3)}ately`);
  }
  if (t.endsWith("ately") && t.length > 6) {
    push(`${t.slice(0, -5)}acy`);
    push(`${t.slice(0, -5)}ate`);
  }
  if (t.endsWith("ate") && t.length > 4) {
    push(`${t.slice(0, -1)}ion`);
    push(`${t.slice(0, -3)}acy`);
    push(`${t}ly`);
  }
  if (t.endsWith("ant") && t.length > 4) {
    push(`${t.slice(0, -3)}able`);
    push(`${t.slice(0, -3)}ance`);
  }
  if (t.endsWith("able") && t.length > 5) {
    push(`${t.slice(0, -4)}ant`);
    push(`${t.slice(0, -4)}ation`);
    push(`${t.slice(0, -4)}ate`);
  }
  if (t.endsWith("ance") && t.length > 5) {
    push(`${t.slice(0, -4)}ant`);
    push(`${t.slice(0, -4)}able`);
  }
  if (t.endsWith("ence") && t.length > 5) {
    push(`${t.slice(0, -4)}ent`);
    push(`${t.slice(0, -4)}able`);
  }
  if (t.endsWith("ent") && t.length > 4) {
    push(`${t.slice(0, -3)}ence`);
    push(`${t.slice(0, -3)}able`);
  }
  if (t.endsWith("ize") || t.endsWith("ise")) {
    push(`${t.slice(0, -3)}ization`);
    push(`${t.slice(0, -3)}isation`);
  }
  if (t.endsWith("able") || t.endsWith("ible")) push(t.slice(0, -4));
  if (t.endsWith("er") || t.endsWith("or")) push(t.slice(0, -2));
  if (t.endsWith("ive") && t.length > 4) push(`${t.slice(0, -3)}ion`);
  if (t.endsWith("al") && t.length > 4) push(t.slice(0, -2));

  // 元の表記に合わせて返す（termSet は lower）
  return [...new Set(cands)];
}

function canonicalTerm(lower, termByLower) {
  return termByLower.get(lower) ?? lower;
}

function buildFamily(term, byStem, termSet, termByLower) {
  const s = stem(term);
  const fromStem = byStem.get(s) ?? [];
  const morph = relatedInList(term, termSet).map((l) =>
    canonicalTerm(l, termByLower)
  );

  const family = [];
  const seen = new Set();
  for (const x of [term, ...fromStem, ...morph]) {
    const key = x.toLowerCase();
    if (seen.has(key)) continue;
    // 同じ stem でも語幹距離が遠い誤結合を除外
    if (x !== term && fromStem.includes(x)) {
      const xs = stem(x);
      if (xs !== s && !xs.startsWith(s) && !s.startsWith(xs)) continue;
    }
    seen.add(key);
    family.push(x);
    if (family.length >= 8) break;
  }
  return family;
}

async function main() {
  const [src, overridesRaw] = await Promise.all([
    fs.readFile(WORDS, "utf8"),
    fs.readFile(OVERRIDES, "utf8").catch(() => "{}"),
  ]);
  const overrides = JSON.parse(overridesRaw);
  const words = parseWords(src);
  const termSet = new Set(words.map((w) => w.term.toLowerCase()));
  /** @type {Map<string, string>} */
  const termByLower = new Map(words.map((w) => [w.term.toLowerCase(), w.term]));

  /** @type {Map<string, string[]>} */
  const byStem = new Map();
  for (const w of words) {
    const s = stem(w.term);
    if (!byStem.has(s)) byStem.set(s, []);
    byStem.get(s).push(w.term);
  }

  /** @type {Record<string, { collocations: string[]; wordFamily: string[] }>} */
  const relations = {};

  for (const w of words) {
    const ov = overrides[w.id] ?? overrides[w.term] ?? {};
    const autoCol = extractCollocations(w.term, w.exampleEn, w.pos);
    const autoFam = buildFamily(w.term, byStem, termSet, termByLower);

    const collocations = [
      ...new Set([...(ov.collocations ?? []), ...autoCol]),
    ].slice(0, 5);

    let wordFamily = [...new Set([...(ov.wordFamily ?? []), ...autoFam])]
      .filter(Boolean)
      .map((t) => canonicalTerm(t.toLowerCase(), termByLower) ?? t);

    // override の未収録語も学習表示として残す（手動指定のみ）
    wordFamily = [
      ...new Set([
        ...wordFamily,
        ...(ov.wordFamily ?? []).filter((t) => typeof t === "string"),
      ]),
    ];

    wordFamily.sort((a, b) => {
      if (a.toLowerCase() === w.term.toLowerCase()) return -1;
      if (b.toLowerCase() === w.term.toLowerCase()) return 1;
      return a.localeCompare(b);
    });
    wordFamily = wordFamily.slice(0, 8);

    if (collocations.length === 0) collocations.push(`the ${w.term}`);
    if (wordFamily.length === 0) wordFamily.push(w.term);

    relations[w.id] = { collocations, wordFamily };
  }

  const ids = Object.keys(relations).sort();
  const body = ids
    .map((id) => {
      const r = relations[id];
      return `  ${JSON.stringify(id)}: { collocations: [${r.collocations
        .map((c) => JSON.stringify(c))
        .join(", ")}], wordFamily: [${r.wordFamily
        .map((c) => JSON.stringify(c))
        .join(", ")}] },`;
    })
    .join("\n");

  const file = `// GENERATED by scripts/enrich-relations.mjs — do not edit by hand.
// Coverage: all ${ids.length} headwords. Overrides: src/data/sources/vocab-patches/relations-overrides.json

export type WordRelations = {
  collocations: string[];
  wordFamily: string[];
};

export const WORD_RELATIONS: Record<string, WordRelations> = {
${body}
};
`;

  await fs.writeFile(OUT, file, "utf8");

  let famMulti = 0;
  for (const id of ids) {
    if (relations[id].wordFamily.length > 1) famMulti++;
  }

  console.log(
    JSON.stringify(
      {
        total: ids.length,
        withCollocations: ids.length,
        withFamily: ids.length,
        familySizeGe2: famMulti,
        familySize1: ids.length - famMulti,
      },
      null,
      2
    )
  );
}

await main();
