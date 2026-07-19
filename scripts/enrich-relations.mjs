/**
 * 全単語にコロケーション・語族を付与して word-relations.generated.ts を生成する。
 * - 例文ウィンドウ / 前置詞結合 / 動詞パターンからコロケーション
 * - 収録内の安全な形態変換のみで語族（誤結合を避ける）
 * - ブロックリスト・双方向化・overrides
 */
import fs from "node:fs/promises";
import path from "node:path";

const WORDS = path.resolve("src/data/toeic/words.enriched.generated.ts");
const OVERRIDES = path.resolve(
  "src/data/sources/vocab-patches/relations-overrides.json"
);
const OUT = path.resolve("src/data/toeic/word-relations.generated.ts");

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

/** 形態が似ていても学習上の語族にしない組（lower, sorted pair key） */
const FAMILY_BLOCKLIST = new Set(
  [
    ["compliance", "compliment"],
    ["format", "formation"],
    ["durable", "duration"],
    ["audit", "audition"],
    ["transit", "transition"],
    ["concert", "concern"],
    ["content", "contest"],
    ["resource", "source"],
  ].map(([a, b]) => [a, b].sort().join("|"))
);

function blocked(a, b) {
  return FAMILY_BLOCKLIST.has([a.toLowerCase(), b.toLowerCase()].sort().join("|"));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fold(s) {
  return s.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();
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
  return tok.replace(/^[^A-Za-zÀ-ÿ']+|[^A-Za-zÀ-ÿ']+$/g, "");
}

function findTermIndex(tokens, term) {
  const t = fold(term);
  for (let i = 0; i < tokens.length; i++) {
    const n = fold(normalizeToken(tokens[i]));
    if (!n) continue;
    if (
      n === t ||
      n === `${t}s` ||
      n === `${t}es` ||
      n === `${t}ed` ||
      n === `${t}ing` ||
      n === `${t}en` ||
      (t.endsWith("e") &&
        (n === `${t.slice(0, -1)}ing` ||
          n === `${t.slice(0, -1)}ed` ||
          n === `${t}d`)) ||
      (t.endsWith("y") &&
        (n === `${t.slice(0, -1)}ies` || n === `${t.slice(0, -1)}ied`))
    ) {
      return i;
    }
    // 子音重複 + ed/ing（embed→embedded, equip→equipped）
    if (t.length >= 3) {
      const last = t[t.length - 1];
      if (/[bcdfghjklmnpqrstvwxyz]/.test(last)) {
        if (n === `${t}${last}ed` || n === `${t}${last}ing`) return i;
      }
    }
    // forbid→forbidden 等、語幹一致の屈折
    if (n.startsWith(t) && n.length <= t.length + 4) return i;
    if (
      t.endsWith("e") &&
      n.startsWith(t.slice(0, -1)) &&
      n.length <= t.length + 3
    ) {
      return i;
    }
    // E-commerce / by-law など
    if (n.includes(t) && (n.includes("-") || n.length <= t.length + 2)) {
      return i;
    }
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
    .replace(/^[^A-Za-z"“]+/, "")
    .replace(/[.,;:!?]+$/g, "")
    .trim();
  phrase = phrase.replace(/^[“"]|[”"]$/g, "");
  if (phrase.length < Math.min(term.length, 3)) return null;
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

    // café 等の diacritic
    const foldedEx = fold(exampleEn);
    const foldedTerm = fold(term);
    const prepRe = new RegExp(
      `\\b${escapeRe(foldedTerm)}(?:s|es|ed|ing)?\\s+(${PREPS})\\b(?!\\s+to\\b)`,
      "gi"
    );
    while ((m = prepRe.exec(foldedEx)) != null) {
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
 * 収録語集合に存在する、安全な形態だけを返す
 * @param {string} term
 * @param {Set<string>} termSet lowercase
 */
function relatedInList(term, termSet) {
  const t = term.toLowerCase();
  /** @type {string[]} */
  const cands = [];
  const push = (x) => {
    if (!x || x.length < 3) return;
    if (x === t) return;
    if (blocked(t, x)) return;
    if (termSet.has(x)) cands.push(x);
  };

  // 副詞・形容詞
  push(`${t}ly`);
  push(`${t}ness`);
  if (t.endsWith("ly") && t.length > 4) push(t.slice(0, -2));
  if (t.endsWith("ness") && t.length > 5) push(t.slice(0, -4));

  // 行為者
  push(`${t}er`);
  push(`${t}or`);
  if (t.endsWith("e")) {
    push(`${t}r`);
    push(`${t.slice(0, -1)}or`);
    push(`${t.slice(0, -1)}er`);
  }
  if (t.endsWith("er") || t.endsWith("or")) push(t.slice(0, -2));

  // -ate / -ation / -ator（安全寄り）
  if (t.endsWith("ate") && t.length > 4) {
    push(`${t.slice(0, -1)}ion`); // negotiate → negotiation
    push(`${t}r`);
    push(`${t.slice(0, -1)}or`);
    push(`${t}ly`);
  }
  if (t.endsWith("ation") && t.length > 6) {
    push(t.replace(/ation$/, "ate"));
    push(t.replace(/ation$/, "ator"));
  }
  if (t.endsWith("ator") && t.length > 5) {
    push(`${t.slice(0, -2)}e`);
    push(`${t.slice(0, -2)}ion`);
  }

  // 動詞の屈折・派生（短い語への +ion は禁止）
  if (t.endsWith("e")) {
    const s = t.slice(0, -1);
    push(`${s}ing`);
    push(`${s}able`);
  } else {
    push(`${t}ing`);
    push(`${t}ed`);
    push(`${t}able`);
  }

  // -y 動詞
  if (t.endsWith("y") && t.length > 3 && !t.endsWith("ly")) {
    push(`${t.slice(0, -1)}ies`);
    push(`${t.slice(0, -1)}ied`);
    push(`${t.slice(0, -1)}iance`); // comply → compliance
  }

  // 名詞・形容詞ペア
  if (t.endsWith("ity") && t.length > 4) {
    push(`${t.slice(0, -3)}e`);
    push(`${t.slice(0, -3)}y`);
    push(t.replace(/ility$/, "le").replace(/ivity$/, "ive"));
  }
  if (t.endsWith("ive") && t.length > 4) {
    push(`${t.slice(0, -3)}ion`);
    push(`${t}ly`);
    push(`${t.slice(0, -3)}ivity`);
  }
  if (t.endsWith("able") && t.length > 5) {
    push(t.slice(0, -4));
    push(`${t.slice(0, -4)}e`);
  }
  if (t.endsWith("ible") && t.length > 5) push(t.slice(0, -4));

  if (t.endsWith("ence") && t.length > 5) push(`${t.slice(0, -4)}ent`);
  if (t.endsWith("ent") && t.length > 4) {
    push(`${t.slice(0, -3)}ence`);
    // dependable 系: dependence ↔ dependent は別途
  }
  if (t.endsWith("ance") && t.length > 5) {
    push(`${t.slice(0, -4)}ant`);
    // compliment 誤爆防止: -ance → -iment は作らない
  }
  if (t.endsWith("ant") && t.length > 4) {
    push(`${t.slice(0, -3)}ance`);
    push(`${t.slice(0, -3)}able`);
  }

  // dependence / dependable
  if (t.endsWith("ence")) push(`${t.slice(0, -4)}able`);
  if (t.endsWith("able") && t.length > 6) push(`${t.slice(0, -4)}ence`);

  // reliability / reliable
  if (t.endsWith("ability")) push(t.replace(/ability$/, "able"));
  if (t.endsWith("able")) push(`${t.slice(0, -1)}ility`);

  // accuracy / accurately
  if (t.endsWith("acy")) {
    push(`${t.slice(0, -3)}ate`);
    push(`${t.slice(0, -3)}ately`);
  }
  if (t.endsWith("ately")) {
    push(`${t.slice(0, -5)}acy`);
    push(`${t.slice(0, -5)}ate`);
  }

  // ment 名詞 → 動詞（restore/restoration は tion 側で）
  if (t.endsWith("ment") && t.length > 6) {
    const base = t.slice(0, -4);
    push(base);
    push(`${base}e`);
  }

  // tion → 動詞
  if (t.endsWith("tion") && t.length > 6) {
    push(t.replace(/ation$/, "ate"));
    push(t.replace(/ition$/, "ite"));
    push(t.replace(/ution$/, "ute"));
    push(`${t.slice(0, -4)}e`);
  }
  if (t.endsWith("sion") && t.length > 6) {
    push(`${t.slice(0, -4)}e`);
    push(t.replace(/ission$/, "it"));
  }

  // 名詞複数は語族に入れない（apple/apples）

  return [...new Set(cands)];
}

function canonicalTerm(lower, termByLower) {
  return termByLower.get(lower) ?? lower;
}

function buildFamily(term, termSet, termByLower) {
  const morph = relatedInList(term, termSet).map((l) =>
    canonicalTerm(l, termByLower)
  );
  const family = [];
  const seen = new Set();
  for (const x of [term, ...morph]) {
    const key = x.toLowerCase();
    if (seen.has(key)) continue;
    if (x !== term && blocked(term, x)) continue;
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

  /** @type {Record<string, { collocations: string[]; wordFamily: string[] }>} */
  const relations = {};

  for (const w of words) {
    const ov = overrides[w.id] ?? overrides[w.term] ?? {};
    const autoCol = extractCollocations(w.term, w.exampleEn, w.pos);
    const autoFam = buildFamily(w.term, termSet, termByLower);

    const collocations = [
      ...new Set([...(ov.collocations ?? []), ...autoCol]),
    ].slice(0, 5);

    let wordFamily = [...new Set([...(ov.wordFamily ?? []), ...autoFam])]
      .filter(Boolean)
      .filter((t) => !blocked(w.term, t) || t.toLowerCase() === w.term.toLowerCase())
      .map((t) => canonicalTerm(t.toLowerCase(), termByLower) ?? t);

    // override の未収録語も残す（ブロック対象は除く）
    for (const t of ov.wordFamily ?? []) {
      if (typeof t !== "string") continue;
      if (blocked(w.term, t)) continue;
      wordFamily.push(t);
    }
    wordFamily = [...new Set(wordFamily)];

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

  // 収録語同士の語族を双方向化
  const idByTerm = new Map(words.map((w) => [w.term.toLowerCase(), w.id]));
  for (const w of words) {
    const fam = relations[w.id].wordFamily;
    for (const f of fam) {
      if (f.toLowerCase() === w.term.toLowerCase()) continue;
      if (blocked(w.term, f)) continue;
      const oid = idByTerm.get(f.toLowerCase());
      if (!oid) continue;
      const ofam = relations[oid].wordFamily;
      if (!ofam.some((x) => x.toLowerCase() === w.term.toLowerCase())) {
        ofam.push(w.term);
        ofam.sort((a, b) => {
          const ot = words.find((x) => x.id === oid)?.term?.toLowerCase();
          if (a.toLowerCase() === ot) return -1;
          if (b.toLowerCase() === ot) return 1;
          return a.localeCompare(b);
        });
        relations[oid].wordFamily = [...new Set(ofam)].slice(0, 8);
      }
    }
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
