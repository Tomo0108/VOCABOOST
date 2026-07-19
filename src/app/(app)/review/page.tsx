"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import { cn, focusRingLink } from "@/lib/utils";
import { Screen } from "@/components/app/screen";
import { getHomeStats, getProgress } from "@/lib/progress";
import { Clock, NotebookPen, RotateCcw, Sparkles } from "lucide-react";

type ScheduleGroup = {
  label: string;
  count: number;
};

function buildScheduleGroups(
  progress: Record<string, { dueAt: number }>,
  now: number
): ScheduleGroup[] {
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const todayMs = todayEnd.getTime();

  const tomorrowEnd = new Date(todayMs + 24 * 60 * 60 * 1000);
  const twoDaysEnd = new Date(todayMs + 2 * 24 * 60 * 60 * 1000);
  const weekEnd = new Date(todayMs + 7 * 24 * 60 * 60 * 1000);

  const groups = { overdue: 0, today: 0, tomorrow: 0, twoDays: 0, week: 0, later: 0 };

  for (const s of Object.values(progress)) {
    const due = s.dueAt ?? 0;
    if (due <= now) groups.overdue++;
    else if (due <= todayMs) groups.today++;
    else if (due <= tomorrowEnd.getTime()) groups.tomorrow++;
    else if (due <= twoDaysEnd.getTime()) groups.twoDays++;
    else if (due <= weekEnd.getTime()) groups.week++;
    else groups.later++;
  }

  const result: ScheduleGroup[] = [];
  if (groups.overdue > 0) result.push({ label: "期限切れ", count: groups.overdue });
  if (groups.today > 0) result.push({ label: "今日中", count: groups.today });
  if (groups.tomorrow > 0) result.push({ label: "明日", count: groups.tomorrow });
  if (groups.twoDays > 0) result.push({ label: "明後日", count: groups.twoDays });
  if (groups.week > 0) result.push({ label: "今週中", count: groups.week });
  if (groups.later > 0) result.push({ label: "それ以降", count: groups.later });
  return result;
}

export default function ReviewPage() {
  const [due, setDue] = useState<number | null>(null);
  const [dueLoading, setDueLoading] = useState(true);
  const [schedule, setSchedule] = useState<ScheduleGroup[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [s, progress] = await Promise.all([getHomeStats(), getProgress()]);
      if (!cancelled) {
        setDue(s.dueCount);
        setSchedule(buildScheduleGroups(progress, Date.now()));
        setDueLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reviewN = due != null ? Math.min(Math.max(due, 1), 30) : 20;
  const hasDue = !dueLoading && due != null && due > 0;

  return (
    <Screen title="復習" icon={<Clock className="h-5 w-5" />}>
      <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">復習予定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">いま復習できる単語</span>
            <span
              className="font-semibold tabular-nums text-foreground"
              aria-busy={dueLoading}
            >
              {dueLoading ? (
                <span className="inline-block h-4 w-12 animate-pulse rounded bg-muted" />
              ) : due == null ? (
                "—"
              ) : (
                `${due} 単語`
              )}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {hasDue
              ? "期限が来た単語を優先して出題します。まとめて最大30単語まで復習できます。"
              : "復習待ちの単語はありません。学習タブから学習を進めましょう。"}
          </p>
          {hasDue ? (
            <Link
              href={`/study/session?mode=review&n=${reviewN}`}
              className={cn(
                buttonVariants({ size: "lg" }),
                focusRingLink,
                "h-14 w-full rounded-2xl shadow-sm transition-colors"
              )}
            >
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
              復習を始める（{Math.min(reviewN, due ?? reviewN)} 単語）
            </Link>
          ) : (
            <Link
              href="/study/session?mode=mix&n=10&offset=0"
              className={cn(
                buttonVariants({ size: "lg" }),
                focusRingLink,
                "h-14 w-full rounded-2xl shadow-sm transition-colors"
              )}
            >
              <Sparkles className="mr-2 h-4 w-4" aria-hidden />
              10単語を進める
            </Link>
          )}
          <Link
            href="/mistakes"
            className={cn(
              buttonVariants({ size: "lg", variant: "outline" }),
              focusRingLink,
              "h-12 w-full rounded-2xl shadow-sm transition-colors"
            )}
          >
            <NotebookPen className="mr-2 h-4 w-4" aria-hidden />
            間違いノート
          </Link>
        </CardContent>
      </Card>

      {!dueLoading && schedule.length > 0 ? (
        <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">スケジュール</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border/60">
              {schedule.map((g) => (
                <div
                  key={g.label}
                  className="flex items-center justify-between py-2.5 text-sm"
                >
                  <span className="text-muted-foreground">{g.label}</span>
                  <span className="font-medium tabular-nums text-foreground">
                    {g.count} 単語
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </Screen>
  );
}
