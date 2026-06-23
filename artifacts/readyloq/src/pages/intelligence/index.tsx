import { useState } from "react";
import { Link } from "wouter";
import { 
  useListIntelligenceRecords, 
  getListIntelligenceRecordsQueryKey 
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Brain, X, CheckCircle, ShieldAlert, Sparkles, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function IntelligenceBrowse() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const params = { search: search || undefined, status: status ?? undefined, limit: 24 };
  const { data: pageData, isLoading } = useListIntelligenceRecords(
    params,
    { query: { enabled: true, queryKey: getListIntelligenceRecordsQueryKey(params) } }
  );

  const records = pageData?.items ?? [];
  const total = pageData?.total ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" /> Intelligence Dataset
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {total} expert-verified records for AI training
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/intelligence/analytics">
            <Button variant="outline" size="sm">Analytics</Button>
          </Link>
          <Link href="/intelligence/review">
            <Button variant="outline" size="sm">Review Queue</Button>
          </Link>
          <Link href="/intelligence/contribute">
            <Button size="sm">Contribute</Button>
          </Link>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search records..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
              onClick={() => setSearch("")}>
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button 
            variant={status === null ? "default" : "outline"} 
            onClick={() => setStatus(null)}
          >All</Button>
          <Button 
            variant={status === "verified" ? "default" : "outline"} 
            onClick={() => setStatus("verified")}
          >Verified</Button>
          <Button 
            variant={status === "pending" ? "default" : "outline"} 
            onClick={() => setStatus("pending")}
          >Pending</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}
        </div>
      ) : records.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center text-muted-foreground">
            <Brain className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No records found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {records.map(record => (
            <div key={record.id} className="group rounded-lg overflow-hidden border border-border bg-card hover:border-primary/50 transition-colors">
              <div className="aspect-square relative overflow-hidden bg-muted">
                <img
                  src={record.thumbnailUrl || record.imageUrl}
                  alt="Intelligence record"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="absolute top-2 right-2">
                  {record.approvedForTraining && (
                    <Badge className="bg-emerald-500/90 hover:bg-emerald-500/90 text-white border-0 shadow-sm flex items-center gap-1.5 h-6">
                      <Sparkles className="h-3 w-3" />
                      <span className="text-[10px] font-semibold tracking-wide uppercase">Training</span>
                    </Badge>
                  )}
                </div>
              </div>
              <div className="p-2.5 space-y-1">
                <p className="text-xs font-semibold truncate text-foreground">
                  {record.category || record.aiPrediction?.category || "Unknown"}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {record.subcategory || record.aiPrediction?.subcategory || "No subcategory"}
                </p>
                <div className="flex items-center justify-between pt-1">
                  <Badge variant={record.status === "verified" ? "default" : "outline"} className="text-[9px] px-1.5 py-0.5">
                    {record.status}
                  </Badge>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-0.5"><CheckCircle className="w-3 h-3 text-emerald-400" />{record.confirmVotes}</span>
                    <span className="flex items-center gap-0.5"><ShieldAlert className="w-3 h-3 text-red-400" />{record.disputeVotes}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
