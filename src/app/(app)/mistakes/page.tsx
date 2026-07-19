"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Screen } from "@/components/app/screen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, focusRingLink } from "@/lib/utils";
import { getWordById } from "@/lib/vocab";
import {
  clearAllMistakes,
  clearTodaysMistakes,
  getMistakeSummaries,
  removeMistakeWord,
  setRetryQueue,
  type MistakeSummary,
} from "@/lib/mistakes";
import { ChevronRight, NotebookPen, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

function formatWhen(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return `今日 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

export default function MistakesPage() {
  const router = useRouter();
  const [items, setItems] = useState<MistakeSummary[] | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const list = await getMistakeSummaries();
    setItems(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await getMistakeSummaries();
      if (!cancelled) setItems(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const todayIds = useMemo(
    () => (items ?? []).filter((x) => x.todayCount > 0).map((x) => x.wordId),
    [items]
  );

  const startRetry = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      setBusy(true);
      try {
        await setRetryQueue(ids);
        router.push(`/study/session?mode=retry&n=${ids.length}&_t=${Date.now()}`);
      } catch {
        toast.error("再テストを開始できませんでした");
        setBusy(false);
      }
    },
    [router]
  );

  return (
    <Screen
      title="間違いノート"
      subtitle="直近7日の誤答をまとめています"
      icon={<NotebookPen className="h-5 w-5" />}
      backHref="/study"
    >
      <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">クイック操作</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            type="button"
            className="h-12 w-full rounded-xl"
            disabled={busy || todayIds.length === 0}
            onClick={() => void startRetry(todayIds)}
          >
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
            今日の間違い {todayIds.length} 語を再テスト
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl text-sm"
              disabled={busy || todayIds.length === 0}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  try {
                    await clearTodaysMistakes();
                    await reload();
                    toast.success("今日の記録をクリアしました");
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
              今日をクリア
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl text-sm"
              disabled={busy || !items?.length}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  try {
                    await clearAllMistakes();
                    await reload();
                    toast.success("すべての記録をクリアしました");
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            >
              すべてクリア
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">
            誤答一覧
            {items ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                {items.length} 語
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {items == null ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">読み込み中…</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              まだ誤答の記録がありません。学習で間違えるとここに溜まります。
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((row) => {
                const word = getWordById(row.wordId);
                return (
                  <li key={row.wordId} className="flex items-stretch gap-1 px-2 py-1">
                    <Link
                      href={
                        word
                          ? `/words/${encodeURIComponent(word.id)}`
                          : "/words"
                      }
                      className={cn(
                        focusRingLink,
                        "flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-muted/40"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground">
                          {word?.term ?? row.wordId}
                        </p>
                        <p className="line-clamp-1 text-xs text-muted-foreground">
                          {word?.meaningJa ?? "（未収録の語）"}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          最終 {formatWhen(row.lastAt)} · 計 {row.count} 回
                          {row.todayCount > 0 ? ` · 今日 ${row.todayCount}` : ""}
                        </p>
                      </div>
                      {row.todayCount > 0 ? (
                        <Badge variant="destructive" className="shrink-0 text-[10px]">
                          今日
                        </Badge>
                      ) : null}
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    </Link>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="my-2 shrink-0 rounded-xl"
                      aria-label={`${word?.term ?? row.wordId} をノートから削除`}
                      disabled={busy}
                      onClick={() =>
                        void (async () => {
                          await removeMistakeWord(row.wordId);
                          await reload();
                        })()
                      }
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </Screen>
  );
}
