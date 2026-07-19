"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, focusRingLink } from "@/lib/utils";
import { Screen } from "@/components/app/screen";
import { HelpHint, HelpSection } from "@/components/app/help-hint";
import { BookOpen, Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getActivityBuckets, type ActivityBuckets } from "@/lib/activity";

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                */
/* ------------------------------------------------------------------ */

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;
const MONTH_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;
const HOUR_SPAN = 3;
const TIME_ROWS = Math.ceil(24 / HOUR_SPAN); // 8

/** 表示期間内の最大件数に対する比率で 0〜4 段階（0 は未記録） */
function levelRelative(v: number, maxInView: number): 0 | 1 | 2 | 3 | 4 {
  if (v <= 0 || maxInView <= 0) return 0;
  const r = v / maxInView;
  if (r <= 0.25) return 1;
  if (r <= 0.5) return 2;
  if (r <= 0.75) return 3;
  return 4;
}

const LEVEL_CLS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "bg-muted/40",
  1: "bg-primary/20",
  2: "bg-primary/35",
  3: "bg-primary/55",
  4: "bg-primary/75",
};

function bucketKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}`;
}

function sumHours(buckets: ActivityBuckets, day: Date, from: number, span: number): number {
  let s = 0;
  for (let h = 0; h < span; h++) {
    const dt = new Date(day);
    dt.setHours(from + h, 0, 0, 0);
    s += buckets[bucketKey(dt)] ?? 0;
  }
  return s;
}

function sumDay(buckets: ActivityBuckets, day: Date): number {
  return sumHours(buckets, day, 0, 24);
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function mondayOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ------------------------------------------------------------------ */
/*  Selected-cell detail formatter                                     */
/* ------------------------------------------------------------------ */

type CellInfo = { dt: Date; v: number; kind: "hour-block" | "day" };

function formatSelected(c: CellInfo): string {
  const dateStr = `${fmtDate(c.dt)}（${WEEKDAY_JA[c.dt.getDay()]}）`;
  if (c.kind === "day") return `${dateStr}：${c.v}問`;
  const h1 = c.dt.getHours();
  const h2 = Math.min(23, h1 + HOUR_SPAN - 1);
  return `${dateStr} ${String(h1).padStart(2, "0")}–${String(h2).padStart(2, "0")}時：${c.v}問`;
}

function cellInfoEqual(a: CellInfo | null, b: CellInfo | null): boolean {
  if (!a || !b) return false;
  return a.kind === b.kind && a.dt.getTime() === b.dt.getTime();
}

/* ------------------------------------------------------------------ */
/*  Grid builders                                                      */
/* ------------------------------------------------------------------ */

type WeekGrid = {
  colDates: Date[];
  rows: number;
  cells: { v: number; dt: Date }[];
  total: number;
};

function buildWeek(buckets: ActivityBuckets, now: Date): WeekGrid {
  const start = mondayOfWeek(now);
  const colDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const cells: { v: number; dt: Date }[] = [];
  let total = 0;
  for (const base of colDates) {
    for (let r = 0; r < TIME_ROWS; r++) {
      const fromHour = r * HOUR_SPAN;
      const v = sumHours(buckets, base, fromHour, HOUR_SPAN);
      const dt = new Date(base);
      dt.setHours(fromHour, 0, 0, 0);
      cells.push({ v, dt });
      total += v;
    }
  }
  return { colDates, rows: TIME_ROWS, cells, total };
}

type MonthGrid = {
  monthName: string;
  colDates: Date[];
  rows: number;
  cells: { v: number; dt: Date }[];
  total: number;
};

function buildMonth(buckets: ActivityBuckets, now: Date): MonthGrid {
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const colDates = Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1));
  const cells: { v: number; dt: Date }[] = [];
  let total = 0;
  for (const base of colDates) {
    for (let r = 0; r < TIME_ROWS; r++) {
      const fromHour = r * HOUR_SPAN;
      const v = sumHours(buckets, base, fromHour, HOUR_SPAN);
      const dt = new Date(base);
      dt.setHours(fromHour, 0, 0, 0);
      cells.push({ v, dt });
      total += v;
    }
  }
  return { monthName: MONTH_EN[month], colDates, rows: TIME_ROWS, cells, total };
}

type YearGrid = {
  weeks: Date[][]; // each week = array of 7 day Dates (Mon..Sun), null-padded via epoch
  monthLabels: { weekIdx: number; label: string }[];
  cells: { v: number; dt: Date; inRange: boolean }[];
  total: number;
};

function buildYear(buckets: ActivityBuckets, now: Date): YearGrid {
  const year = now.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);

  const firstMonday = mondayOfWeek(jan1);
  const weeks: Date[][] = [];
  const cursor = new Date(firstMonday);
  while (cursor <= dec31) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  const monthLabels: { weekIdx: number; label: string }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks.length; w++) {
    const mon = weeks[w][0];
    if (mon.getMonth() !== lastMonth && mon.getFullYear() === year) {
      monthLabels.push({ weekIdx: w, label: MONTH_EN[mon.getMonth()] });
      lastMonth = mon.getMonth();
    }
    for (const d of weeks[w]) {
      if (d.getDate() === 1 && d.getFullYear() === year && d.getMonth() !== lastMonth) {
        const wIdx = w;
        if (!monthLabels.some((ml) => ml.weekIdx === wIdx)) {
          monthLabels.push({ weekIdx: wIdx, label: MONTH_EN[d.getMonth()] });
        }
        lastMonth = d.getMonth();
      }
    }
  }

  const cells: YearGrid["cells"] = [];
  let total = 0;
  for (const week of weeks) {
    for (const day of week) {
      const inRange = day >= jan1 && day <= dec31;
      const v = inRange ? sumDay(buckets, day) : 0;
      cells.push({ v, dt: day, inRange });
      if (inRange) total += v;
    }
  }

  return { weeks, monthLabels, cells, total };
}

/* ------------------------------------------------------------------ */
/*  Legend                                                              */
/* ------------------------------------------------------------------ */

function Legend() {
  return (
    <div className="mt-2 flex flex-col items-end gap-0.5 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <span>Less</span>
        {([0, 1, 2, 3, 4] as const).map((lv) => (
          <div
            key={lv}
            className={cn("h-3 w-3 rounded-[3px] ring-1 ring-border/20", LEVEL_CLS[lv])}
            aria-hidden
          />
        ))}
        <span>More</span>
      </div>
      <span className="text-[10px] opacity-90">（期間内の最大に対する割合）</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Time labels (left axis for week / month views)                     */
/* ------------------------------------------------------------------ */

function TimeLabels({ cellPx, gapPx }: { cellPx: number; gapPx: number }) {
  return (
    <div
      className="mr-1 grid shrink-0 text-right text-[10px] text-muted-foreground"
      style={{
        gridTemplateRows: `repeat(${TIME_ROWS}, ${cellPx}px)`,
        rowGap: `${gapPx}px`,
      }}
      aria-hidden
    >
      {Array.from({ length: TIME_ROWS }, (_, r) => {
        const h = r * HOUR_SPAN;
        return (
          <div key={h} className="flex items-center justify-end pr-1 leading-none">
            {h}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function StudyPage() {
  const [buckets, setBuckets] = useState<ActivityBuckets>({});
  const [selected, setSelected] = useState<CellInfo | null>(null);
  const [activeTab, setActiveTab] = useState<"week" | "month" | "year">("week");
  const learningRecordCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const b = await getActivityBuckets();
      if (!cancelled) setBuckets(b);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleTabChange = useCallback((v: string) => {
    setActiveTab(v as "week" | "month" | "year");
    setSelected(null);
  }, []);

  /** セル以外をタップしたら解除（カード外も解除） */
  useEffect(() => {
    const onPointerDownCapture = (e: PointerEvent) => {
      const root = learningRecordCardRef.current;
      const t = e.target as Node | null;
      if (!root || !t) return;
      if (!root.contains(t)) {
        setSelected(null);
        return;
      }
      if ((t as HTMLElement).closest?.("[data-activity-cell]")) return;
      setSelected(null);
    };
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    return () => document.removeEventListener("pointerdown", onPointerDownCapture, true);
  }, []);

  const now = useMemo(() => new Date(), []);
  const week = useMemo(() => buildWeek(buckets, now), [buckets, now]);
  const month = useMemo(() => buildMonth(buckets, now), [buckets, now]);
  const year = useMemo(() => buildYear(buckets, now), [buckets, now]);

  const weekMax = useMemo(
    () => Math.max(0, ...week.cells.map((c) => c.v)),
    [week.cells]
  );
  const monthMax = useMemo(
    () => Math.max(0, ...month.cells.map((c) => c.v)),
    [month.cells]
  );
  const yearMax = useMemo(
    () =>
      Math.max(
        0,
        ...year.cells.filter((c) => c.inRange).map((c) => c.v)
      ),
    [year.cells]
  );

  const selectHourBlock = useCallback((dt: Date, v: number) => {
    const next: CellInfo = { dt, v, kind: "hour-block" };
    setSelected((prev) => (cellInfoEqual(prev, next) ? null : next));
  }, []);

  const selectDay = useCallback((dt: Date, v: number) => {
    const next: CellInfo = { dt, v, kind: "day" };
    setSelected((prev) => (cellInfoEqual(prev, next) ? null : next));
  }, []);

  /* ---------- Week view config ---------- */
  const wCell = 28;
  const wGapX = 8;
  const wGapY = 4;

  /* ---------- Month view config ---------- */
  const mCell = 18;
  const mGapX = 3;
  const mGapY = 3;

  /* ---------- Year view config ---------- */
  const yCell = 13;
  const yGap = 2;

  return (
    <Screen title="学習" icon={<BookOpen className="h-5 w-5" />}>
      <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            クイックスタート
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Link
            href="/study/session?mode=new&n=10"
            className={cn(
              buttonVariants({ size: "lg" }),
              focusRingLink,
              "h-14 rounded-2xl shadow-sm transition-colors"
            )}
          >
            新規 10単語
          </Link>
          <Link
            href="/study/session?mode=mix&n=10&offset=0"
            className={cn(
              buttonVariants({ size: "lg", variant: "secondary" }),
              focusRingLink,
              "h-14 rounded-2xl shadow-sm transition-colors"
            )}
          >
            ミックス 10単語
          </Link>
          <Link
            href="/study/session?mode=mix&n=10&offset=0&dir=ja-en"
            className={cn(
              buttonVariants({ size: "lg", variant: "outline" }),
              focusRingLink,
              "col-span-2 h-14 rounded-2xl shadow-sm transition-colors sm:col-span-1"
            )}
          >
            和→英 10単語
          </Link>
        </CardContent>
      </Card>

      {/* ==================== 学習記録 ==================== */}
      <Card
        ref={learningRecordCardRef}
        className="rounded-2xl border border-border/80 bg-card shadow-sm"
      >
        <CardHeader className="pb-2">
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-base font-semibold">学習記録</CardTitle>
            <HelpHint label="学習記録の見方">
              <HelpSection title="色の濃さの意味">
                <ul>
                  <li>週間・月間・年間の各タブで、その表示範囲のなかでの相対的な学習件数を示します。</li>
                  <li>タブをまたいで濃さを比較することはできません。同じ期間内のばらつきの目安に使ってください。</li>
                </ul>
              </HelpSection>
              <HelpSection title="セルの操作">
                <ul>
                  <li>セルをタップすると、その枠の学習件数を表示します。</li>
                  <li>もう一度タップするか、カレンダー外をタップすると選択を解除します。</li>
                </ul>
              </HelpSection>
              <HelpSection title="集計の単位">
                <p>
                  週間は<strong>曜日×時間帯</strong>のマス、月間・年間は<strong>日付</strong>ごとのマスに集計しています。
                </p>
              </HelpSection>
            </HelpHint>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList>
              <TabsTrigger value="week">週間</TabsTrigger>
              <TabsTrigger value="month">月間</TabsTrigger>
              <TabsTrigger value="year">年間</TabsTrigger>
            </TabsList>

            {/* ---- Week ---- */}
            <TabsContent value="week" className="pt-3">
              <div className="overflow-x-auto rounded-xl border border-border/60 bg-background/50 p-3">
                {/* Weekday labels */}
                <div className="flex">
                  <div style={{ width: 28 }} className="shrink-0" />
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: `repeat(7, ${wCell}px)`,
                      columnGap: `${wGapX}px`,
                    }}
                    aria-hidden
                  >
                    {week.colDates.map((d) => (
                      <div
                        key={d.toISOString()}
                        className="pb-1.5 text-center text-sm font-medium text-muted-foreground"
                      >
                        {WEEKDAY_JA[d.getDay()]}
                      </div>
                    ))}
                  </div>
                </div>
                {/* Grid + time labels */}
                <div className="flex">
                  <TimeLabels cellPx={wCell} gapPx={wGapY} />
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: `repeat(7, ${wCell}px)`,
                      gridTemplateRows: `repeat(${TIME_ROWS}, ${wCell}px)`,
                      columnGap: `${wGapX}px`,
                      rowGap: `${wGapY}px`,
                    }}
                    aria-label="週間の学習記録ヒートマップ"
                  >
                    {week.cells.map(({ v, dt }, i) => {
                      const col = Math.floor(i / TIME_ROWS);
                      const row = i % TIME_ROWS;
                      const isSelected = selected?.dt.getTime() === dt.getTime() && selected?.kind === "hour-block";
                      return (
                        <button
                          key={i}
                          type="button"
                          data-activity-cell
                          aria-pressed={isSelected}
                          className={cn(
                            "rounded-[4px] ring-1 transition-shadow",
                            LEVEL_CLS[levelRelative(v, weekMax)],
                            isSelected
                              ? "ring-2 ring-foreground/60 shadow-md"
                              : "ring-border/20"
                          )}
                          style={{ gridColumn: col + 1, gridRow: row + 1 }}
                          title={`${fmtDate(dt)} ${dt.getHours()}–${dt.getHours() + HOUR_SPAN - 1}時: ${v}問`}
                          onClick={() => selectHourBlock(dt, v)}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs font-medium tabular-nums text-muted-foreground">
                  今週：{week.total}問
                </span>
                <Legend />
              </div>
              {selected ? (
                <SelectedBadge text={formatSelected(selected)} />
              ) : null}
            </TabsContent>

            {/* ---- Month ---- */}
            <TabsContent value="month" className="pt-3">
              <div className="overflow-x-auto rounded-xl border border-border/60 bg-background/50 p-3">
                <div className="mb-2 text-sm font-semibold text-foreground">
                  {month.monthName}
                </div>
                {/* Grid + time labels */}
                <div className="flex">
                  <TimeLabels cellPx={mCell} gapPx={mGapY} />
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: `repeat(${month.colDates.length}, ${mCell}px)`,
                      gridTemplateRows: `repeat(${TIME_ROWS}, ${mCell}px)`,
                      columnGap: `${mGapX}px`,
                      rowGap: `${mGapY}px`,
                    }}
                    aria-label="月間の学習記録ヒートマップ"
                  >
                    {month.cells.map(({ v, dt }, i) => {
                      const col = Math.floor(i / TIME_ROWS);
                      const row = i % TIME_ROWS;
                      const isSelected = selected?.dt.getTime() === dt.getTime() && selected?.kind === "hour-block";
                      return (
                        <button
                          key={i}
                          type="button"
                          data-activity-cell
                          aria-pressed={isSelected}
                          className={cn(
                            "rounded-[3px] ring-1 transition-shadow",
                            LEVEL_CLS[levelRelative(v, monthMax)],
                            isSelected
                              ? "ring-2 ring-foreground/60 shadow-md"
                              : "ring-border/20"
                          )}
                          style={{ gridColumn: col + 1, gridRow: row + 1 }}
                          title={`${fmtDate(dt)} ${dt.getHours()}–${dt.getHours() + HOUR_SPAN - 1}時: ${v}問`}
                          onClick={() => selectHourBlock(dt, v)}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs font-medium tabular-nums text-muted-foreground">
                  今月：{month.total}問
                </span>
                <Legend />
              </div>
              {selected ? (
                <SelectedBadge text={formatSelected(selected)} />
              ) : null}
            </TabsContent>

            {/* ---- Year (GitHub-style) ---- */}
            <TabsContent value="year" className="pt-3">
              <div className="overflow-x-auto rounded-xl border border-border/60 bg-background/50 p-3">
                {/* Month labels row */}
                <div className="flex">
                  <div style={{ width: 22 }} className="shrink-0" />
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: `repeat(${year.weeks.length}, ${yCell}px)`,
                      columnGap: `${yGap}px`,
                    }}
                    aria-hidden
                  >
                    {year.weeks.map((_, wIdx) => {
                      const ml = year.monthLabels.find((m) => m.weekIdx === wIdx);
                      return (
                        <div key={wIdx} className="h-4 text-left text-[10px] leading-4 text-muted-foreground">
                          {ml?.label ?? ""}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* Weekday labels + grid */}
                <div className="flex">
                  {/* Day-of-week labels */}
                  <div
                    className="mr-1 grid shrink-0 text-right text-[10px] text-muted-foreground"
                    style={{
                      gridTemplateRows: `repeat(7, ${yCell}px)`,
                      rowGap: `${yGap}px`,
                    }}
                    aria-hidden
                  >
                    {[1, 2, 3, 4, 5, 6, 0].map((dow, i) => (
                      <div key={dow} className="flex items-center justify-end pr-0.5 leading-none">
                        {i % 2 === 0 ? WEEKDAY_JA[dow] : ""}
                      </div>
                    ))}
                  </div>
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: `repeat(${year.weeks.length}, ${yCell}px)`,
                      gridTemplateRows: `repeat(7, ${yCell}px)`,
                      gap: `${yGap}px`,
                    }}
                    aria-label="年間の学習記録ヒートマップ"
                  >
                    {year.cells.map(({ v, dt, inRange }, i) => {
                      const wIdx = Math.floor(i / 7);
                      const dIdx = i % 7;
                      const isSelected = selected?.dt.getTime() === dt.getTime() && selected?.kind === "day";
                      if (!inRange) {
                        return (
                          <div
                            key={i}
                            style={{ gridColumn: wIdx + 1, gridRow: dIdx + 1 }}
                          />
                        );
                      }
                      return (
                        <button
                          key={i}
                          type="button"
                          data-activity-cell
                          aria-pressed={isSelected}
                          className={cn(
                            "rounded-[2px] ring-1 transition-shadow",
                            LEVEL_CLS[levelRelative(v, yearMax)],
                            isSelected
                              ? "ring-2 ring-foreground/60 shadow-md"
                              : "ring-border/20"
                          )}
                          style={{ gridColumn: wIdx + 1, gridRow: dIdx + 1 }}
                          title={`${fmtDate(dt)}: ${v}問`}
                          onClick={() => selectDay(dt, v)}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs font-medium tabular-nums text-muted-foreground">
                  今年：{year.total}問
                </span>
                <Legend />
              </div>
              {selected ? (
                <SelectedBadge text={formatSelected(selected)} />
              ) : null}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/*  Selected cell badge                                                */
/* ------------------------------------------------------------------ */

function SelectedBadge({ text }: { text: string }) {
  return (
    <div className="mt-2 rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-xs">
      <span className="font-medium text-foreground">選択中</span>{" "}
      <span className="text-muted-foreground">{text}</span>
    </div>
  );
}
