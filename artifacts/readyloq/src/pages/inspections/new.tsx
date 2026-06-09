import { useState } from "react";
import { useLocation } from "wouter";
import { useCreateInspection, useAddInspectionMedia } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Upload, Camera, Mic, Video, X, CheckCircle2, Plus } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

const PEST_TYPES = ["Rodents", "Cockroaches", "Ants", "Termites", "Bed Bugs", "Flies", "Mosquitoes", "Spiders", "Fleas", "Wildlife"];

interface UploadedMedia {
  id: string;
  type: "photo" | "video" | "voice";
  name: string;
  url: string;
}

export default function NewInspection() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const createInspection = useCreateInspection();
  const addMedia = useAddInspectionMedia();

  const [step, setStep] = useState<"form" | "media">("form");
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [form, setForm] = useState({
    siteAddress: "",
    clientName: "",
    technicianName: "",
    notes: "",
    pestTypes: [] as string[],
  });
  const [uploadedMedia, setUploadedMedia] = useState<UploadedMedia[]>([]);

  const togglePest = (pest: string) => {
    setForm(f => ({
      ...f,
      pestTypes: f.pestTypes.includes(pest) ? f.pestTypes.filter(p => p !== pest) : [...f.pestTypes, pest],
    }));
  };

  const handleCreate = async () => {
    if (!form.siteAddress || !form.technicianName) {
      toast({ title: "Required fields missing", description: "Site address and technician name are required.", variant: "destructive" });
      return;
    }
    try {
      const result = await createInspection.mutateAsync({ data: form });
      setCreatedId(result.id);
      setStep("media");
      toast({ title: "Inspection created", description: "Now add photos, videos, or voice notes." });
    } catch {
      toast({ title: "Error", description: "Failed to create inspection.", variant: "destructive" });
    }
  };

  const simulateUpload = (type: "photo" | "video" | "voice") => {
    const seeds = ["pest1", "pest2", "pest3", "rat1", "bug1", "termite1", "cockroach1", "ant1"];
    const seed = seeds[Math.floor(Math.random() * seeds.length)];
    const media: UploadedMedia = {
      id: `${Date.now()}`,
      type,
      name: type === "voice" ? `Voice note ${uploadedMedia.length + 1}.m4a` : type === "video" ? `Video ${uploadedMedia.length + 1}.mp4` : `Photo ${uploadedMedia.length + 1}.jpg`,
      url: `https://picsum.photos/seed/${seed}/400/300`,
    };
    setUploadedMedia(prev => [...prev, media]);
    if (createdId) {
      addMedia.mutate({
        id: createdId,
        data: {
          mediaType: type,
          url: media.url,
          filename: media.name,
          durationSec: type === "voice" ? 15 : type === "video" ? 45 : undefined,
        },
      });
    }
    toast({ title: "Media added", description: `${media.name} uploaded successfully.` });
  };

  if (step === "media") {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/inspections">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Add Media</h1>
            <p className="text-muted-foreground text-sm">Upload photos, videos, and voice notes for the inspection</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Capture Evidence</CardTitle>
            <CardDescription>Add visual and audio evidence from the field</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Button variant="outline" className="h-20 flex flex-col gap-2 border-dashed" onClick={() => simulateUpload("photo")}>
                <Camera className="h-6 w-6 text-primary" />
                <span className="text-xs">Add Photo</span>
              </Button>
              <Button variant="outline" className="h-20 flex flex-col gap-2 border-dashed" onClick={() => simulateUpload("video")}>
                <Video className="h-6 w-6 text-amber-500" />
                <span className="text-xs">Add Video</span>
              </Button>
              <Button variant="outline" className="h-20 flex flex-col gap-2 border-dashed" onClick={() => simulateUpload("voice")}>
                <Mic className="h-6 w-6 text-emerald-500" />
                <span className="text-xs">Voice Note</span>
              </Button>
            </div>
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
              <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Or drag and drop files here</p>
              <Button variant="ghost" size="sm" className="mt-2 text-primary" onClick={() => simulateUpload("photo")}>Browse Files</Button>
            </div>
          </CardContent>
        </Card>

        {uploadedMedia.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Uploaded Media ({uploadedMedia.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {uploadedMedia.map(m => (
                  <div key={m.id} className="relative group rounded-lg overflow-hidden border border-border bg-muted/30">
                    {m.type === "photo" && <img src={m.url} alt={m.name} className="w-full h-24 object-cover" />}
                    {m.type === "video" && (
                      <div className="w-full h-24 flex items-center justify-center bg-slate-800">
                        <Video className="h-8 w-8 text-amber-400" />
                      </div>
                    )}
                    {m.type === "voice" && (
                      <div className="w-full h-24 flex items-center justify-center bg-emerald-950/30">
                        <Mic className="h-8 w-8 text-emerald-400" />
                      </div>
                    )}
                    <div className="p-2">
                      <p className="text-[10px] text-muted-foreground truncate">{m.name}</p>
                    </div>
                    <Button
                      variant="ghost" size="icon"
                      className="absolute top-1 right-1 h-6 w-6 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => setUploadedMedia(prev => prev.filter(x => x.id !== m.id))}
                    >
                      <X className="h-3 w-3 text-white" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => navigate(`/inspections/${createdId}`)}>
            Skip for now
          </Button>
          <Button className="flex-1" onClick={() => navigate(`/inspections/${createdId}`)}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Complete Inspection
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/inspections">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">New Inspection</h1>
          <p className="text-muted-foreground text-sm">Start a new field inspection</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Site Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Site Address <span className="text-destructive">*</span></Label>
            <Input placeholder="123 Main St, City, State" value={form.siteAddress} onChange={e => setForm(f => ({ ...f, siteAddress: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Client Name</Label>
            <Input placeholder="Client or business name" value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Technician Name <span className="text-destructive">*</span></Label>
            <Input placeholder="Assigned technician" value={form.technicianName} onChange={e => setForm(f => ({ ...f, technicianName: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea placeholder="Initial observations, access notes, etc." rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pest Types Observed</CardTitle>
          <CardDescription>Select all that apply</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {PEST_TYPES.map(pest => (
              <button key={pest} onClick={() => togglePest(pest)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  form.pestTypes.includes(pest)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-transparent text-muted-foreground border-border hover:border-primary hover:text-primary"
                }`}>
                {pest}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Button className="w-full" size="lg" disabled={createInspection.isPending} onClick={handleCreate}>
        {createInspection.isPending ? "Creating..." : "Create Inspection & Add Media"}
        <Plus className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
