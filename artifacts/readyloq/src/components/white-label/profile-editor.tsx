import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Building2, Palette, FileText, Mail, ImageIcon, Upload, X, Loader2 } from "lucide-react";
import { brandLogoSrc, brandIconSrc } from "@/lib/branding";
import type { BrandingDraft } from "./profile-draft";

interface ProfileEditorProps {
  draft: BrandingDraft;
  onChange: (patch: Partial<BrandingDraft>) => void;
  onPickLogo: () => void;
  onPickIcon: () => void;
  uploadingLogo?: boolean;
  uploadingIcon?: boolean;
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={safe}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent shrink-0"
          aria-label={label}
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-sm"
          placeholder="#000000"
        />
      </div>
    </div>
  );
}

function AssetField({
  label,
  hint,
  src,
  uploading,
  onPick,
  onClear,
  rounded,
}: {
  label: string;
  hint: string;
  src: string | null;
  uploading?: boolean;
  onPick: () => void;
  onClear: () => void;
  rounded?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-3">
        <div
          className={`w-16 h-16 shrink-0 border border-border bg-muted/40 flex items-center justify-center overflow-hidden ${
            rounded ? "rounded-xl" : "rounded-lg"
          }`}
        >
          {src ? (
            <img src={src} alt={label} className="w-full h-full object-contain" />
          ) : (
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onPick} disabled={uploading}>
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {src ? "Replace" : "Upload"}
            </Button>
            {src && (
              <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={uploading}>
                <X className="h-3.5 w-3.5" /> Remove
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">{hint}</p>
        </div>
      </div>
    </div>
  );
}

export function ProfileEditor({
  draft,
  onChange,
  onPickLogo,
  onPickIcon,
  uploadingLogo,
  uploadingIcon,
}: ProfileEditorProps) {
  const set =
    (key: keyof BrandingDraft) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ [key]: e.target.value } as Partial<BrandingDraft>);

  const logoSrc = draft.logoUrl ? brandLogoSrc({ logoUrl: draft.logoUrl }) : null;
  const iconSrc = draft.appIconUrl
    ? brandIconSrc({ appIconUrl: draft.appIconUrl, logoUrl: null })
    : null;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Company Identity
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Profile Name</Label>
            <Input value={draft.name} onChange={set("name")} placeholder="e.g. Suburban Pest Control" />
            <p className="text-[11px] text-muted-foreground">Internal label for this saved profile.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Company Name</Label>
              <Input value={draft.companyName} onChange={set("companyName")} />
            </div>
            <div className="space-y-2">
              <Label>Tagline</Label>
              <Input value={draft.tagline} onChange={set("tagline")} placeholder="Your trusted partner" />
            </div>
            <div className="space-y-2">
              <Label>Website</Label>
              <Input value={draft.companyWebsite} onChange={set("companyWebsite")} placeholder="https://…" />
            </div>
            <div className="space-y-2">
              <Label>License Number</Label>
              <Input value={draft.licenseNumber} onChange={set("licenseNumber")} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={draft.companyPhone} onChange={set("companyPhone")} placeholder="(800) 555-1234" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={draft.companyEmail} onChange={set("companyEmail")} placeholder="hello@company.com" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Textarea value={draft.companyAddress} onChange={set("companyAddress")} rows={2} placeholder="Street, City, State ZIP" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Palette className="h-4 w-4" /> Visual Branding
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-5">
            <AssetField
              label="Logo"
              hint="Wide or square. Shown in nav, login & reports."
              src={logoSrc}
              uploading={uploadingLogo}
              onPick={onPickLogo}
              onClear={() => onChange({ logoUrl: "" })}
            />
            <AssetField
              label="App Icon"
              hint="Square. Used as favicon & compact mark."
              src={iconSrc}
              uploading={uploadingIcon}
              onPick={onPickIcon}
              onClear={() => onChange({ appIconUrl: "" })}
              rounded
            />
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <ColorField label="Primary" value={draft.primaryColor} onChange={(v) => onChange({ primaryColor: v })} />
            <ColorField label="Secondary" value={draft.secondaryColor} onChange={(v) => onChange({ secondaryColor: v })} />
            <ColorField label="Accent" value={draft.accentColor} onChange={(v) => onChange({ accentColor: v })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Report Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Report Footer Text</Label>
            <Input value={draft.reportFooterText} onChange={set("reportFooterText")} placeholder="Confidential Inspection Report" />
          </div>
          <div className="space-y-2">
            <Label>Support Info</Label>
            <Input value={draft.supportInfo} onChange={set("supportInfo")} placeholder="support@company.com · (800) 555-1234" />
          </div>
          <div className="space-y-2">
            <Label>Signature Disclaimer</Label>
            <Textarea value={draft.signatureDisclaimer} onChange={set("signatureDisclaimer")} rows={3} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Show “Powered by ReadyLoq”</p>
              <p className="text-xs text-muted-foreground mt-0.5">Attribution in app footer & reports.</p>
            </div>
            <Switch
              checked={draft.poweredByVisible}
              onCheckedChange={(v) => onChange({ poweredByVisible: v })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" /> Email Branding
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Sender Name</Label>
              <Input value={draft.emailSenderName} onChange={set("emailSenderName")} placeholder="Company Name" />
            </div>
            <div className="space-y-2">
              <Label>Reply-To</Label>
              <Input value={draft.emailReplyTo} onChange={set("emailReplyTo")} placeholder="reply@company.com" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Email Footer</Label>
            <Textarea value={draft.emailFooter} onChange={set("emailFooter")} rows={2} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
