"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Screen } from "@/components/app/screen";
import { Badge } from "@/components/ui/badge";
import { getAllWords, type ToeicWord } from "@/lib/vocab";
import { getDueWordIds, getProgress } from "@/lib/progress";
import { getPreferences } from "@/lib/preferences";
import {
  WORD_CATEGORY_IDS,
  WORD_CATEGORY_LABELS,
  type WordCategoryId,
  SCENE_TAG_IDS,
  SCENE_TAG_LABELS,
  type SceneTagId,
  getWordCategoryId,
  getSceneTagLabels,
  filterWordsByTrack,
  filterWordsByScene,
  isSceneTagId,
} from "@/lib/word-meta";
import { BookOpen, ChevronRight } from "lucide-react";
import { cn, focusRingLink } from "@/lib/utils";

type ListFilter = "all" | "due" | "learned";

export function WordsListClient() {
  const sp = useSearchParams();
  const filter = (sp.get("filter") as ListFilter | null) ?? "all";
  const categoryParam = sp.get("category") as WordCategoryId | null;
  const safeCategory: WordCategoryId | "all" =
    categoryParam && WORD_CATEGORY_IDS.includes(categoryParam as WordCategoryId)
      ? categoryParam
      : "all";
  const sceneParam = sp.get("scene");
  const safeScene: SceneTagId | "all" =
    sceneParam && isSceneTagId(sceneParam) ? sceneParam : "all";

  const [dueSet, setDueSet] = useState<Set<string> | null>(null);
  const [learnedSet, setLearnedSet] = useState<Set<string> | null>(null);
  const [includeDaily, setIncludeDaily] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [dueIds, progress, prefs] = await Promise.all([
        getDueWordIds(),
        getProgress(),
        getPreferences(),
      ]);
      if (cancelled) return;
      setDueSet(new Set(dueIds));
      setLearnedSet(new Set(Object.keys(progress)));
      setIncludeDaily(prefs.includeDailyVocab);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const allWords = useMemo(() => getAllWords(), []);

  const filtered = useMemo(() => {
    let list: ToeicWord[] = filterWordsByTrack(allWords, includeDaily);
    list = filterWordsByScene(list, safeScene);
    if (filter === "due" && dueSet) {
      list = list.filter((w) => dueSet.has(w.id));
    } else if (filter === "learned" && learnedSet) {
      list = list.filter((w) => learnedSet.has(w.id));
    }
    if (safeCategory !== "all") {
      list = list.filter((w) => getWordCategoryId(w) === safeCategory);
    }
    return list.sort((a, b) => a.term.localeCompare(b.term));
  }, [allWords, filter, dueSet, learnedSet, safeCategory, safeScene, includeDaily]);

  const title =
    filter === "due"
      ? "復習待ち"
      : filter === "learned"
        ? "学習済み"
        : "収録単語";

  const buildHref = (next: {
    filter?: ListFilter;
    category?: WordCategoryId | "all";
    scene?: SceneTagId | "all";
  }) => {
    const p = new URLSearchParams();
    const f = next.filter !== undefined ? next.filter : filter;
    if (f !== "all") p.set("filter", f);
    const c = next.category !== undefined ? next.category : safeCategory;
    if (c !== "all") p.set("category", c);
    const s = next.scene !== undefined ? next.scene : safeScene;
    if (s !== "all") p.set("scene", s);
    const q = p.toString();
    return q ? `/words?${q}` : "/words";
  };

  const subtitleParts = [
    title,
    safeScene !== "all" ? SCENE_TAG_LABELS[safeScene] : null,
    safeCategory !== "all" ? WORD_CATEGORY_LABELS[safeCategory] : null,
    includeDaily ? null : "ビジネス優先",
  ].filter(Boolean);

  return (
    <Screen
      title="単語一覧"
      subtitle={subtitleParts.join(" · ")}
      icon={<BookOpen className="h-5 w-5" />}
      backHref="/"
    >
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: "all" as const, label: "すべて" },
            { id: "due" as const, label: "復習待ち" },
            { id: "learned" as const, label: "学習済み" },
          ] as const
        ).map(({ id, label }) => (
          <Link
            key={id}
            href={buildHref({ filter: id === "all" ? "all" : id })}
            className={cn(
              focusRingLink,
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              (id === "all" ? filter === "all" : filter === id)
                ? "border-primary bg-primary/15 text-primary"
                : "border-border/80 bg-card text-muted-foreground hover:bg-muted/60"
            )}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">使用ケース</p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={buildHref({ scene: "all" })}
            className={cn(
              focusRingLink,
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              safeScene === "all"
                ? "border-primary bg-primary/15 text-primary"
                : "border-border/80 bg-card text-muted-foreground hover:bg-muted/60"
            )}
          >
            すべて
          </Link>
          {SCENE_TAG_IDS.filter((id) => includeDaily || id !== "daily").map((sid) => (
            <Link
              key={sid}
              href={buildHref({ scene: sid })}
              className={cn(
                focusRingLink,
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                safeScene === sid
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border/80 bg-card text-muted-foreground hover:bg-muted/60"
              )}
            >
              {SCENE_TAG_LABELS[sid]}
            </Link>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">カテゴリ（品詞）</p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={buildHref({ category: "all" })}
            className={cn(
              focusRingLink,
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              safeCategory === "all"
                ? "border-primary bg-primary/15 text-primary"
                : "border-border/80 bg-card text-muted-foreground hover:bg-muted/60"
            )}
          >
            全品詞
          </Link>
          {WORD_CATEGORY_IDS.map((cid) => (
            <Link
              key={cid}
              href={buildHref({ category: cid })}
              className={cn(
                focusRingLink,
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                safeCategory === cid
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border/80 bg-card text-muted-foreground hover:bg-muted/60"
              )}
            >
              {WORD_CATEGORY_LABELS[cid]}
            </Link>
          ))}
        </div>
      </div>

      <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
        <CardContent className="p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">読み込み中…</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              該当する単語がありません。
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {filtered.map((w) => (
                <li key={w.id}>
                  <Link
                    href={`/words/${encodeURIComponent(w.id)}`}
                    className={cn(
                      focusRingLink,
                      "flex items-center gap-3 py-3.5 pr-1 transition-colors hover:bg-muted/40"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground">{w.term}</p>
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        {w.meaningJa}
                      </p>
                      {getSceneTagLabels(w)[0] ? (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {getSceneTagLabels(w).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                      {WORD_CATEGORY_LABELS[getWordCategoryId(w)]}
                    </Badge>
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground tabular-nums">
        {loading ? "—" : `${filtered.length} 単語`}
      </p>
    </Screen>
  );
}
