"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useHydrated } from "@/lib/use-hydrated";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Screen } from "@/components/app/screen";
import { HelpHint, HelpSection } from "@/components/app/help-hint";
import { cn, focusRingLink } from "@/lib/utils";
import {
  getPreferences,
  setPreferences,
  SPEECH_RATE_PRESETS,
  isSpeechRatePreset,
  type AppPreferences,
} from "@/lib/preferences";
import { difficultyLabel, type WordDifficulty } from "@/lib/word-meta";
import { speakEnglish } from "@/lib/speak";
import { COLOR_PRESETS } from "@/lib/color-presets";
import { exportBackup, importBackup } from "@/lib/backup";
import { toast } from "sonner";
import {
  ChevronDown,
  Download,
  Monitor,
  Moon,
  Settings2,
  Sun,
  Upload,
} from "lucide-react";

export default function SettingsPage() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useHydrated();
  const [prefs, setPrefs] = useState<AppPreferences | null>(null);
  const [colorPresetPanelOpen, setColorPresetPanelOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const p = await getPreferences();
      if (!cancelled) setPrefs(p);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function updatePrefs(patch: Partial<AppPreferences>) {
    const next = await setPreferences(patch);
    setPrefs(next);
  }

  const toggleDifficultyLevel = useCallback(
    (level: WordDifficulty, checked: boolean) => {
      const cur = prefs?.difficultyLevels ?? ([1, 2, 3] as WordDifficulty[]);
      if (!checked && cur.length <= 1) {
        toast.message("少なくとも1段階は選んでください");
        return;
      }
      const next: WordDifficulty[] = checked
        ? ([...new Set([...cur, level])] as WordDifficulty[]).sort((a, b) => a - b)
        : cur.filter((l) => l !== level);
      void updatePrefs({ difficultyLevels: next });
    },
    [prefs?.difficultyLevels]
  );

  const handleExport = useCallback(async () => {
    try {
      const json = await exportBackup();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vocaboost-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("バックアップをダウンロードしました");
    } catch {
      toast.error("エクスポートに失敗しました");
    }
  }, []);

  const selectedColorPreset =
    prefs != null
      ? (COLOR_PRESETS.find((p) => p.id === prefs.colorPreset) ?? COLOR_PRESETS[0])
      : null;

  const handleImport = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const result = await importBackup(text);
      toast.success(`${result.wordCount} 単語の進捗を復元しました`);
      const p = await getPreferences();
      setPrefs(p);
    } catch {
      toast.error("ファイルを読み込めませんでした。形式を確認してください。");
    }
  }, []);

  return (
    <Screen title="設定" icon={<Settings2 className="h-5 w-5" />}>
      <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">外観</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!mounted ? (
            <p className="sr-only">テーマを読み込み中です。</p>
          ) : null}
          <div
            className={cn("grid grid-cols-3 gap-2", !mounted && "animate-pulse")}
            role="group"
            aria-busy={!mounted}
            aria-label="カラーテーマ"
          >
            {(
              [
                { id: "light" as const, label: "ライト", icon: Sun },
                { id: "dark" as const, label: "ダーク", icon: Moon },
                { id: "system" as const, label: "自動", icon: Monitor },
              ] as const
            ).map(({ id, label, icon: Icon }) => {
              const active = mounted && theme === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTheme(id)}
                  aria-pressed={active}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-center text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    active
                      ? "border-primary/50 bg-primary/15 text-foreground"
                      : "border-border/80 bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 opacity-90" aria-hidden />
                  {label}
                </button>
              );
            })}
          </div>
          {mounted ? (
            <p className="text-[11px] text-muted-foreground">
              現在: {resolvedTheme === "dark" ? "ダーク" : "ライト"}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">カラーバリエーション</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {selectedColorPreset ? (
            <div className="flex gap-3 rounded-2xl border border-border/80 bg-muted/25 px-3 py-3">
              <span className="flex shrink-0 gap-1 self-start pt-0.5" aria-hidden>
                <span
                  className="size-7 rounded-lg border border-border/60 shadow-sm"
                  style={{ backgroundColor: selectedColorPreset.swatches.primary }}
                />
                <span
                  className="size-7 rounded-lg border border-border/60 shadow-sm"
                  style={{ backgroundColor: selectedColorPreset.swatches.accent }}
                />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">選択中</p>
                <p className="text-sm font-semibold text-foreground">{selectedColorPreset.label}</p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {selectedColorPreset.description}
                </p>
              </div>
            </div>
          ) : (
            <div className="h-24 animate-pulse rounded-2xl bg-muted/40" aria-hidden />
          )}

          <button
            type="button"
            disabled={prefs == null}
            aria-expanded={colorPresetPanelOpen}
            aria-controls="settings-color-preset-panel"
            onClick={() => setColorPresetPanelOpen((o) => !o)}
            className={cn(
              focusRingLink,
              "flex w-full items-center justify-center gap-2 rounded-2xl border border-border/80 bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors",
              "hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-50"
            )}
          >
            {colorPresetPanelOpen ? "一覧を閉じる" : "プリセット一覧を開く"}
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                colorPresetPanelOpen && "rotate-180"
              )}
              aria-hidden
            />
          </button>

          {colorPresetPanelOpen ? (
            <div id="settings-color-preset-panel" className="space-y-2 pt-1">
              <p className="text-xs text-muted-foreground">
                ボタン・強調・フォーカスリングなどのアクセント色を選べます。ライト／ダークの両方でコントラストを調整したプリセットです。
              </p>
              <div
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                role="listbox"
                aria-label="カラープリセット"
              >
                {COLOR_PRESETS.map((preset) => {
                  const active = prefs?.colorPreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      disabled={prefs == null}
                      onClick={() => void updatePrefs({ colorPreset: preset.id })}
                      className={cn(
                        "flex w-full flex-col gap-2 rounded-2xl border px-3 py-3 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        active
                          ? "border-primary/55 bg-primary/12"
                          : "border-border/80 bg-background hover:bg-muted/50"
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex shrink-0 gap-1" aria-hidden>
                          <span
                            className="size-6 rounded-lg border border-border/60 shadow-sm"
                            style={{ backgroundColor: preset.swatches.primary }}
                          />
                          <span
                            className="size-6 rounded-lg border border-border/60 shadow-sm"
                            style={{ backgroundColor: preset.swatches.accent }}
                          />
                        </span>
                        <span className="min-w-0 font-semibold leading-tight text-foreground">
                          {preset.label}
                        </span>
                      </div>
                      <p className="pl-[2.875rem] text-[11px] leading-relaxed text-muted-foreground">
                        {preset.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-semibold">学習</CardTitle>
            <HelpHint label="学習オプションの説明">
              <HelpSection title="復習間隔を短くする">
                <p>
                  次の復習予定をやや早めにし、同じ単語が再出題されやすくなります。忘れにくくしたいとき向けのオプションです。単語ごとの履歴はそのまま残ります。
                </p>
              </HelpSection>
              <HelpSection
                title="問題表示時に英語を自動再生"
                note="和→英では出題中は読み上げません。英→和モードのときだけ有効です。"
              >
                <p>
                  4択が表示されたタイミングで、英単語を1回だけ読み上げます（既定はオフ）。公共の場や長時間の学習では音量にご注意ください。
                </p>
              </HelpSection>
              <HelpSection title="出題する難易度">
                <p>
                  新規・ミックス・復習の各モードで、選んだレベルに合う単語だけが出題候補になります。データに明示がない語は、語の長さや品詞からおおまかにレベルを付けています。
                </p>
              </HelpSection>
            </HelpHint>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 text-sm font-medium leading-snug">
              復習間隔を短くする
            </span>
            <Switch
              size="lg"
              className="shrink-0"
              checked={prefs?.compactSchedule ?? false}
              disabled={prefs == null}
              onCheckedChange={(checked) => void updatePrefs({ compactSchedule: Boolean(checked) })}
            />
          </div>
          <Separator />
          <div className="space-y-3">
            <p className="text-sm font-medium leading-snug">出題する難易度</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              レベルは複数選べます。データに難易度が無い語だけ語長・品詞から推定します。
            </p>
            {([1, 2, 3] as const).map((level) => (
              <div key={level} className="flex items-center justify-between gap-3">
                <span className="min-w-0 flex-1 text-sm font-medium leading-snug">
                  {difficultyLabel(level)}
                </span>
                <Switch
                  size="lg"
                  className="shrink-0"
                  checked={prefs?.difficultyLevels?.includes(level) ?? true}
                  disabled={prefs == null}
                  onCheckedChange={(checked) => toggleDifficultyLevel(level, Boolean(checked))}
                />
              </div>
            ))}
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <span className="text-sm font-medium leading-snug">生活・娯楽語も出題する</span>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                オフのときはビジネス場面の語を優先（本番対策トラック）。
              </p>
            </div>
            <Switch
              size="lg"
              className="shrink-0"
              checked={prefs?.includeDailyVocab ?? false}
              disabled={prefs == null}
              onCheckedChange={(checked) =>
                void updatePrefs({ includeDailyVocab: Boolean(checked) })
              }
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 text-sm font-medium leading-snug">例文を表示する</span>
            <Switch
              size="lg"
              className="shrink-0"
              checked={prefs?.showExample ?? true}
              disabled={prefs == null}
              onCheckedChange={(checked) => void updatePrefs({ showExample: Boolean(checked) })}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 text-sm font-medium leading-snug">
              問題表示時に英語を自動再生
            </span>
            <Switch
              size="lg"
              className="shrink-0"
              checked={prefs?.autoSpeakEnglish ?? false}
              disabled={prefs == null}
              onCheckedChange={(checked) => void updatePrefs({ autoSpeakEnglish: Boolean(checked) })}
            />
          </div>
          <Separator />
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium leading-snug">読み上げ速度</p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  単語・例文の英語読み上げに使います。
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 rounded-lg"
                disabled={prefs == null}
                onClick={() => speakEnglish("Please submit the report by Friday.")}
              >
                試聴
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {SPEECH_RATE_PRESETS.map((p) => {
                const active = isSpeechRatePreset(prefs?.speechRate ?? 1, p.value);
                return (
                  <Button
                    key={p.value}
                    type="button"
                    variant={active ? "default" : "outline"}
                    className="h-11 rounded-xl text-sm"
                    disabled={prefs == null}
                    onClick={() => void updatePrefs({ speechRate: p.value })}
                  >
                    {p.label}
                  </Button>
                );
              })}
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 text-sm font-medium leading-snug">問題文に品詞を表示</span>
            <Switch
              size="lg"
              className="shrink-0"
              checked={prefs?.showPartOfSpeechInQuestion ?? true}
              disabled={prefs == null}
              onCheckedChange={(checked) =>
                void updatePrefs({ showPartOfSpeechInQuestion: Boolean(checked) })
              }
            />
          </div>
        </CardContent>
      </Card>
      <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">データ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            学習の進捗・設定・アプリが保持するデータを JSON
            ファイルにまとめて保存・復元できます。機種変更や再インストール前のバックアップに使えます。
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-11 flex-1 rounded-xl"
              onClick={() => void handleExport()}
            >
              <Download className="mr-2 h-4 w-4" aria-hidden />
              エクスポート
            </Button>
            <Button
              variant="outline"
              className="h-11 flex-1 rounded-xl"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" aria-hidden />
              インポート
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
              e.target.value = "";
            }}
          />
        </CardContent>
      </Card>
    </Screen>
  );
}
