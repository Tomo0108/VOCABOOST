"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getAllWords, getWordById, type ToeicWord } from "@/lib/vocab";
import { getDueWordIds, getProgress, rateWord } from "@/lib/progress";
import {
  orderSessionCandidates,
  reshuffleRemainingForDifficulty,
} from "@/lib/session-order";
import { getPreferences, type AppPreferences } from "@/lib/preferences";
import { Screen } from "@/components/app/screen";
import { HelpHint, HelpSection } from "@/components/app/help-hint";
import { Badge } from "@/components/ui/badge";
import type { Rating } from "@/lib/srs";
import { randomSeed, shuffleRandom, shuffleWithSeed } from "@/lib/shuffle";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Shuffle,
  Home,
  RotateCcw,
  Sparkles,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  SESSION_CHECKPOINT_MAX_AGE_MS,
  checkpointMatchesWords,
  clearSessionCheckpoint,
  getSessionCheckpoint,
  saveSessionCheckpoint,
} from "@/lib/session-checkpoint";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, focusRingLink } from "@/lib/utils";
import { splitExampleAroundTerm } from "@/lib/example-svoc";
import { PartOfSpeechDisplay } from "@/components/app/part-of-speech-display";
import { POS_LABEL } from "@/lib/part-of-speech-labels";
import { quizChoiceMeaningJa } from "@/lib/quiz-meaning";
import {
  buildTermQuizOptions,
  termsMatch,
  type QuizDirection,
} from "@/lib/quiz-term";
import { recordSolved } from "@/lib/activity";
import {
  difficultyLabel,
  filterWordsByDifficulty,
  filterWordsByTrack,
  getWordDifficulty,
  type WordDifficulty,
} from "@/lib/word-meta";

type Mode = "new" | "mix" | "review";

/** `diff=1` / `diff=1,3` など。無効・未指定は null（設定に従う） */
function parseDifficultyQueryParam(sp: URLSearchParams): WordDifficulty[] | null {
  const raw = sp.get("diff")?.trim();
  if (!raw) return null;
  const set = new Set<WordDifficulty>();
  for (const part of raw.split(/[,+]/)) {
    const n = Number(part.trim());
    if (n === 1 || n === 2 || n === 3) set.add(n);
  }
  if (set.size === 0) return null;
  return [...set].sort((a, b) => a - b);
}

/** タイトル下の専用行（親で絞り込み中のみ渡す） */
function SessionDifficultyRow({ levels }: { levels: WordDifficulty[] }) {
  const detail =
    levels.length === 1
      ? `${difficultyLabel(levels[0]!)}のみ`
      : levels.map((d) => difficultyLabel(d)).join("・");
  return (
    <div
      className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5"
      role="status"
      aria-label={`出題の難易度 ${detail}`}
    >
      <p className="text-[11px] font-medium text-muted-foreground">出題の難易度</p>
      <p className="mt-0.5 text-sm font-medium leading-snug text-foreground">{detail}</p>
    </div>
  );
}

async function loadSessionWords(
  mode: Mode,
  n: number,
  offset: number,
  mixSeed: string | null,
  difficultyLevels: WordDifficulty[],
  includeDailyVocab: boolean
): Promise<ToeicWord[]> {
  const all = filterWordsByDifficulty(
    filterWordsByTrack(getAllWords(), includeDailyVocab),
    difficultyLevels
  );
  if (mode === "review") {
    const [progress, ids] = await Promise.all([getProgress(), getDueWordIds()]);
    const map = new Map(all.map((w) => [w.id, w]));
    const list = ids
      .slice(0, n)
      .map((id) => map.get(id))
      .filter((w): w is ToeicWord => Boolean(w));
    return orderSessionCandidates(list, progress);
  }
  const progress = await getProgress();
  if (mode === "new") {
    const unseen = all.filter((w) => !progress[w.id]);
    const picked = shuffleRandom(unseen).slice(0, n);
    return orderSessionCandidates(picked, progress);
  }
  if (!mixSeed) return [];
  const order = shuffleWithSeed(all, mixSeed);
  const slice = order.slice(offset, offset + n);
  return orderSessionCandidates(slice, progress);
}

function speakEnglish(term: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(term);
  u.lang = "en-US";
  window.speechSynthesis.speak(u);
}

