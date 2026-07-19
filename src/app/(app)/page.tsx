"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn, focusRingHeroGhost, focusRingHeroPrimary, focusRingLink } from "@/lib/utils";
import { getHomeStats } from "@/lib/progress";
import {
  SESSION_CHECKPOINT_MAX_AGE_MS,
  getSessionCheckpoint,
  type SessionCheckpoint,
} from "@/lib/session-checkpoint";
import { countTodaysMistakes } from "@/lib/mistakes";
import { AppWordmark } from "@/components/app/wordmark";
import { ArrowRight, Clock, Play, RotateCcw, Sparkles } from "lucide-react";

function StatFigure({
  loading,
  value,
}: {
  loading: boolean;
  value: number | null;
}) {
  if (loading) {
    return (
      <div
        className="mx-auto mt-1 h-7 w-10 max-w-full animate-pulse rounded-md bg-muted"
        aria-hidden
      />
    );
  }
  return (
    <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
      {value ?? "—"}
    </p>
  );
}

export default function Home() {
  const [due, setDue] = useState<number | null>(null);
  const [touched, setTouched] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [todayMistakes, setTodayMistakes] = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);
  const [resume, setResume] = useState<SessionCheckpoint | null>(null);

  useEffect(() => {
    function refreshResume() {
      void getSessionCheckpoint().then((cp) => {
        if (!cp || Date.now() - cp.updatedAt > SESSION_CHECKPOINT_MAX_AGE_MS) {
          setResume(null);
          return;
        }
        setResume(cp);
      });
    }
    refreshResume();
    window.addEventListener("focus", refreshResume);
    return () => window.removeEventListener("focus", refreshResume);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [s, mistakes] = await Promise.all([getHomeStats(), countTodaysMistakes()]);
      if (!cancelled) {
        setDue(s.dueCount);
        setTouched(s.touchedCount);
        setTotal(s.listWordCount);
        setTodayMistakes(mistakes);
        setStatsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reviewN = due != null ? Math.min(Math.max(due, 1), 30) : 20;
  const primaryIsReview = !statsLoading && due != null && due > 0;

  return (
    <div className="space-y-6">
      <div className="flex w-full justify-center px-1 pt-1 pb-0.5 sm:pt-2">
        <AppWordmark size="hero" />
      </div>

      <section
        className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm dark:border-border/80"
        aria-labelledby="home-primary-cta"
      >
        <div className="flex flex-col gap-5 px-5 pb-6 pt-6 sm:px-7 sm:pb-8 sm:pt-7">
          {resume && resume.wordIds.length > 0 ? (
            <Link
              href={`${resume.pathname}${resume.search}`}
              className={cn(
                focusRingLink,
                "flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-background/70 px-4 py-3.5 text-sm font-medium text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-background/85 dark:border-primary/25 dark:bg-background/45 dark:hover:bg-background/55"
              )}
            >
              <span className="flex items-center gap-2">
                <Play className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                続きから再開
                <span className="font-normal text-muted-foreground">
                  {resume.idx + 1} / {resume.wordIds.length}
                </span>
              </span>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </Link>
          ) : null}

          <div className="space-y-3">
            <p
              id="home-primary-cta"
              className="text-lg font-semibold leading-snug tracking-tight text-foreground sm:text-xl"
            >
              {primaryIsReview
                ? `復習が ${due} 単語あります`
                : "10単語ずつ、始めましょう"}
            </p>

            <div
              className={cn(
                "rounded-2xl border border-border/70 bg-background/60 p-4 shadow-sm backdrop-blur-md",
                "dark:border-white/[0.08] dark:bg-background/35"
              )}
            >
              <div className="flex flex-col gap-3">
                {primaryIsReview ? (
                  <Link
                    href={`/study/session?mode=review&n=${reviewN}`}
                    className={cn(
                      focusRingHeroPrimary,
                      "inline-flex min-h-14 w-full shrink-0 items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold transition-[filter,background-color]",
                      "bg-primary text-primary-foreground shadow-md ring-1 ring-black/15 hover:brightness-105 active:brightness-95 dark:ring-black/25"
                    )}
                  >
                    <Clock className="h-5 w-5 opacity-90" aria-hidden />
                    復習する
                    <ArrowRight className="h-5 w-5 opacity-80" aria-hidden />
                  </Link>
                ) : null}
                <Link
                  href="/study/session?mode=new&n=10"
                  className={cn(
                    primaryIsReview ? focusRingHeroGhost : focusRingHeroPrimary,
                    "inline-flex min-h-14 w-full shrink-0 items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold transition-colors",
                    primaryIsReview
                      ? "border border-border/90 bg-background/80 text-foreground shadow-sm hover:bg-background dark:border-white/15 dark:bg-background/50 dark:hover:bg-background/65"
                      : "bg-primary text-primary-foreground shadow-md ring-1 ring-black/15 hover:brightness-105 active:brightness-95 dark:ring-black/25"
                  )}
                >
                  {!primaryIsReview ? (
                    <Sparkles className="h-5 w-5 opacity-90" aria-hidden />
                  ) : null}
                  {primaryIsReview ? "新規10単語へ" : "新規10単語を始める"}
                </Link>
                {!statsLoading && todayMistakes > 0 ? (
                  <Link
                    href={`/study/session?mode=mistakes&n=${Math.min(todayMistakes, 30)}`}
                    className={cn(
                      focusRingHeroGhost,
                      "inline-flex min-h-12 w-full shrink-0 items-center justify-center gap-2 rounded-2xl border border-destructive/35 bg-destructive/5 px-5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10"
                    )}
                  >
                    <RotateCcw className="h-4 w-4 opacity-90" aria-hidden />
                    今日の間違い {todayMistakes} 語を復習
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      {!statsLoading && touched != null && total != null && total > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>全体の進捗</span>
            <span className="font-medium tabular-nums text-foreground">
              {Math.round((touched / total) * 100)}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${Math.min(100, (touched / total) * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {touched} / {total} 単語を学習済み
          </p>
        </div>
      ) : null}

      <div
        className="grid grid-cols-3 gap-2"
        aria-busy={statsLoading}
        aria-label="学習状況"
      >
        <Link
          href="/words?filter=due"
          className={cn(
            focusRingLink,
            "rounded-2xl border border-border/80 bg-card px-3 py-3 text-center shadow-sm transition-colors hover:bg-muted/40"
          )}
        >
          <p className="text-xs font-medium text-muted-foreground">
            復習待ち
          </p>
          <StatFigure loading={statsLoading} value={due} />
        </Link>
        <Link
          href="/words?filter=learned"
          className={cn(
            focusRingLink,
            "rounded-2xl border border-border/80 bg-card px-3 py-3 text-center shadow-sm transition-colors hover:bg-muted/40"
          )}
        >
          <p className="text-xs font-medium text-muted-foreground">
            学習済み
          </p>
          <StatFigure loading={statsLoading} value={touched} />
        </Link>
        <Link
          href="/words?filter=all"
          className={cn(
            focusRingLink,
            "rounded-2xl border border-border/80 bg-card px-3 py-3 text-center shadow-sm transition-colors hover:bg-muted/40"
          )}
        >
          <p className="text-xs font-medium text-muted-foreground">
            収録単語数
          </p>
          <StatFigure loading={statsLoading} value={total} />
        </Link>
      </div>
    </div>
  );
}
