"use client";

import Link from "next/link";
import type { ToeicWord } from "@/lib/vocab";
import { getWordByTerm } from "@/lib/vocab";
import { cn, focusRingLink } from "@/lib/utils";

export function WordRelationsBlock({
  word,
  className,
}: {
  word: ToeicWord;
  className?: string;
}) {
  const collocations = word.collocations?.filter(Boolean) ?? [];
  const family = word.wordFamily?.filter(Boolean) ?? [];

  if (collocations.length === 0 && family.length === 0) return null;

  return (
    <div className={cn("space-y-3", className)}>
      {collocations.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">コロケーション</p>
          <ul className="space-y-1">
            {collocations.map((c) => (
              <li
                key={c}
                className="rounded-lg border border-border/50 bg-muted/15 px-2.5 py-1.5 font-mono text-sm text-foreground"
                lang="en"
              >
                {c}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {family.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">語族</p>
          <div className="flex flex-wrap gap-1.5">
            {family.map((term) => {
              const isSelf = term.toLowerCase() === word.term.toLowerCase();
              const related = isSelf ? null : getWordByTerm(term);
              if (isSelf) {
                return (
                  <span
                    key={term}
                    className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
                    aria-current="true"
                  >
                    {term}
                  </span>
                );
              }
              if (related) {
                return (
                  <Link
                    key={term}
                    href={`/words/${encodeURIComponent(related.id)}`}
                    className={cn(
                      focusRingLink,
                      "rounded-full border border-border/70 bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
                    )}
                  >
                    {term}
                  </Link>
                );
              }
              return (
                <span
                  key={term}
                  title="未収録の関連語"
                  className="rounded-full border border-dashed border-border/60 bg-muted/15 px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {term}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
