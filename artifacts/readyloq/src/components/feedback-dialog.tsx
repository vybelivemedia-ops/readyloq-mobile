import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSubmitFeedback,
  getListFeedbackQueryKey,
  SubmitFeedbackInputType,
  SubmitFeedbackInputSeverity,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const TYPE_OPTIONS: { value: SubmitFeedbackInputType; label: string }[] = [
  { value: SubmitFeedbackInputType.bug, label: "Bug — something is broken" },
  { value: SubmitFeedbackInputType.feature, label: "Feature — an idea or request" },
  { value: SubmitFeedbackInputType.ai_accuracy, label: "AI accuracy — wrong or poor analysis" },
];

const SEVERITY_OPTIONS: { value: SubmitFeedbackInputSeverity; label: string }[] = [
  { value: SubmitFeedbackInputSeverity.low, label: "Low" },
  { value: SubmitFeedbackInputSeverity.medium, label: "Medium" },
  { value: SubmitFeedbackInputSeverity.high, label: "High" },
];

/**
 * Beta feedback capture, available to EVERY signed-in company member (technicians
 * included) from the global layout. Submission is intentionally allowed even for
 * technicians whose beta data access has been paused, so they can still tell us
 * why something went wrong.
 */
export function FeedbackDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const submit = useSubmitFeedback();

  const [type, setType] = useState<SubmitFeedbackInputType>(SubmitFeedbackInputType.bug);
  const [severity, setSeverity] = useState<SubmitFeedbackInputSeverity>(
    SubmitFeedbackInputSeverity.medium,
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const reset = () => {
    setType(SubmitFeedbackInputType.bug);
    setSeverity(SubmitFeedbackInputSeverity.medium);
    setTitle("");
    setDescription("");
  };

  const canSubmit = title.trim().length > 0 && description.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await submit.mutateAsync({
        data: {
          type,
          severity,
          title: title.trim(),
          description: description.trim(),
        },
      });
      toast({ title: "Feedback sent", description: "Thanks — your team can see it in the Beta Center." });
      queryClient.invalidateQueries({ queryKey: getListFeedbackQueryKey() });
      reset();
      onOpenChange(false);
    } catch {
      toast({ title: "Couldn't send feedback", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquarePlus className="h-5 w-5 text-primary" />
            Send feedback
          </DialogTitle>
          <DialogDescription>
            Found a bug, have an idea, or noticed the AI got something wrong? Tell us.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as SubmitFeedbackInputType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Severity</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as SubmitFeedbackInputSeverity)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="feedback-title">Summary</Label>
            <Input
              id="feedback-title"
              placeholder="Short summary"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="feedback-description">Details</Label>
            <Textarea
              id="feedback-description"
              placeholder="What happened? What did you expect? Steps to reproduce help a lot."
              value={description}
              maxLength={5000}
              rows={5}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submit.isPending}>
            {submit.isPending ? "Sending…" : "Send feedback"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
