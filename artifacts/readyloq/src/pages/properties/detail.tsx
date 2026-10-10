import { useState } from "react";
import { Link, useParams } from "wouter";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPropertyFeed,
  useUpdatePropertyProfile,
  useAddPropertyNote,
  getGetPropertyFeedQueryKey,
  getListPropertiesQueryKey,
} from "@workspace/api-client-react";
import type { Hotspot } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Building2, Pencil, Plus, Trash2, Loader2, Send,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PropertyFeedSections, PROPERTY_TYPES } from "@/components/property-intel";

export default function PropertyDetail() {
  const params = useParams<{ addressKey: string }>();
  const addressKey = params.addressKey;
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: feed, isLoading } = useGetPropertyFeed(addressKey);
  const updateProfile = useUpdatePropertyProfile();
  const addNote = useAddPropertyNote();

  const [editOpen, setEditOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);

  const [noteText, setNoteText] = useState("");
  const [noteZone, setNoteZone] = useState("");
  const [noteCategory, setNoteCategory] = useState("");

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getGetPropertyFeedQueryKey(addressKey) });
    queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
  }

  function openEdit() {
    if (!feed) return;
    setClientName(feed.clientName ?? "");
    setPropertyType(feed.propertyType || PROPERTY_TYPES[0]);
    setKnowledge(feed.technicianKnowledge ?? "");
    setHotspots(feed.hotspots.map((h) => ({ ...h })));
    setEditOpen(true);
  }

  async function saveProfile() {
    try {
      await updateProfile.mutateAsync({
        addressKey,
        data: {
          clientName: clientName.trim() || undefined,
          propertyType: propertyType || undefined,
          technicianKnowledge: knowledge.trim() || undefined,
          hotspots: hotspots
            .filter((h) => h.zone.trim() && h.description.trim())
            .map((h) => ({ zone: h.zone.trim(), description: h.description.trim(), severity: h.severity || "medium" })),
        },
      });
      invalidate();
      setEditOpen(false);
      toast({ title: "Profile saved", description: "Property intelligence updated." });
    } catch {
      toast({ title: "Error", description: "Failed to save profile.", variant: "destructive" });
    }
  }

  async function submitNote() {
    if (!noteText.trim()) return;
    try {
      await addNote.mutateAsync({
        addressKey,
        data: {
          note: noteText.trim(),
          zone: noteZone.trim() || undefined,
          category: noteCategory.trim() || undefined,
          authorName: user?.fullName || undefined,
        },
      });
      invalidate();
      setNoteText("");
      setNoteZone("");
      setNoteCategory("");
      toast({ title: "Note added", description: "Your field note is now on this property." });
    } catch {
      toast({ title: "Error", description: "Failed to add note.", variant: "destructive" });
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!feed) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <Building2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="font-medium">Property not found</p>
        <Link href="/properties">
          <Button variant="ghost" className="mt-3">Back to properties</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Link href="/properties">
        <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Properties
        </button>
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary shrink-0" />
            <span className="truncate">{feed.siteAddress}</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {feed.clientName ? `${feed.clientName} · ` : ""}{feed.propertyType}
            {feed.visitHistory.length > 0 && ` · ${feed.visitHistory.length} visit${feed.visitHistory.length === 1 ? "" : "s"}`}
          </p>
        </div>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={openEdit}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit property intelligence</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-1">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Client</p>
                <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client name" className="bg-card border-border/60" />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Property type</p>
                <Select value={propertyType} onValueChange={setPropertyType}>
                  <SelectTrigger className="bg-card border-border/60"><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {PROPERTY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Technician knowledge</p>
                <Textarea
                  value={knowledge}
                  onChange={(e) => setKnowledge(e.target.value)}
                  placeholder="Access notes, gate codes, pet warnings, recurring problem areas…"
                  rows={4}
                  className="bg-card border-border/60 resize-none"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Hotspots</p>
                  <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-primary"
                    onClick={() => setHotspots((h) => [...h, { zone: "", description: "", severity: "medium" }])}>
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </div>
                <div className="space-y-2">
                  {hotspots.length === 0 && (
                    <p className="text-xs text-muted-foreground/60 italic">No hotspots yet.</p>
                  )}
                  {hotspots.map((h, i) => (
                    <div key={i} className="rounded-lg border border-border/50 bg-card/60 p-2.5 space-y-2">
                      <div className="flex items-center gap-2">
                        <Input value={h.zone} placeholder="Zone (e.g. Kitchen)"
                          onChange={(e) => setHotspots((arr) => arr.map((x, j) => j === i ? { ...x, zone: e.target.value } : x))}
                          className="bg-card border-border/60 h-9 text-sm" />
                        <Select value={h.severity || "medium"}
                          onValueChange={(v) => setHotspots((arr) => arr.map((x, j) => j === i ? { ...x, severity: v as Hotspot["severity"] } : x))}>
                          <SelectTrigger className="bg-card border-border/60 h-9 w-32 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["low", "medium", "high"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-red-400 shrink-0"
                          onClick={() => setHotspots((arr) => arr.filter((_, j) => j !== i))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <Input value={h.description} placeholder="What to watch for here"
                        onChange={(e) => setHotspots((arr) => arr.map((x, j) => j === i ? { ...x, description: e.target.value } : x))}
                        className="bg-card border-border/60 h-9 text-sm" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button onClick={saveProfile} disabled={updateProfile.isPending} className="gap-1.5">
                {updateProfile.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Add field note */}
      <div className="rounded-2xl border border-border/60 bg-card/60 p-4 space-y-2.5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Add field note</p>
        <Textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Observation, access change, customer request…"
          rows={2}
          className="bg-card border-border/60 resize-none"
        />
        <div className="flex items-center gap-2">
          <Input value={noteZone} onChange={(e) => setNoteZone(e.target.value)} placeholder="Zone (optional)" className="bg-card border-border/60 h-9 text-sm" />
          <Input value={noteCategory} onChange={(e) => setNoteCategory(e.target.value)} placeholder="Category (optional)" className="bg-card border-border/60 h-9 text-sm" />
          <Button onClick={submitNote} disabled={!noteText.trim() || addNote.isPending} size="sm" className="shrink-0 gap-1.5 h-9">
            {addNote.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Post
          </Button>
        </div>
      </div>

      <PropertyFeedSections feed={feed} />
    </div>
  );
}
