import { getAllWords } from "../src/lib/vocab";
import { WORD_RELATIONS } from "../src/data/toeic/word-relations.generated";

const words = getAllWords();
const byTerm = new Map(words.map((w) => [w.term.toLowerCase(), w]));

type Issue = { id: string; term: string; kind: string; detail: string };
const issues: Issue[] = [];

const JA_IN_COL = /[\u3040-\u30FF\u4E00-\u9FFF]/;

for (const w of words) {
  const rel = WORD_RELATIONS[w.id];
  if (!rel) {
    issues.push({ id: w.id, term: w.term, kind: "missing", detail: "no relations entry" });
    continue;
  }

  if (!rel.collocations?.length) {
    issues.push({ id: w.id, term: w.term, kind: "col-empty", detail: "" });
  }
  for (const c of rel.collocations ?? []) {
    if (!c.trim()) issues.push({ id: w.id, term: w.term, kind: "col-blank", detail: c });
    if (JA_IN_COL.test(c)) issues.push({ id: w.id, term: w.term, kind: "col-ja", detail: c });
    if (c.length > 80) issues.push({ id: w.id, term: w.term, kind: "col-long", detail: c });
    const t = w.term.toLowerCase();
    const cl = c.toLowerCase();
    const hasTerm =
      cl.includes(t) ||
      (t.endsWith("y") && cl.includes(t.slice(0, -1) + "ies")) ||
      cl.includes(t + "s") ||
      cl.includes(t + "ed") ||
      cl.includes(t + "ing") ||
      (t.endsWith("e") && cl.includes(t.slice(0, -1) + "ing"));
    if (!hasTerm) {
      issues.push({ id: w.id, term: w.term, kind: "col-no-term", detail: c });
    }
  }

  if (!rel.wordFamily?.length) {
    issues.push({ id: w.id, term: w.term, kind: "fam-empty", detail: "" });
  }
  const fam = rel.wordFamily ?? [];
  if (!fam.some((f) => f.toLowerCase() === w.term.toLowerCase())) {
    issues.push({
      id: w.id,
      term: w.term,
      kind: "fam-missing-self",
      detail: fam.join(", "),
    });
  }
  const a = w.term.toLowerCase().replace(/[^a-z]/g, "");
  for (const f of fam) {
    if (f.toLowerCase() === w.term.toLowerCase()) continue;
    const b = f.toLowerCase().replace(/[^a-z]/g, "");
    const share4 =
      a.slice(0, 4) === b.slice(0, 4) ||
      (a.length >= 4 && b.includes(a.slice(0, 4))) ||
      (b.length >= 4 && a.includes(b.slice(0, 4))) ||
      (a.length >= 5 && b.startsWith(a.slice(0, 5))) ||
      (b.length >= 5 && a.startsWith(b.slice(0, 5)));
    // special: dependable/dependence, reliable/reliability already share
    if (!share4) {
      issues.push({
        id: w.id,
        term: w.term,
        kind: "fam-unrelated",
        detail: `${w.term} ↔ ${f}`,
      });
    }
  }
}

let asymmetric = 0;
for (const w of words) {
  const fam = WORD_RELATIONS[w.id]?.wordFamily ?? [];
  for (const f of fam) {
    if (f.toLowerCase() === w.term.toLowerCase()) continue;
    const other = byTerm.get(f.toLowerCase());
    if (!other) continue;
    const ofam = WORD_RELATIONS[other.id]?.wordFamily ?? [];
    if (!ofam.some((x) => x.toLowerCase() === w.term.toLowerCase())) {
      asymmetric++;
      if (asymmetric <= 30) {
        issues.push({
          id: w.id,
          term: w.term,
          kind: "fam-asymmetric",
          detail: `${w.term}→${f} but not reverse`,
        });
      }
    }
  }
}

const byKind = new Map<string, number>();
for (const i of issues) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
console.log("=== issue counts ===");
console.log(Object.fromEntries([...byKind.entries()].sort((a, b) => b[1] - a[1])));
console.log("total issues", issues.length);

for (const kind of [
  "fam-unrelated",
  "col-no-term",
  "col-ja",
  "col-long",
  "fam-asymmetric",
  "missing",
  "fam-missing-self",
]) {
  const list = issues.filter((i) => i.kind === kind);
  if (!list.length) continue;
  console.log(`\n--- ${kind} (${list.length}) ---`);
  for (const i of list.slice(0, 40)) console.log(`${i.term}: ${i.detail}`);
}

let weakOnly = 0;
const weakSamples: string[] = [];
for (const w of words) {
  const cols = WORD_RELATIONS[w.id]?.collocations ?? [];
  const weak = cols.every(
    (c) =>
      c === w.term ||
      c === `to ${w.term}` ||
      c === `the ${w.term}` ||
      c === `${w.term} + noun`
  );
  if (weak) {
    weakOnly++;
    if (weakSamples.length < 20) weakSamples.push(w.term);
  }
}
console.log("\nweak-only collocations:", weakOnly, weakSamples);

const spot = [
  "abide",
  "absorb",
  "absent",
  "accuracy",
  "accurately",
  "applicant",
  "applicable",
  "dependable",
  "dependence",
  "reliable",
  "reliability",
  "comply",
  "compliance",
  "invest",
  "investment",
  "investor",
  "participate",
  "participation",
  "participant",
  "submit",
  "submission",
  "approve",
  "approval",
  "cancel",
  "cancellation",
  "confirm",
  "confirmation",
  "negotiate",
  "negotiation",
  "meet",
  "meeting",
  "schedule",
  "scheduled",
  "elephant",
  "pizza",
];
console.log("\n=== spot check ===");
for (const t of spot) {
  const w = byTerm.get(t);
  if (!w) {
    console.log(t, "NOT IN LIST");
    continue;
  }
  const r = WORD_RELATIONS[w.id];
  console.log(`${t}\n  col: ${r.collocations.join(" | ")}\n  fam: ${r.wordFamily.join(", ")}`);
}
