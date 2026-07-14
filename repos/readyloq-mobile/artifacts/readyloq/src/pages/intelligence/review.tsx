import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useListIntelligenceRecords, 
  useVoteIntelligenceRecord,
  useReviewIntelligenceRecord,
  IntelligenceVoteInputVote,
  IntelligenceReviewInputAction,
  getListIntelligenceRecordsQueryKey
} from "@workspace/api-client-react";
import { useCurrentUser, isManagerRole } from "@/hooks/use-current-user";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, ShieldAlert, Check, X, UserCog, Loader2 } from "lucide-react";

export default function IntelligenceReview() {
  const { toast } = useToast();
  const { data: currentUser } = useCurrentUser();
  const isManager = isManagerRole(currentUser?.role);

  const reviewParams = { status: "pending", limit: 50 };
  const { data: pageData, isLoading, refetch } = useListIntelligenceRecords(
    reviewParams,
    { query: { enabled: true, queryKey: getListIntelligenceRecordsQueryKey(reviewParams) } }
  );

  const voteRecord = useVoteIntelligenceRecord();
  const reviewRecord = useReviewIntelligenceRecord();
  const queryClient = useQueryClient();

  const records = pageData?.items ?? [];

  const handleVote = async (id: number, vote: IntelligenceVoteInputVote) => {
    try {
      await voteRecord.mutateAsync({ id, data: { vote } });
      toast({ title: "Vote cast successfully" });
      queryClient.invalidateQueries({ queryKey: getListIntelligenceRecordsQueryKey() });
      refetch();
    } catch (e) {
      toast({ title: "Failed to vote", variant: "destructive" });
    }
  };

  const handleReview = async (id: number, action: IntelligenceReviewInputAction) => {
    try {
      await reviewRecord.mutateAsync({ id, data: { action } });
      toast({ title: `Record ${action}d successfully` });
      queryClient.invalidateQueries({ queryKey: getListIntelligenceRecordsQueryKey() });
      refetch();
    } catch (e) {
      toast({ title: "Review failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Review Queue</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {records.length} records awaiting verification.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-xl" />)}
        </div>
      ) : records.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center text-muted-foreground">
            <CheckCircle className="h-12 w-12 mx-auto mb-3 opacity-30 text-emerald-500" />
            <p className="font-medium text-lg">Queue is clear</p>
            <p className="text-sm mt-1">All pending records have been reviewed.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {records.map(record => (
            <Card key={record.id} className="overflow-hidden">
              <div className="flex flex-col md:flex-row">
                <div className="md:w-1/3 bg-muted">
                  <img 
                    src={record.imageUrl} 
                    alt="Intelligence" 
                    className="w-full h-full object-cover min-h-[240px]"
                  />
                </div>
                <div className="flex-1 p-5 md:p-6 flex flex-col">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline">{record.category}</Badge>
                        <Badge variant="secondary">{record.subcategory}</Badge>
                      </div>
                      <h3 className="text-lg font-semibold">{record.whatIsShown || "No description provided"}</h3>
                    </div>
                    <Badge variant="outline" className="shrink-0 bg-amber-500/10 text-amber-500 border-amber-500/20">Pending</Badge>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm mb-6">
                    <div>
                      <p className="text-muted-foreground">Severity</p>
                      <p className="font-medium capitalize">{record.severity || "Unknown"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Possible Pest</p>
                      <p className="font-medium">{record.possiblePest || "Unknown"}</p>
                    </div>
                  </div>

                  <div className="mt-auto pt-4 border-t flex flex-col sm:flex-row justify-between items-center gap-4">
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        variant={record.myVote === "confirm" ? "default" : "outline"}
                        className={record.myVote === "confirm" ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                        onClick={() => handleVote(record.id, "confirm")}
                      >
                        <CheckCircle className="w-4 h-4 mr-1.5" /> Confirm ({record.confirmVotes})
                      </Button>
                      <Button 
                        size="sm" 
                        variant={record.myVote === "dispute" ? "default" : "outline"}
                        className={record.myVote === "dispute" ? "bg-red-600 hover:bg-red-700" : ""}
                        onClick={() => handleVote(record.id, "dispute")}
                      >
                        <ShieldAlert className="w-4 h-4 mr-1.5" /> Dispute ({record.disputeVotes})
                      </Button>
                    </div>

                    {isManager && (
                      <div className="flex gap-2">
                        <Button 
                          size="sm" 
                          variant="destructive"
                          onClick={() => handleReview(record.id, "reject")}
                        >
                          <X className="w-4 h-4 mr-1.5" /> Reject
                        </Button>
                        <Button 
                          size="sm" 
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                          onClick={() => handleReview(record.id, "expert_verify")}
                        >
                          <UserCog className="w-4 h-4 mr-1.5" /> Expert Verify
                        </Button>
                        <Button 
                          size="sm" 
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={() => handleReview(record.id, "approve")}
                        >
                          <Check className="w-4 h-4 mr-1.5" /> Approve
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
