import fs from "node:fs/promises";
import path from "node:path";
import * as cmu from "cmu-pronouncing-dictionary";
import { lookupIpa } from "./lib/ipa-convert.mjs";

const TARGET = path.resolve("src/data/toeic/words.enriched.generated.ts");
const OVERRIDES = path.resolve("src/data/sources/ipa/overrides.json");

function escapeTsString(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function loadOverrides() {
  try {
    const raw = await fs.readFile(OVERRIDES, "utf8");
    const json = JSON.parse(raw);
    return json && typeof json === "object" ? json : {};
  } catch {
    return {};
  }
}

async function main() {
  const force = process.argv.includes("--force");
  const src = await fs.readFile(TARGET, "utf8");
  const overrides = await loadOverrides();
  const dict = cmu?.dictionary ?? cmu?.default?.dictionary ?? cmu?.default ?? cmu;

  const lines = src.split(/\r?\n/);
  const out = [];
  /** @type {{term: string, id: string}[]} */
  const missing = [];
  let updated = 0;

  for (const line of lines) {
    if (!line.includes("{ id:") || !line.includes("term:")) {
      out.push(line);
      continue;
    }
    if (line.includes("ipa:") && !force) {
      out.push(line);
      continue;
    }

    const id = line.match(/id:\s*"([^"]+)"/)?.[1] ?? "";
    const term = line.match(/term:\s*"([^"]+)"/)?.[1] ?? "";
    const pos = line.match(/partOfSpeech:\s*"([^"]+)"/)?.[1];
    if (!term) {
      out.push(line);
      continue;
    }

    const ipa = lookupIpa(term, overrides, dict, /** @type {any} */ (pos));
    if (!ipa) {
      missing.push({ term, id });
      out.push(line);
      continue;
    }

    let patched;
    if (line.includes("ipa:")) {
      patched = line.replace(/ipa:\s*"[^"]*"/, `ipa: "${escapeTsString(ipa)}"`);
    } else {
      patched = line.replace(/(term:\s*"[^"]+",)/, `$1 ipa: "${escapeTsString(ipa)}",`);
    }
    if (patched !== line) updated++;
    out.push(patched);
  }

  if (missing.length > 0) {
    console.error(
      `IPA missing: ${missing.length}\n` +
        missing
          .slice(0, 80)
          .map((m) => `- ${m.term} (${m.id})`)
          .join("\n") +
        (missing.length > 80 ? `\n... and ${missing.length - 80} more` : "")
    );
    process.exitCode = 1;
    return;
  }

  await fs.writeFile(TARGET, out.join("\n"), "utf8");
  console.log(`OK: filled ipa (force=${force}, updated=${updated}).`);
}

await main();
