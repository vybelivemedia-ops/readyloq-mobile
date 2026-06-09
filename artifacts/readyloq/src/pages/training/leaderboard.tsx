import { useGetTrainingLeaderboard, useListTrainingScores } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Trophy, Medal, Star } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

function RankIcon({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy className="h-5 w-5 text-yellow-400" />;
  if (rank === 2) return <Medal className="h-5 w-5 text-slate-300" />;
  if (rank === 3) return <Medal className="h-5 w-5 text-amber-600" />;
  return <span className="text-sm font-bold text-muted-foreground w-5 text-center">{rank}</span>;
}

function BadgeChip({ badge }: { badge: string }) {
  const styles: Record<string, string> = {
    Gold: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    Silver: "bg-slate-400/15 text-slate-300 border-slate-400/30",
    Bronze: "bg-amber-600/15 text-amber-500 border-amber-600/30",
    Certified: "bg-primary/15 text-primary border-primary/30",
    Trainee: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase tracking-wide ${styles[badge] ?? styles.Trainee}`}>
      {badge}
    </span>
  );
}

export default function Leaderboard() {
  const { data: leaderboard, isLoading } = useGetTrainingLeaderboard();
  const { data: scores } = useListTrainingScores();
  const recentScores = (scores ?? []).slice(0, 5);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/training"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div>
          <h1 className="text-2xl font-bold">Leaderboard</h1>
          <p className="text-muted-foreground text-sm">Top performing technicians</p>
        </div>
      </div>

      {/* Podium top 3 */}
      {!isLoading && (leaderboard ?? []).length >= 3 && (
        <div className="grid grid-cols-3 gap-3 items-end">
          {[1, 0, 2].map(idx => {
            const entry = (leaderboard ?? [])[idx];
            if (!entry) return null;
            const heights = [idx === 0 ? "pb-8" : idx === 1 ? "pb-4" : "pb-2"];
            return (
              <Card key={entry.technicianName} className={`text-center ${idx === 0 ? "border-yellow-500/30 bg-yellow-500/5" : ""}`}>
                <CardContent className={`pt-4 ${heights[0]}`}>
                  <div className="flex justify-center mb-2"><RankIcon rank={entry.rank} /></div>
                  <p className="text-xs font-bold truncate">{entry.technicianName.split(" ")[0]}</p>
                  <p className="text-xl font-bold text-primary mt-1">{entry.avgScore}%</p>
                  <BadgeChip badge={entry.badge} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Full table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All Rankings</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : (leaderboard ?? []).length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">No scores yet.</div>
          ) : (
            <div className="divide-y divide-border">
              {(leaderboard ?? []).map(entry => (
                <div key={entry.technicianName} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-6 flex justify-center shrink-0"><RankIcon rank={entry.rank} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{entry.technicianName}</span>
                      <BadgeChip badge={entry.badge} />
                    </div>
                    <p className="text-xs text-muted-foreground">{entry.totalQuizzes} quizzes • {Math.round(entry.passRate * 100)}% pass rate</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-primary">{entry.avgScore}%</p>
                    <p className="text-xs text-muted-foreground">avg score</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent activity */}
      {recentScores.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentScores.map(s => (
              <div key={s.id} className="flex items-center gap-3 text-sm">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${s.passed ? "bg-emerald-500/15" : "bg-red-500/15"}`}>
                  {s.passed ? <Star className="h-3.5 w-3.5 text-emerald-400" /> : <span className="text-xs text-red-400">✗</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{s.technicianName}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.quizTitle}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold ${s.passed ? "text-emerald-400" : "text-red-400"}`}>{s.score}%</p>
                  <p className="text-[10px] text-muted-foreground">{new Date(s.completedAt).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
