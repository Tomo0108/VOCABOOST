"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { splitExampleAroundTerm } from "@/lib/example-svoc";
import type { ToeicWord } from "@/lib/vocab";
import {
  difficultyLabel,
  formatSceneTagLabel,
  getSceneTags,
  getWordDifficulty,
} from "@/lib/word-meta";
import { PartOfSpeechDisplay } from "@/components/app/part-of-speech-display";
import { speakEnglish } from "@/lib/speak";
import { Volume2 } from "lucide-react";

export function WordDetailPanel({
  word,
  className,
}: {
  word: ToeicWord;
  className?: string;
}) {
  const correctMeaning = word.meaningJa?.trim() || "—";
  const ex = splitExampleAroundTerm(
    word.exampleEn ?? "",
    word.term,
    word.partOfSpeech
  );
  const d = getWordDifficulty(word);
  const scenes = getSceneTags(word);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-normal tabular-nums">
          難易度 {d}（{difficultyLabel(d)}）
        </Badge>
        {scenes.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className={cn(
              "font-normal",
              tag === "daily" && "bg-amber-500/15 text-amber-900 dark:text-amber-100"
            )}
          >
            {formatSceneTagLabel(tag)}
          </Badge>
        ))}
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="break-words text-3xl font-semibold tracking-tight text-foreground">
            {word.term}
          </h1>
          {word.ipa ? (
            <p className="font-mono text-sm text-muted-foreground" lang="en">
              /{word.ipa}/
            </p>
          ) : null}
          {word.partOfSpeech ? (
            <PartOfSpeechDisplay partOfSpeech={word.partOfSpeech} size="lg" />
          ) : (
            <p className="text-sm text-muted-foreground">品詞未分類</p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0 rounded-xl"
          aria-label="英語を読み上げ"
          onClick={() => speakEnglish(word.term)}
        >
          <Volume2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-1 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-sm">
        <p className="text-xs font-medium text-muted-foreground">和訳</p>
        <p className="font-medium text-foreground">{correctMeaning}</p>
      </div>

      {word.exampleEn ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">例文（英語）</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg px-2 text-xs"
              aria-label="例文を読み上げ"
              onClick={() => speakEnglish(word.exampleEn!)}
            >
              <Volume2 className="mr-1 h-3.5 w-3.5" aria-hidden />
              例文を聞く
            </Button>
          </div>
          <p className="text-sm font-medium leading-relaxed text-foreground">
            {ex.found ? (
              <>
                {ex.before}
                <mark
                  className={cn(
                    "rounded-md px-1 py-0.5 font-semibold",
                    "bg-amber-400/35 text-amber-950 dark:bg-amber-400/25 dark:text-amber-50"
                  )}
                >
                  {ex.match}
                </mark>
                {ex.after}
              </>
            ) : (
              word.exampleEn
            )}
          </p>
          {word.exampleJa ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{word.exampleJa}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">この単語には例文が登録されていません。</p>
      )}
    </div>
  );
}
