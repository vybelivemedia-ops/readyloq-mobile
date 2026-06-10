import { useListQuizzes, useGetTrainingLeaderboard } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GraduationCap, Trophy, ChevronRight, Star, ChevronDown, ChevronUp, BookOpen } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import { VOCABULARY, CATEGORY_LABELS, type Category } from "@/lib/voice-intelligence";
import { cn } from "@/lib/utils";

function difficultyBadge(difficulty: string) {
  const colors: Record<string, string> = {
    easy:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    hard:   "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${colors[difficulty] ?? colors.medium}`}>
      {difficulty}
    </span>
  );
}

function badgeIcon(badge: string) {
  const colors: Record<string, string> = {
    Gold:      "text-yellow-400",
    Silver:    "text-slate-300",
    Bronze:    "text-amber-600",
    Certified: "text-primary",
    Trainee:   "text-muted-foreground",
  };
  return <Trophy className={`h-4 w-4 ${colors[badge] ?? "text-muted-foreground"}`} />;
}

function VocabCategory({ category }: { category: Category }) {
  const [open, setOpen] = useState(false);
  const meta = CATEGORY_LABELS[category];
  const terms = VOCABULARY.filter(t => t.category === category);

  return (
    <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-xl">{meta.icon}</span>
          <div>
            <p className="text-sm font-semibold">{meta.en}</p>
            <p className="text-[10px] text-muted-foreground">{meta.es} · {meta.pt}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted-foreground font-medium">{terms.length} terms</span>
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-border/40 divide-y divide-border/30">
          {terms.map(term => (
            <div key={term.professional} className="px-4 py-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-base">{term.icon}</span>
                <p className="text-sm font-semibold">{term.professional}</p>
              </div>
              <div className="ml-6 space-y-1">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-semibold">Technicians may say</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {term.casual.en.slice(0, 3).join(", ")}
                </p>
                <div className="flex gap-3 pt-0.5">
                  <span className="text-[10px] text-primary/60">🇪🇸 {term.translations.es}</span>
                  <span className="text-[10px] text-primary/60">🇧🇷 {term.translations.pt}</span>
                </div>
                <p className="text-[10px] text-emerald-400/80 italic">{term.reportPhrase.en}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TrainingCenter() {
  const { data: quizzes, isLoading } = useListQuizzes();
  const { data: leaderboard } = useGetTrainingLeaderboard();
  const topThree = (leaderboard ?? []).slice(0, 3);

  const categories: Category[] = ["rodents", "cockroaches", "termites", "carpenter_ants", "exclusion", "conducive"];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Learn</h1>
          <p className="text-muted-foreground text-sm mt-1">Build skills with real inspection examples</p>
        </div>
        <Link href="/training/leaderboard">
          <Button variant="outline" size="sm" className="gap-2 rounded-xl">
            <Trophy className="h-4 w-4" /> Leaderboard
          </Button>
        </Link>
      </div>

      {/* Top performers mini-board */}
      {topThree.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5">
          {topThree.map((entry, i) => (
            <div key={entry.technicianName}
              className={cn("bg-card border rounded-2xl p-3 text-center", i === 0 ? "border-yellow-500/30" : "border-border/60")}>
              <div className="flex justify-center mb-1">{badgeIcon(entry.badge)}</div>
              <p className="text-xs font-semibold truncate">{entry.technicianName.split(" ")[0]}</p>
              <p className="text-lg font-bold text-primary">{entry.avgScore}%</p>
              <p className="text-[10px] text-muted-foreground">{entry.totalQuizzes} quizzes</p>
            </div>
          ))}
        </div>
      )}

      {/* Quiz Grid */}
      <div>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Available Quizzes</h2>
        {isLoading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
          </div>
        ) : (quizzes ?? []).length === 0 ? (
          <div className="bg-card border border-border/60 rounded-2xl p-10 text-center text-muted-foreground">
            <GraduationCap className="h-8 w-8 mx-auto mb-2 opacity-20" />
            <p className="text-sm">No quizzes available yet</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {(quizzes ?? []).map(quiz => (
              <Link key={quiz.id} href={`/training/${quiz.id}`}>
                <div className="bg-card border border-border/60 rounded-2xl px-4 py-3.5 active:bg-primary/5 transition-all cursor-pointer">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {difficultyBadge(quiz.difficulty)}
                        <span className="text-xs text-muted-foreground">{quiz.category}</span>
                      </div>
                      <h3 className="text-sm font-semibold leading-tight">{quiz.title}</h3>
                      {quiz.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{quiz.description}</p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                  </div>
                  <div className="flex items-center gap-4 mt-2.5 text-xs text-muted-foreground">
                    <span>{quiz.questionCount} questions</span>
                    <span>Pass: {quiz.passingScore}%</span>
                    {quiz.averageScore !== null && quiz.averageScore !== undefined && (
                      <span className="flex items-center gap-1">
                        <Star className="h-3 w-3 text-amber-400" /> Avg: {quiz.averageScore}%
                      </span>
                    )}
                    {quiz.completedCount > 0 && <span>{quiz.completedCount} taken</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ── Field Vocabulary Reference ─────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="h-4 w-4 text-primary" />
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Field Vocabulary</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3 -mt-1">
          Tap any category to see professional terminology, casual field descriptions, and translations in English, Spanish, and Portuguese.
        </p>
        <div className="space-y-2">
          {categories.map(cat => <VocabCategory key={cat} category={cat} />)}
        </div>
      </div>
    </div>
  );
}
