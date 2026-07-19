/**
 * コロケーション・語族を生成して word-relations.generated.ts に書き出す。
 * - リスト内の語幹グループから語族を推定
 * - 例文から動詞＋前置詞のコロケーションを抽出
 * - overrides JSON で上書き
 */
import fs from "node:fs/promises";
import path from "node:path";

const WORDS = path.resolve("src/data/toeic/words.enriched.generated.ts");
const OVERRIDES = path.resolve("src/data/sources/vocab-patches/relations-overrides.json");
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
  "able",
  "ible",
  "ally",
  "fully",
  "ously",
  "ively",
  "ator",
  "itor",
  "ance",
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

function stem(term) {
  let t = term.toLowerCase().replace(/[-']/g, "");
  for (const s of SUFFIXES) {
    if (t.length > s.length + 3 && t.endsWith(s)) {
      t = t.slice(0, -s.length);
      break;
    }
  }
  if (t.endsWith("i") && t.length > 3) t = t.slice(0, -1) + "y";
  return t.length >= 3 ? t : term.toLowerCase().replace(/[-']/g, "");
}

function parseWords(src) {
  const rows = [];
  for (const line of src.split(/\r?\n/)) {
    if (!line.includes("{ id:") || !line.includes("term:")) continue;
    const id = line.match(/id:\s*"([^"]+)"/)?.[1];
    const term = line.match(/term:\s*"([^"]+)"/)?.[1];
    const pos = line.match(/partOfSpeech:\s*"([^"]+)"/)?.[1];
    const exampleEn = line.match(/exampleEn:\s*"((?:\\.|[^"\\])*)"/)?.[1]?.replace(/\\"/g, '"');
    if (id && term) rows.push({ id, term, pos, exampleEn });
  }
  return rows;
}

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

function extractCollocations(term, exampleEn, pos) {
  if (!exampleEn) return [];
  const t = term.toLowerCase();
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out = new Set();
  const re = new RegExp(
    `\\b${escaped}(?:s|es|ed|ing)?\\s+(${PREPS})\\b(?!\\s+to\\b)`,
    "gi"
  );
  let m;
  while ((m = re.exec(exampleEn)) != null) {
    const prep = m[1].toLowerCase();
    if (!ALLOWED_PREPS.has(prep)) continue;
    // "up to" などの数量表現を除外
    if (prep === "up") continue;
    out.add(`${term} ${prep}`);
  }
  if (pos === "n" || pos === "v") {
    const ahead = new RegExp(
      `\\b(make|take|place|hold|attend|submit|sign|cancel|confirm|fill)\\s+(?:an?\\s+|the\\s+)?${escaped}\\b`,
      "i"
    );
    const am = exampleEn.match(ahead);
    if (am) out.add(`${am[1].toLowerCase()} ${term}`);
  }
  return [...out].slice(0, 3);
}

async function main() {
  const [src, overridesRaw] = await Promise.all([
    fs.readFile(WORDS, "utf8"),
    fs.readFile(OVERRIDES, "utf8").catch(() => "{}"),
  ]);
  const overrides = JSON.parse(overridesRaw);
  const words = parseWords(src);

  /** @type {Map<string, string[]>} */
  const byStem = new Map();
  for (const w of words) {
    const s = stem(w.term);
    if (!byStem.has(s)) byStem.set(s, []);
    byStem.get(s).push(w.term);
  }

  /** @type {Record<string, { collocations?: string[]; wordFamily?: string[] }>} */
  const relations = {};

  for (const w of words) {
    const uniqueFamily = [...new Set(byStem.get(stem(w.term)) ?? [])].sort((a, b) =>
      a.localeCompare(b)
    );

    const collocations = extractCollocations(w.term, w.exampleEn, w.pos);
    const ov = overrides[w.id] ?? overrides[w.term] ?? {};

    const mergedFamily = [
      ...new Set([...(ov.wordFamily ?? []), ...(uniqueFamily.length > 1 ? uniqueFamily : [])]),
    ]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const mergedCol = [
      ...new Set([...(ov.collocations ?? []), ...collocations]),
    ].slice(0, 5);

    if (mergedFamily.length > 1 || mergedCol.length > 0) {
      relations[w.id] = {};
      if (mergedCol.length) relations[w.id].collocations = mergedCol;
      if (mergedFamily.length > 1) relations[w.id].wordFamily = mergedFamily;
    }
  }

  for (const [id, ov] of Object.entries(overrides)) {
    if (!relations[id]) relations[id] = {};
    if (ov.collocations?.length) {
      relations[id].collocations = [
        ...new Set([...(relations[id].collocations ?? []), ...ov.collocations]),
      ].slice(0, 5);
    }
    if (ov.wordFamily?.length && ov.wordFamily.length > 1) {
      relations[id].wordFamily = [
        ...new Set([...(relations[id].wordFamily ?? []), ...ov.wordFamily]),
      ].sort((a, b) => a.localeCompare(b));
    }
    if (
      !relations[id].collocations?.length &&
      !(relations[id].wordFamily && relations[id].wordFamily.length > 1)
    ) {
      delete relations[id];
    }
  }

  const ids = Object.keys(relations).sort();
  const body = ids
    .map((id) => {
      const r = relations[id];
      const parts = [];
      if (r.collocations?.length) {
        parts.push(
          `collocations: [${r.collocations.map((c) => JSON.stringify(c)).join(", ")}]`
        );
      }
      if (r.wordFamily?.length) {
        parts.push(
          `wordFamily: [${r.wordFamily.map((c) => JSON.stringify(c)).join(", ")}]`
        );
      }
      return `  ${JSON.stringify(id)}: { ${parts.join(", ")} },`;
    })
    .join("\n");

  const file = `// GENERATED by scripts/enrich-relations.mjs — do not edit by hand.
// Overrides: src/data/sources/vocab-patches/relations-overrides.json

export type WordRelations = {
  collocations?: string[];
  wordFamily?: string[];
};

export const WORD_RELATIONS: Record<string, WordRelations> = {
${body}
};
`;

  await fs.writeFile(OUT, file, "utf8");
  console.log(
    JSON.stringify(
      {
        entries: ids.length,
        withCollocations: ids.filter((id) => relations[id].collocations?.length).length,
        withFamily: ids.filter((id) => relations[id].wordFamily?.length).length,
      },
      null,
      2
    )
  );
}

await main();
