import { useEffect, useRef, useState } from "react";
import {
  useListBrandingProfiles,
  useCreateBrandingProfile,
  useUpdateBrandingProfile,
  useDeleteBrandingProfile,
  useDuplicateBrandingProfile,
  useActivateBrandingProfile,
  useRestoreBrandingDefaults,
  getGetActiveBrandingQueryKey,
  getGetBrandingQueryKey,
  getListBrandingProfilesQueryKey,
  type BrandingProfile,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Palette,
  Plus,
  Upload,
  MoreVertical,
  CheckCircle2,
  Copy,
  Trash2,
  Pencil,
  Download,
  Eye,
  EyeOff,
  Save,
  RotateCcw,
  Undo2,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useBrandingPreview } from "@/components/branding-provider";
import { uploadBrandAsset } from "@/lib/branding-upload";
import { ProfileEditor } from "./profile-editor";
import { BrandPreview } from "./brand-preview";
import { ImageCropper } from "./image-cropper";
import {
  profileToDraft,
  draftToInput,
  draftToProfile,
  draftKey,
  profileToExport,
  importToInput,
  type BrandingDraft,
} from "./profile-draft";

export function WhiteLabelManager() {
  const { data: profiles, isLoading } = useListBrandingProfiles();
  const createMut = useCreateBrandingProfile();
  const updateMut = useUpdateBrandingProfile();
  const deleteMut = useDeleteBrandingProfile();
  const duplicateMut = useDuplicateBrandingProfile();
  const activateMut = useActivateBrandingProfile();
  const restoreMut = useRestoreBrandingDefaults();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const setPreview = useBrandingPreview();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<BrandingDraft | null>(null);
  const [savedKey, setSavedKey] = useState("");
  const [previewLive, setPreviewLive] = useState(false);

  const [cropTarget, setCropTarget] = useState<"logo" | "icon" | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<BrandingProfile | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const activeProfile = profiles?.find((p) => p.isActive) ?? null;
  const selectedProfile = profiles?.find((p) => p.id === selectedId) ?? null;
  const isDirty = !!draft && draftKey(draft) !== savedKey;

  const invalidateBranding = () => {
    queryClient.invalidateQueries({ queryKey: getGetActiveBrandingQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetBrandingQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListBrandingProfilesQueryKey() });
  };

  // Live preview: drive the whole-app document branding through the provider so
  // an active-profile refetch can never overwrite the in-progress preview.
  useEffect(() => {
    if (previewLive && draft && activeProfile) {
      setPreview(draftToProfile(draft, activeProfile));
    } else {
      setPreview(null);
    }
  }, [previewLive, draft, activeProfile, setPreview]);

  // Always restore the active branding when leaving the manager.
  useEffect(() => () => setPreview(null), [setPreview]);

  const loadProfile = (p: BrandingProfile) => {
    const d = profileToDraft(p);
    setSelectedId(p.id);
    setDraft(d);
    setSavedKey(draftKey(d));
    setPreviewLive(false);
  };

  const patchDraft = (patch: Partial<BrandingDraft>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  const handleNew = async () => {
    try {
      const created = await createMut.mutateAsync({
        data: { name: "New Profile", companyName: "New Company", poweredByVisible: true },
      });
      invalidateBranding();
      loadProfile(created);
      toast({ title: "Profile created", description: "Customize and publish your new brand profile." });
    } catch {
      toast({ title: "Error", description: "Could not create profile.", variant: "destructive" });
    }
  };

  const handleDuplicate = async (p: BrandingProfile) => {
    try {
      const dup = await duplicateMut.mutateAsync({ id: p.id });
      invalidateBranding();
      loadProfile(dup);
      toast({ title: "Profile duplicated", description: `Copied “${p.name}”.` });
    } catch {
      toast({ title: "Error", description: "Could not duplicate profile.", variant: "destructive" });
    }
  };

  const handleActivate = async (p: BrandingProfile) => {
    try {
      setPreviewLive(false);
      await activateMut.mutateAsync({ id: p.id });
      invalidateBranding();
      toast({ title: "Brand activated", description: `“${p.name}” is now live across the app.` });
    } catch {
      toast({ title: "Error", description: "Could not activate profile.", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync({ id: deleteTarget.id });
      invalidateBranding();
      if (selectedId === deleteTarget.id) {
        setSelectedId(null);
        setDraft(null);
      }
      toast({ title: "Profile deleted", description: `Removed “${deleteTarget.name}”.` });
    } catch {
      toast({ title: "Error", description: "Could not delete profile.", variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  };

  const handlePublish = async () => {
    if (!selectedId || !draft) return;
    try {
      await updateMut.mutateAsync({ id: selectedId, data: draftToInput(draft) });
      invalidateBranding();
      setSavedKey(draftKey(draft));
      toast({
        title: "Changes published",
        description: selectedProfile?.isActive
          ? "Live branding updated."
          : "Saved. Activate this profile to make it live.",
      });
    } catch {
      toast({ title: "Error", description: "Could not publish changes.", variant: "destructive" });
    }
  };

  const handleRevert = () => {
    if (selectedProfile) loadProfile(selectedProfile);
  };

  const handleRestoreDefaults = async () => {
    try {
      const restored = await restoreMut.mutateAsync();
      invalidateBranding();
      if (selectedProfile?.isDefault) loadProfile(restored);
      toast({ title: "Defaults restored", description: "ReadyLoq default branding has been reset." });
    } catch {
      toast({ title: "Error", description: "Could not restore defaults.", variant: "destructive" });
    } finally {
      setRestoreOpen(false);
    }
  };

  const handleExport = (p: BrandingProfile) => {
    const blob = new Blob([JSON.stringify(profileToExport(p), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-branding.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const input = importToInput(JSON.parse(text));
      const created = await createMut.mutateAsync({ data: input });
      invalidateBranding();
      loadProfile(created);
      toast({ title: "Profile imported", description: `Imported “${created.name}”.` });
    } catch (e) {
      toast({
        title: "Import failed",
        description: e instanceof Error ? e.message : "Invalid file.",
        variant: "destructive",
      });
    }
  };

  const openPicker = (target: "logo" | "icon") => {
    setCropTarget(target);
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
      imageInputRef.current.click();
    }
  };

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropSrc(URL.createObjectURL(file));
  };

  const onCropped = async (blob: Blob) => {
    const target = cropTarget;
    if (!target) return;
    const setUploading = target === "logo" ? setUploadingLogo : setUploadingIcon;
    setUploading(true);
    try {
      const url = await uploadBrandAsset(blob, `${target}-${Date.now()}.png`);
      patchDraft(target === "logo" ? { logoUrl: url } : { appIconUrl: url });
      toast({ title: "Image uploaded", description: `${target === "logo" ? "Logo" : "App icon"} updated.` });
      closeCropper();
    } catch {
      toast({ title: "Upload failed", description: "Could not upload image.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const closeCropper = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
    setCropTarget(null);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Palette className="h-5 w-5" /> White Label Manager
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Save multiple brand profiles and switch the entire app instantly — no code changes.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => importInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Import
          </Button>
          <Button size="sm" onClick={handleNew} disabled={createMut.isPending}>
            <Plus className="h-3.5 w-3.5" /> New Profile
          </Button>
        </div>
      </div>

      {/* Profile list */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(profiles ?? []).map((p) => {
          const isSelected = p.id === selectedId;
          return (
            <Card
              key={p.id}
              className={`overflow-hidden cursor-pointer transition-shadow hover:shadow-md ${
                isSelected ? "ring-2 ring-primary" : ""
              }`}
              onClick={() => loadProfile(p)}
            >
              <div className="h-1.5 flex">
                <div className="flex-1" style={{ background: p.primaryColor ?? "#0ea5e9" }} />
                <div className="w-1/4" style={{ background: p.accentColor ?? "#06b6d4" }} />
              </div>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.companyName}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem onClick={() => loadProfile(p)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </DropdownMenuItem>
                      {!p.isActive && (
                        <DropdownMenuItem onClick={() => handleActivate(p)}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Set Active
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => handleDuplicate(p)}>
                        <Copy className="h-3.5 w-3.5" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleExport(p)}>
                        <Download className="h-3.5 w-3.5" /> Export JSON
                      </DropdownMenuItem>
                      {!p.isDefault && !p.isActive && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget(p)}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex items-center gap-1.5 mt-3">
                  {p.isActive && (
                    <Badge className="gap-1 text-[10px]">
                      <CheckCircle2 className="h-3 w-3" /> Active
                    </Badge>
                  )}
                  {p.isDefault && (
                    <Badge variant="secondary" className="text-[10px]">
                      Default
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Editor + preview */}
      {selectedProfile && draft ? (
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between gap-3 flex-wrap border-t border-border pt-5">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">Editing: {selectedProfile.name}</h3>
              {isDirty && (
                <Badge variant="secondary" className="text-[10px]">
                  Unsaved changes
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant={previewLive ? "default" : "outline"}
                size="sm"
                onClick={() => setPreviewLive((v) => !v)}
              >
                {previewLive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {previewLive ? "Stop Live Preview" : "Live Preview"}
              </Button>
              {selectedProfile.isDefault && (
                <Button variant="outline" size="sm" onClick={() => setRestoreOpen(true)}>
                  <RotateCcw className="h-3.5 w-3.5" /> Restore Defaults
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleRevert} disabled={!isDirty}>
                <Undo2 className="h-3.5 w-3.5" /> Revert
              </Button>
              <Button size="sm" onClick={handlePublish} disabled={!isDirty || updateMut.isPending}>
                {updateMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Publish
              </Button>
            </div>
          </div>

          {previewLive && (
            <p className="text-xs text-primary flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" /> Live preview is applied to the whole app. Use “Revert” or
              “Stop Live Preview” to restore the active brand.
            </p>
          )}

          <div className="grid lg:grid-cols-2 gap-6 items-start">
            <ProfileEditor
              draft={draft}
              onChange={patchDraft}
              onPickLogo={() => openPicker("logo")}
              onPickIcon={() => openPicker("icon")}
              uploadingLogo={uploadingLogo}
              uploadingIcon={uploadingIcon}
            />
            <div className="lg:sticky lg:top-4 space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Live Preview
              </h3>
              <BrandPreview draft={draft} />
            </div>
          </div>
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Select a profile above to edit, or create a new one to get started.
          </CardContent>
        </Card>
      )}

      {/* Hidden inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChosen}
      />
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImportFile(f);
          e.target.value = "";
        }}
      />

      <ImageCropper
        open={!!cropSrc}
        onOpenChange={(o) => {
          if (!o) closeCropper();
        }}
        src={cropSrc}
        aspect={cropTarget === "icon" ? 1 : undefined}
        title={cropTarget === "icon" ? "Crop app icon" : "Crop logo"}
        description={
          cropTarget === "icon"
            ? "Square crop used as the favicon and compact mark."
            : "Crop your logo. Transparent PNGs work best."
        }
        busy={uploadingLogo || uploadingIcon}
        onCropped={onCropped}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the branding profile. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore ReadyLoq defaults?</AlertDialogTitle>
            <AlertDialogDescription>
              This resets the default profile’s name, colors, logo, and report settings back to the
              original ReadyLoq branding.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestoreDefaults}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
