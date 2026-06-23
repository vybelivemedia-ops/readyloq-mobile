import { useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useCreateIntelligenceRecord, 
  useConfirmIntelligenceRecord,
  useSkipIntelligenceRecord,
  useListIntelligenceCategories,
  IntelligenceConfirmInputSeverity,
  IntelligenceConfirmInputTreatmentOutcome,
  getListIntelligenceRecordsQueryKey,
  getGetIntelligenceAnalyticsQueryKey
} from "@workspace/api-client-react";
import { uploadIntelligenceImage } from "@/lib/intelligence-upload";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Camera, Brain, ArrowRight, X, Loader2, Sparkles } from "lucide-react";

export default function IntelligenceContribute() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [recordId, setRecordId] = useState<number | null>(null);
  const [aiPrediction, setAiPrediction] = useState<any>(null);
  
  const createRecord = useCreateIntelligenceRecord();
  const confirmRecord = useConfirmIntelligenceRecord();
  const skipRecord = useSkipIntelligenceRecord();
  const { data: categories } = useListIntelligenceCategories();
  const queryClient = useQueryClient();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    category: "",
    subcategory: "",
    severity: "low" as IntelligenceConfirmInputSeverity,
    treatmentOutcome: "pending" as IntelligenceConfirmInputTreatmentOutcome,
    whatIsShown: "",
    possiblePest: "",
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setPreviewUrl(URL.createObjectURL(selected));
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    try {
      const url = await uploadIntelligenceImage(file, file.name);
      const record = await createRecord.mutateAsync({ data: { imageUrl: url, thumbnailUrl: url } });
      setRecordId(record.id);
      setAiPrediction(record.aiPrediction);
      setFormData({
        category: record.aiPrediction.category || "",
        subcategory: record.aiPrediction.subcategory || "",
        severity: "moderate",
        treatmentOutcome: "pending",
        whatIsShown: record.aiPrediction.rationale || "",
        possiblePest: record.aiPrediction.possiblePest || "",
      });
      toast({ title: "Image uploaded", description: "AI has processed the image." });
    } catch (err) {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!recordId) return;
    try {
      await confirmRecord.mutateAsync({ 
        id: recordId, 
        data: {
          category: formData.category,
          subcategory: formData.subcategory,
          severity: formData.severity,
          treatmentOutcome: formData.treatmentOutcome,
          whatIsShown: formData.whatIsShown,
          possiblePest: formData.possiblePest,
        } 
      });
      queryClient.invalidateQueries({ queryKey: getListIntelligenceRecordsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetIntelligenceAnalyticsQueryKey() });
      toast({ title: "Record confirmed!" });
      setLocation("/intelligence");
    } catch (err) {
      toast({ title: "Failed to confirm", variant: "destructive" });
    }
  };

  const handleSkip = async () => {
    if (!recordId) return;
    try {
      await skipRecord.mutateAsync({ id: recordId });
      queryClient.invalidateQueries({ queryKey: getListIntelligenceRecordsQueryKey() });
      toast({ title: "Record skipped" });
      setLocation("/intelligence");
    } catch (err) {
      toast({ title: "Failed to skip", variant: "destructive" });
    }
  };

  if (recordId && aiPrediction) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Brain className="h-6 w-6 text-primary" /> Review AI Suggestion
        </h1>
        
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="rounded-lg overflow-hidden border border-border bg-muted">
              {previewUrl && <img src={previewUrl} className="w-full object-contain" alt="Preview" />}
            </div>
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-2 text-primary font-medium">
                  <Sparkles className="h-4 w-4" /> AI Prediction
                </div>
                <div className="space-y-2 text-sm">
                  <p><span className="text-muted-foreground">Category:</span> {aiPrediction.category || "Unknown"}</p>
                  <p><span className="text-muted-foreground">Subcategory:</span> {aiPrediction.subcategory || "Unknown"}</p>
                  <p><span className="text-muted-foreground">Confidence:</span> {((aiPrediction.confidence || 0) * 100).toFixed(0)}%</p>
                  {aiPrediction.rationale && <p><span className="text-muted-foreground">Rationale:</span> {aiPrediction.rationale}</p>}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Confirm or Correct</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Input 
                    value={formData.category} 
                    onChange={e => setFormData({...formData, category: e.target.value})} 
                  />
                </div>
                <div className="space-y-2">
                  <Label>Subcategory</Label>
                  <Input 
                    value={formData.subcategory} 
                    onChange={e => setFormData({...formData, subcategory: e.target.value})} 
                  />
                </div>
                <div className="space-y-2">
                  <Label>Possible Pest</Label>
                  <Input 
                    value={formData.possiblePest} 
                    onChange={e => setFormData({...formData, possiblePest: e.target.value})} 
                  />
                </div>
                <div className="space-y-2">
                  <Label>Severity</Label>
                  <Select value={formData.severity} onValueChange={(v: any) => setFormData({...formData, severity: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="moderate">Moderate</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>What is shown?</Label>
                  <Textarea 
                    value={formData.whatIsShown} 
                    onChange={e => setFormData({...formData, whatIsShown: e.target.value})} 
                  />
                </div>

                <div className="flex gap-2 pt-4">
                  <Button variant="outline" className="flex-1" onClick={handleSkip}>
                    Skip Unusable
                  </Button>
                  <Button className="flex-1" onClick={handleConfirm} disabled={confirmRecord.isPending}>
                    {confirmRecord.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Save to Dataset
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto space-y-6 mt-8">
      <div className="text-center space-y-2">
        <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <Camera className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-2xl font-bold">Contribute to Intelligence</h1>
        <p className="text-muted-foreground text-sm">Upload a field photo. Our AI will analyze it, and you'll confirm or correct the result.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {!file ? (
            <div 
              className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium">Tap to take or select a photo</p>
              <p className="text-xs text-muted-foreground mt-1">JPEG, PNG up to 10MB</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative rounded-lg overflow-hidden border border-border">
                {previewUrl && <img src={previewUrl} className="w-full h-64 object-cover" alt="Preview" />}
                <Button 
                  size="icon" 
                  variant="destructive" 
                  className="absolute top-2 right-2 h-8 w-8 rounded-full"
                  onClick={() => { setFile(null); setPreviewUrl(null); }}
                  disabled={isUploading}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <Button 
                className="w-full" 
                size="lg" 
                onClick={handleUpload} 
                disabled={isUploading}
              >
                {isUploading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing with AI...</>
                ) : (
                  <><Brain className="w-4 h-4 mr-2" /> Analyze Photo <ArrowRight className="w-4 h-4 ml-2" /></>
                )}
              </Button>
            </div>
          )}
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/*" 
            capture="environment"
            onChange={handleFileChange}
          />
        </CardContent>
      </Card>
    </div>
  );
}
