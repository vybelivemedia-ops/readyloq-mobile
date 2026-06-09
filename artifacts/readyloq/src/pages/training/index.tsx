import { useListQuizzes, useGetTrainingLeaderboard } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GraduationCap, Trophy, ChevronRight, Star } from "lucide-react";
import { Link } from "wouter";

function difficultyBadge(difficulty: string) {
  const colors: Record<string, string> = {
    easy: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    hard: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${colors[difficulty] ?? colors.medium}`}>
      {difficulty}
    </span>
  );
}

function badgeIcon(badge: string) {
  const colors: Record<string, string> = {
    Gold: "text-yellow-400",
    Silver: "text-slate-300",
    Bronze: "text-amber-600",
    Certified: "text-primary",
    Trainee: "text-muted-foreground",
  };
  return <Trophy className={`h-4 w-4 ${colors[badge] ?? "text-muted-foreground"}`} />;
}

export default function TrainingCenter() {
  const { data: quizzes, isLoading } = useListQuizzes();
  const { data: leaderboard } = useGetTrainingLeaderboard();
  const topThree = (leaderboard ?? []).slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Training Center</h1>
          <p className="text-muted-foreground text-sm mt-1">Sharpen your identification skills with AI-curated quizzes</p>
        </div>
        <Link href="/training/leaderboard">
          <Button variant="outline" size="sm" className="gap-2">
            <Trophy className="h-4 w-4" /> Leaderboard
          </Button>
        </Link>
      </div>

      {/* Top performers mini-board */}
      {topThree.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {topThree.map((entry, i) => (
            <Card key={entry.technicianName} className={`bg-card ${i === 0 ? "border-yellow-500/30" : ""}`}>
              <CardContent className="pt-3 pb-3 text-center">
                <div className="flex justify-center mb-1">{badgeIcon(entry.badge)}</div>
                <p className="text-xs font-semibold truncate">{entry.technicianName.split(" ")[0]}</p>
                <p className="text-lg font-bold text-primary">{entry.avgScore}%</p>
                <p className="text-[10px] text-muted-foreground">{entry.totalQuizzes} quizzes</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Quiz Grid */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Available Quizzes</h2>
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        ) : (quizzes ?? []).length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-muted-foreground">
              <GraduationCap className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No quizzes available yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(quizzes ?? []).map(quiz => (
              <Link key={quiz.id} href={`/training/${quiz.id}`}>
                <Card className="bg-card hover:bg-muted/30 transition-colors cursor-pointer h-full">
                  <CardContent className="pt-4 pb-4">
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
                    <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                      <span>{quiz.questionCount} questions</span>
                      <span>Pass: {quiz.passingScore}%</span>
                      {quiz.averageScore !== null && quiz.averageScore !== undefined && (
                        <span className="flex items-center gap-1">
                          <Star className="h-3 w-3 text-amber-400" /> Avg: {quiz.averageScore}%
                        </span>
                      )}
                      {quiz.completedCount > 0 && (
                        <span>{quiz.completedCount} taken</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
