import { TOEIC_WORDS, type ToeicWord as BaseToeicWord } from "@/data/toeic/words";
import { WORD_RELATIONS } from "@/data/toeic/word-relations.generated";

export type ToeicWord = BaseToeicWord & {
  /** よく使うコロケーション */
  collocations?: string[];
  /** 同じ語族の見出し語 */
  wordFamily?: string[];
};

function enrich(w: BaseToeicWord): ToeicWord {
  const rel = WORD_RELATIONS[w.id];
  if (!rel) return w;
  return {
    ...w,
    collocations: rel.collocations,
    wordFamily: rel.wordFamily,
  };
}

const ENRICHED: ToeicWord[] = TOEIC_WORDS.map(enrich);
const WORD_BY_ID = new Map<string, ToeicWord>(ENRICHED.map((w) => [w.id, w]));
const WORD_BY_TERM = new Map<string, ToeicWord>(
  ENRICHED.map((w) => [w.term.toLowerCase(), w])
);

export function getAllWords(): ToeicWord[] {
  return ENRICHED;
}

export function getWordById(id: string): ToeicWord | undefined {
  return WORD_BY_ID.get(id);
}

export function getWordByTerm(term: string): ToeicWord | undefined {
  return WORD_BY_TERM.get(term.trim().toLowerCase());
}