/** 正解1＋他語からの誤答3をランダム順で返す */
function buildMeaningQuizOptions(current: ToeicWord, all: ToeicWord[]): string[] {
  const correctRaw = current.meaningJa?.trim() || "—";
  const correct = quizChoiceMeaningJa(correctRaw);
  const distractorPool = shuffleRandom(
    [
      ...new Set(
        all
          .filter((w) => w.id !== current.id)
          .map((w) => w.meaningJa?.trim())
          .filter((m): m is string => Boolean(m))
          .map((m) => quizChoiceMeaningJa(m))
      ),
    ].filter((m) => m !== correct && m.length > 0)
  );
  const wrong: string[] = distractorPool.slice(0, 3);
  while (wrong.length < 3 && distractorPool.length > 0) {
    wrong.push(distractorPool[wrong.length % distractorPool.length]!);
  }
  while (wrong.length < 3) {
    wrong.push(`（ほかの意味 ${wrong.length + 1}）`);
  }
  return shuffleRandom([correct, ...wrong.slice(0, 3)]);
}

type SessionAnswerRecord = {
  word: ToeicWord;
  wasCorrect: boolean;
  pickedMeaning: string;
  direction: QuizDirection;
};

function WordAnswerExplainer({
  word,
  wasCorrect,
  pickedMeaning,
  direction = "en-ja",
}: {
  word: ToeicWord;
  wasCorrect: boolean;
  pickedMeaning: string;
  direction?: QuizDirection;
}) {
  const correctMeaning = word.meaningJa?.trim() || "—";
  const pickedWrongJaEnMeaning =
    direction === "ja-en" && !wasCorrect
      ? (() => {
          const w = getAllWords().find((x) => termsMatch(x.term, pickedMeaning));
          const m = w?.meaningJa?.trim();
          return m ? quizChoiceMeaningJa(m) : null;
        })()
      : null;
  const ex = splitExampleAroundTerm(
    word.exampleEn ?? "",
    word.term,
    word.partOfSpeech
  );

  return (
    <div className="space-y-4">
      {!wasCorrect ? (
        <div className="space-y-1 rounded-xl border border-border/60 bg-muted/25 px-3 py-2.5 text-sm">
          <p className="text-xs font-medium text-muted-foreground">
            {direction === "ja-en" ? "選んだ英語" : "選んだ和訳"}
          </p>
          <p className="text-foreground">{pickedMeaning}</p>
          {direction === "ja-en" && pickedWrongJaEnMeaning ? (
            <p className="pt-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">その単語の和訳</span>
              <span className="mt-0.5 block text-sm text-foreground">
                {pickedWrongJaEnMeaning}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-1 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-sm">
        {direction === "ja-en" ? (
          <>
            <p className="text-xs font-medium text-muted-foreground">和訳</p>
            <p className="text-foreground">{quizChoiceMeaningJa(correctMeaning)}</p>
          </>
        ) : (
          <>
            <p className="text-xs font-medium text-muted-foreground">正解の和訳</p>
            <p className="font-medium text-foreground">{quizChoiceMeaningJa(correctMeaning)}</p>
          </>
        )}
      </div>
      {word.partOfSpeech ? (
        <p className="text-xs text-muted-foreground">
          品詞：{POS_LABEL[word.partOfSpeech] ?? word.partOfSpeech}
        </p>
      ) : null}

      {word.exampleEn ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">例文（英語）</p>
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

function AnswerReviewDetails({
  word,
  wasCorrect,
  pickedMeaning,
  direction = "en-ja",
}: {
  word: ToeicWord;
  wasCorrect: boolean;
  pickedMeaning: string;
  direction?: QuizDirection;
}) {
  return (
    <div className="space-y-4 border-t border-border/50 pt-3">
      <WordAnswerExplainer
        word={word}
        wasCorrect={wasCorrect}
        pickedMeaning={pickedMeaning}
        direction={direction}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="rounded-lg"
        aria-label={`${word.term} を読み上げ`}
        onClick={() => speakEnglish(word.term)}
      >
        <Volume2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        発音
      </Button>
    </div>
  );
}

function FeedbackCard({
  word,
  pending,
  ratingBusy,
  onConfirm,
  onSpeak,
  showPos,
  direction = "en-ja",
}: {
  word: ToeicWord;
  pending: { wasCorrect: boolean; pickedMeaning: string };
  ratingBusy: boolean;
  onConfirm: () => void;
  onSpeak: () => void;
  showPos: boolean;
  direction?: QuizDirection;
}) {
  return (
    <>
      <CardHeader className="space-y-3 pb-3">
        <Button
          type="button"
          className="h-12 w-full rounded-xl font-medium"
          disabled={ratingBusy}
          onClick={onConfirm}
        >
          次の問題へ
        </Button>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {pending.wasCorrect ? "正解です" : "不正解です"}
        </p>
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-center text-base font-semibold tracking-tight",
            pending.wasCorrect
              ? "bg-primary/12 text-primary"
              : "bg-destructive/10 text-destructive"
          )}
        >
          {pending.wasCorrect ? "正解" : "不正解"}
        </div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {showPos && word.partOfSpeech ? (
                <PartOfSpeechDisplay partOfSpeech={word.partOfSpeech} size="md" />
              ) : showPos ? (
                <span className="text-xs text-muted-foreground">品詞未分類</span>
              ) : null}
              <CardTitle className="break-words text-2xl font-semibold tracking-tight text-foreground">
                {word.term}
              </CardTitle>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0 rounded-xl"
            aria-label="英語を読み上げ"
            onClick={onSpeak}
          >
            <Volume2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-0">
        <WordAnswerExplainer
          word={word}
          wasCorrect={pending.wasCorrect}
          pickedMeaning={pending.pickedMeaning}
          direction={direction}
        />
      </CardContent>
    </>
  );
}

export function StudySessionClient() {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const mode = (sp.get("mode") as Mode | null) ?? "mix";
  const n = Math.max(1, Math.min(50, Number(sp.get("n") ?? "10") || 10));
  const offset = Math.max(0, Number(sp.get("offset") ?? "0") || 0);
  const seedParam = sp.get("seed") ?? "";
  /** 同一クエリでの再入（新規・復習の「続き」）時にナビ／再マウントを確実にする */
  const sessionNonce = sp.get("_t") ?? "";
  const quizDirection: QuizDirection =
    sp.get("dir") === "ja-en" ? "ja-en" : "en-ja";
  const [navPending, startNavTransition] = useTransition();

  const [words, setWords] = useState<ToeicWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [moreNew, setMoreNew] = useState(false);
  const [moreReview, setMoreReview] = useState(false);
  const [mixSeedState, setMixSeedState] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<AppPreferences | null>(null);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratingCounts, setRatingCounts] = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [sessionResults, setSessionResults] = useState<SessionAnswerRecord[]>([]);
  const [pendingFeedback, setPendingFeedback] = useState<{
    rating: Rating;
    pickedMeaning: string;
    wasCorrect: boolean;
  } | null>(null);
  /** 出題プールの難易度（設定または URL の `diff`） */
  const [sessionLevels, setSessionLevels] = useState<WordDifficulty[]>([1, 2, 3]);
  /** true のとき `diff` を次ナビにも付けて上書きを維持する */
  const [difficultyFromUrl, setDifficultyFromUrl] = useState(false);
  const restoredRef = useRef(false);
  const autoSpokenForQuestionRef = useRef<string | null>(null);
  const advancingFeedbackRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setIdx(0);
    setSessionResults([]);
    setPendingFeedback(null);

    void (async () => {
      const params = new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : sp.toString()
      );
      const prefs = await getPreferences();
      const parsedDiff = parseDifficultyQueryParam(params);
      const difficultyLevels = parsedDiff ?? prefs.difficultyLevels;
      const includeDailyVocab = prefs.includeDailyVocab;
      const fromUrl = parsedDiff != null;
      if (!cancelled) {
        setDifficultyFromUrl(fromUrl);
        setSessionLevels(difficultyLevels);
        setPrefs(prefs);
      }

      let mixSeed: string | null = null;
      if (mode === "mix") {
        mixSeed = params.get("seed");
        if (!mixSeed && typeof window !== "undefined") {
          mixSeed = randomSeed();
          params.set("seed", mixSeed);
          const qs = params.toString();
          window.history.replaceState(
            null,
            "",
            qs ? `${pathname}?${qs}` : pathname
          );
        }
        if (!cancelled) setMixSeedState(mixSeed);
      } else {
        if (!cancelled) setMixSeedState(null);
      }

      const w = await loadSessionWords(
        mode,
        n,
        offset,
        mixSeed,
        difficultyLevels,
        includeDailyVocab
      );
      if (!cancelled) {
        setWords(w);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, n, offset, pathname, quizDirection, seedParam, sessionNonce, sp.toString()]);

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

  const current = words[idx];
  const meaningOptions = useMemo(() => {
    if (!current) return [] as string[];
    if (quizDirection === "ja-en") {
      return buildTermQuizOptions(current, getAllWords());
    }
    return buildMeaningQuizOptions(current, getAllWords());
  }, [current, quizDirection]);
  const done = !loading && words.length > 0 && idx >= words.length;
  const inQuiz =
    !loading && words.length > 0 && idx < words.length;
  const totalWords = useMemo(
    () =>
      filterWordsByDifficulty(
        filterWordsByTrack(getAllWords(), prefs?.includeDailyVocab ?? false),
        sessionLevels
      ).length,
    [sessionLevels, prefs?.includeDailyVocab]
  );
  const percent = Math.round(
    (Math.min(idx, words.length) / Math.max(words.length, 1)) * 100
  );

  useEffect(() => {
    if (!done || mode !== "new") return;
    let cancelled = false;
    void (async () => {
      const progress = await getProgress();
      if (cancelled) return;
      const unseen = filterWordsByDifficulty(
        filterWordsByTrack(
          getAllWords().filter((w) => !progress[w.id]),
          prefs?.includeDailyVocab ?? false
        ),
        sessionLevels
      );
      setMoreNew(unseen.length > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [done, mode, sessionLevels, prefs?.includeDailyVocab]);

  useEffect(() => {
    if (!done || mode !== "review") return;
    let cancelled = false;
    void (async () => {
      const ids = await getDueWordIds();
      if (cancelled) return;
      const levelSet = new Set(sessionLevels);
      const dueInLevels = ids.some((id) => {
        const w = getWordById(id);
        return w ? levelSet.has(getWordDifficulty(w)) : false;
      });
      setMoreReview(dueInLevels);
    })();
    return () => {
      cancelled = true;
    };
  }, [done, mode, sessionLevels]);

  useEffect(() => {
    if (done) void clearSessionCheckpoint();
  }, [done]);

  useEffect(() => {
    if (!loading && words.length === 0) void clearSessionCheckpoint();
  }, [loading, words.length]);

  useEffect(() => {
    if (loading) {
      restoredRef.current = false;
      return;
    }
    if (words.length === 0) return;
    if (restoredRef.current) return;
    let cancelled = false;
    void (async () => {
      const cp = await getSessionCheckpoint();
      if (cancelled) return;
      if (!cp || Date.now() - cp.updatedAt > SESSION_CHECKPOINT_MAX_AGE_MS) {
        restoredRef.current = true;
        return;
      }
      const search = typeof window !== "undefined" ? window.location.search : "";
      if (!checkpointMatchesWords(cp, pathname, search, words)) {
        restoredRef.current = true;
        return;
      }
      restoredRef.current = true;
      queueMicrotask(() => {
        if (!cancelled) {
          setIdx(Math.min(cp.idx, Math.max(0, words.length - 1)));
        }
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, words, pathname]);

  useEffect(() => {
    autoSpokenForQuestionRef.current = null;
  }, [words]);

  useEffect(() => {
    if (loading || words.length === 0 || idx >= words.length) return;
    const search = typeof window !== "undefined" ? window.location.search : "";
    void saveSessionCheckpoint({
      pathname,
      search,
      idx,
      wordIds: words.map((w) => w.id),
    });
  }, [loading, words, idx, pathname]);

  useEffect(() => {
    if (!inQuiz) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [inQuiz]);

  useEffect(() => {
    if (loading || !current || pendingFeedback) return;
    if (quizDirection === "ja-en") return;
    if (prefs?.autoSpeakEnglish !== true) return;
    if (autoSpokenForQuestionRef.current === current.id) return;
    autoSpokenForQuestionRef.current = current.id;
    speakEnglish(current.term);
  }, [
    loading,
    current?.id,
    current?.term,
    pendingFeedback,
    prefs?.autoSpeakEnglish,
    quizDirection,
  ]);

  const applyRatingAndAdvance = useCallback(async () => {
    if (!current || !pendingFeedback) return;
    if (advancingFeedbackRef.current) return;
    advancingFeedbackRef.current = true;
    const { rating, wasCorrect, pickedMeaning } = pendingFeedback;
    setRatingBusy(true);
    try {
      await rateWord(current.id, rating, {
        compactSchedule: prefs?.compactSchedule ?? false,
      });
      setRatingCounts((prev) => ({ ...prev, [rating]: prev[rating] + 1 }));
      const nextResults = [
        ...sessionResults,
        { word: current, wasCorrect, pickedMeaning, direction: quizDirection },
      ];
      const nextIdx = idx + 1;
      setSessionResults(nextResults);
      setPendingFeedback(null);
      setWords((w) => reshuffleRemainingForDifficulty(w, nextIdx, nextResults));
      setIdx(nextIdx);
      void recordSolved(1).catch(() => {});
    } catch {
      toast.error("記録を保存できませんでした。もう一度お試しください。");
    } finally {
      advancingFeedbackRef.current = false;
      setRatingBusy(false);
    }
  }, [
    current,
    pendingFeedback,
    prefs?.compactSchedule,
    idx,
    sessionResults,
    quizDirection,
  ]);

  const pickMeaning = useCallback(
    (picked: string) => {
      if (!current || ratingBusy || pendingFeedback) return;
      let wasCorrect: boolean;
      if (quizDirection === "ja-en") {
        wasCorrect = termsMatch(picked, current.term);
      } else {
        const correct = quizChoiceMeaningJa(current.meaningJa?.trim() || "—");
        wasCorrect = picked === correct;
      }
      setPendingFeedback({
        rating: wasCorrect ? "good" : "again",
        pickedMeaning: picked,
        wasCorrect,
      });
    },
    [current, ratingBusy, pendingFeedback, quizDirection]
  );

  const confirmFeedback = useCallback(() => {
    void applyRatingAndAdvance();
  }, [applyRatingAndAdvance]);

  useEffect(() => {
    if (loading) return;
    const inQuizLocal = words.length > 0 && idx < words.length;
    if (!inQuizLocal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true]")) return;
      if (pendingFeedback) {
        if (e.key === "Enter") {
          e.preventDefault();
          confirmFeedback();
        }
        return;
      }
      const n = Number(e.key);
      if (n < 1 || n > 4) return;
      e.preventDefault();
      const picked = meaningOptions[n - 1];
      if (!picked) return;
      pickMeaning(picked);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    loading,
    words.length,
    idx,
    meaningOptions,
    pickMeaning,
    pendingFeedback,
    confirmFeedback,
  ]);

  const requestLeaveStudy = useCallback(() => {
    if (inQuiz) setLeaveOpen(true);
    else router.push("/study");
  }, [inQuiz, router]);

  const confirmLeaveStudy = useCallback(() => {
    setLeaveOpen(false);
    router.push("/study");
  }, [router]);

  const modeLabel =
    mode === "review" ? "復習" : mode === "new" ? "新規" : "ミックス";
  const modeIcon =
    mode === "review" ? (
      <RotateCcw className="h-5 w-5" />
    ) : mode === "new" ? (
      <Sparkles className="h-5 w-5" />
    ) : (
      <Shuffle className="h-5 w-5" />
    );

  const jaEnIcon = <BookOpen className="h-5 w-5" />;
  const mixHasNext = mode === "mix" && offset + words.length < totalWords;
  const seedQ =
    mixSeedState != null && mixSeedState !== ""
      ? `&seed=${encodeURIComponent(mixSeedState)}`
      : "";
  const dirQuery = quizDirection === "ja-en" ? "&dir=ja-en" : "";
  const diffPreserveQuery =
    difficultyFromUrl && sessionLevels.length > 0
      ? `&diff=${sessionLevels.join(",")}`
      : "";
  const mixNextHref = `/study/session?mode=mix&n=${n}&offset=${offset + words.length}${seedQ}${dirQuery}${diffPreserveQuery}`;
  const sessionScreenTitle =
    quizDirection === "ja-en"
      ? "学習（和→英）"
      : mode === "review"
        ? "復習"
        : mode === "new"
          ? "学習（新規）"
          : "学習（ミックス）";

  const showPosInQuestion = prefs?.showPartOfSpeechInQuestion ?? true;

  const sessionHelpContent =
    quizDirection === "ja-en" ? (
      <>
        <HelpSection title="出題">
          <p>和訳の意味に合う英単語を、4択から1つ選びます。</p>
        </HelpSection>
        <HelpSection title="解答後">
          <p>正誤のあと、例文や補足の和訳を確認できます。</p>
        </HelpSection>
      </>
    ) : (
      <>
        <HelpSection title="出題">
          <p>表示されている英単語に合う和訳を、4択から1つ選びます。</p>
        </HelpSection>
        <HelpSection title="解答後・セット終了後">
          <p>
            各問のあとに正誤と例文を確認できます。セット終了後は「結果」画面の一覧から、内容をいつでも振り返れます。
          </p>
        </HelpSection>
      </>
    );

  const headerIcon = quizDirection === "ja-en" ? jaEnIcon : modeIcon;
  const headerRight =
    quizDirection === "ja-en" ? undefined : (
      <Badge variant="secondary">{modeLabel}</Badge>
    );
  const difficultyHeaderAccessory =
    sessionLevels.length < 3 ? (
      <SessionDifficultyRow levels={sessionLevels} />
    ) : undefined;

  if (loading) {
    return (
      <Screen
        title={sessionScreenTitle}
        icon={headerIcon}
        backHref="/study"
        right={headerRight}
        headerAccessory={difficultyHeaderAccessory}
      >
        <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
          <CardContent className="py-14 text-center text-sm text-muted-foreground">
            読み込み中…
          </CardContent>
        </Card>
      </Screen>
    );
  }

  if (!loading && words.length === 0) {
    const emptyMsg =
      mode === "review"
        ? "いま期限どおりの単語はありません。"
        : mode === "new"
          ? "未学習の単語が残っていません。"
          : offset >= totalWords
            ? "指定位置が単語リストの終端を超えています。"
            : "この条件では単語が選べませんでした。";

    return (
      <Screen
        title={sessionScreenTitle}
        icon={headerIcon}
        backHref="/study"
        right={headerRight}
        headerAccessory={difficultyHeaderAccessory}
      >
        <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
          <CardContent className="space-y-3 p-6">
            <p className="text-sm text-muted-foreground">{emptyMsg}</p>
            <Link
              href={`/study/session?mode=mix&n=10&offset=0${dirQuery}${diffPreserveQuery}`}
              className={cn(
                focusRingLink,
                "inline-flex h-12 w-full items-center justify-center rounded-2xl bg-primary px-4 font-medium text-primary-foreground",
                "shadow-sm transition-opacity hover:opacity-95"
              )}
            >
              {quizDirection === "ja-en" ? "和→英で10単語始める" : "ミックス10単語から始める"}
            </Link>
            <Link
              href="/study"
              className={cn(
                focusRingLink,
                "inline-flex h-11 w-full items-center justify-center rounded-2xl border border-border/60 bg-background text-sm font-medium"
              )}
            >
              <BookOpen className="mr-2 h-4 w-4 opacity-70" aria-hidden />
              学習メニュー
            </Link>
          </CardContent>
        </Card>
      </Screen>
    );
  }

  if (!current && done) {
    return (
      <Screen
        title="結果"
        subtitle={`${words.length}問お疲れさまでした。下の「振り返り」で和訳・例文を開いて確認できます。`}
        icon={<Check className="h-5 w-5" />}
        backHref="/study"
      >
        <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">スコア</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl border border-border/60 bg-background/80 px-2 py-2.5">
                <p className="text-lg font-semibold tabular-nums text-primary">
                  {ratingCounts.good}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">正解</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/80 px-2 py-2.5">
                <p className="text-lg font-semibold tabular-nums text-destructive">
                  {ratingCounts.again}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">不正解</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">振り返り</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sessionResults.map((r, i) => (
              <details
                key={`${r.word.id}-${i}`}
                className="group rounded-xl border border-border/60 bg-background/80"
              >
                <summary
                  className={cn(
                    "flex cursor-pointer list-none items-center gap-2 px-3 py-3",
                    "[&::-webkit-details-marker]:hidden"
                  )}
                >
                  <ChevronDown
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 text-left text-sm font-medium text-foreground">
                    <span className="tabular-nums text-muted-foreground">{i + 1}. </span>
                    {r.word.term}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold",
                      r.wasCorrect
                        ? "bg-primary/15 text-primary"
                        : "bg-destructive/10 text-destructive"
                    )}
                  >
                    {r.wasCorrect ? "正解" : "不正解"}
                  </span>
                </summary>
                <div className="px-3 pb-3">
                  <AnswerReviewDetails
                    word={r.word}
                    wasCorrect={r.wasCorrect}
                    pickedMeaning={r.pickedMeaning}
                    direction={r.direction}
                  />
                </div>
              </details>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
          <CardContent className="space-y-3 pt-6 text-sm">
            {mixHasNext ? (
              <button
                type="button"
                disabled={navPending}
                onClick={() =>
                  startNavTransition(() => {
                    router.push(mixNextHref);
                  })
                }
                className={cn(
                  focusRingLink,
                  "inline-flex h-12 w-full items-center justify-center rounded-2xl bg-primary font-medium text-primary-foreground",
                  "shadow-sm transition-opacity hover:opacity-95 active:opacity-90 disabled:opacity-60"
                )}
              >
                次の{n}単語を始める
                <ChevronRight className="ml-1 h-4 w-4 opacity-90" aria-hidden />
              </button>
            ) : null}

            {mode === "new" && moreNew ? (
              <button
                type="button"
                disabled={navPending}
                onClick={() =>
                  startNavTransition(() => {
                    router.push(
                      `/study/session?mode=new&n=${n}${dirQuery}${diffPreserveQuery}&_t=${Date.now()}`
                    );
                  })
                }
                className={cn(
                  focusRingLink,
                  "inline-flex h-12 w-full items-center justify-center rounded-2xl bg-primary font-medium text-primary-foreground",
                  "shadow-sm transition-opacity hover:opacity-95 active:opacity-90 disabled:opacity-60"
                )}
              >
                次の{n}単語を始める
                <ChevronRight className="ml-1 h-4 w-4 opacity-90" aria-hidden />
              </button>
            ) : null}

            {mode === "review" && moreReview ? (
              <button
                type="button"
                disabled={navPending}
                onClick={() =>
                  startNavTransition(() => {
                    router.push(
                      `/study/session?mode=review&n=${n}${dirQuery}${diffPreserveQuery}&_t=${Date.now()}`
                    );
                  })
                }
                className={cn(
                  focusRingLink,
                  "inline-flex h-12 w-full items-center justify-center rounded-2xl bg-primary font-medium text-primary-foreground",
                  "shadow-sm transition-opacity hover:opacity-95 active:opacity-90 disabled:opacity-60"
                )}
              >
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                復習を続ける
              </button>
            ) : null}

            <Link
              href="/review"
              className={cn(
                focusRingLink,
                "inline-flex h-12 w-full items-center justify-center rounded-2xl border border-border/60 bg-background font-medium",
                "transition-colors hover:bg-muted/80 active:bg-muted"
              )}
            >
              <RotateCcw className="mr-2 h-4 w-4 opacity-70" aria-hidden />
              復習ページへ
            </Link>
            <Link
              href="/"
              className={cn(
                focusRingLink,
                "inline-flex h-11 w-full items-center justify-center rounded-2xl border border-border/60 bg-background text-sm font-medium",
                "transition-colors hover:bg-muted/80"
              )}
            >
              <Home className="mr-2 h-4 w-4 opacity-70" aria-hidden />
              ホームへ
            </Link>
          </CardContent>
        </Card>
      </Screen>
    );
  }

  return (
    <>
      <Screen
        title={sessionScreenTitle}
        titleHelp={
          <HelpHint label="このモードの進め方">{sessionHelpContent}</HelpHint>
        }
        icon={headerIcon}
        renderBack={
          <button
            type="button"
            onClick={requestLeaveStudy}
            className={cn(
              focusRingLink,
              "inline-flex h-10 w-10 items-center justify-center rounded-xl",
              "text-muted-foreground transition-colors hover:text-foreground active:bg-muted/60"
            )}
            aria-label="戻る"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        }
        right={headerRight}
        headerAccessory={difficultyHeaderAccessory}
      >
        <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {Math.min(idx + 1, words.length)} / {words.length}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <Progress
            value={percent}
            getAriaValueText={(_formatted, v) => {
              const pct = v ?? percent;
              const cur = Math.min(idx + 1, words.length);
              return `${cur}単語目、全${words.length}単語、進捗${Math.round(pct)}パーセント`;
            }}
          />
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
        {pendingFeedback ? (
          <FeedbackCard
            word={current}
            pending={pendingFeedback}
            ratingBusy={ratingBusy}
            onConfirm={confirmFeedback}
            onSpeak={() => speakEnglish(current.term)}
            showPos={showPosInQuestion}
            direction={quizDirection}
          />
        ) : (
          <>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-2">
                  {quizDirection === "en-ja" ? (
                    <>
                      <p className="sr-only" aria-live="polite" aria-atomic="true">
                        {idx + 1}単語目
                        {showPosInQuestion && current.partOfSpeech
                          ? `、${POS_LABEL[current.partOfSpeech]}`
                          : ""}
                        、単語 {current.term}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        {showPosInQuestion && current.partOfSpeech ? (
                          <PartOfSpeechDisplay partOfSpeech={current.partOfSpeech} size="md" />
                        ) : showPosInQuestion ? (
                          <span className="text-xs text-muted-foreground">品詞未分類</span>
                        ) : null}
                        <CardTitle className="break-words text-3xl font-semibold tracking-tight text-foreground">
                          {current.term}
                        </CardTitle>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="sr-only" aria-live="polite" aria-atomic="true">
                        {idx + 1}単語目
                        {showPosInQuestion && current.partOfSpeech
                          ? `、${POS_LABEL[current.partOfSpeech]}`
                          : ""}
                        、和訳{" "}
                        {quizChoiceMeaningJa(current.meaningJa?.trim() || "—")}
                      </p>
                      <div className="flex items-start gap-3">
                        {showPosInQuestion ? (
                          <div className="shrink-0">
                            {current.partOfSpeech ? (
                              <PartOfSpeechDisplay partOfSpeech={current.partOfSpeech} size="md" />
                            ) : (
                              <span className="flex h-10 max-w-[4rem] items-center text-xs leading-snug text-muted-foreground">
                                品詞未分類
                              </span>
                            )}
                          </div>
                        ) : null}
                        <p className="min-w-0 flex-1 break-words pt-1.5 text-2xl font-semibold leading-snug tracking-tight text-foreground sm:pt-2 sm:text-3xl">
                          {quizChoiceMeaningJa(current.meaningJa?.trim() || "—")}
                        </p>
                      </div>
                    </>
                  )}
                  {current.tags && current.tags.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {current.tags.join(" · ")}
                    </p>
                  ) : null}
                </div>
                {quizDirection === "en-ja" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0 rounded-xl"
                    aria-label="英語を読み上げ"
                    onClick={() => speakEnglish(current.term)}
                  >
                    <Volume2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2.5">
                {meaningOptions.map((label, i) => (
                  <Button
                    key={`${current.id}-${i}`}
                    type="button"
                    variant="outline"
                    className="h-auto min-h-12 justify-start whitespace-normal rounded-xl px-3 py-3 text-left text-sm font-medium leading-snug"
                    disabled={ratingBusy}
                    onClick={() => pickMeaning(label)}
                  >
                    <span className="mr-2 shrink-0 tabular-nums text-muted-foreground">
                      {i + 1}.
                    </span>
                    <span>{label}</span>
                  </Button>
                ))}
              </div>
            </CardContent>
          </>
        )}
      </Card>
      </Screen>

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>学習を中断しますか？</DialogTitle>
            <DialogDescription>
              {pendingFeedback
                ? "結果確認中の問題があります。このまま戻ると、ホームの「続きから」で同じ位置から再開できます。"
                : "未回答の単語が残っています。このまま戻ると、ホームの「続きから」で同じ位置から再開できます。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setLeaveOpen(false)}>
              キャンセル
            </Button>
            <Button type="button" onClick={confirmLeaveStudy}>
              学習メニューへ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
