import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Monitor, Smartphone, FileText } from "lucide-react";
import { brandLogoSrc, brandIconSrc, readableForeground } from "@/lib/branding";
import type { BrandingDraft } from "./profile-draft";

const NAV = ["Dashboard", "Inspections", "AI Analysis", "Reports"];

function Logo({ draft, size = 28 }: { draft: BrandingDraft; size?: number }) {
  const src = draft.logoUrl
    ? brandLogoSrc({ logoUrl: draft.logoUrl })
    : draft.appIconUrl
      ? brandIconSrc({ appIconUrl: draft.appIconUrl, logoUrl: null })
      : null;
  if (src) {
    return <img src={src} alt="" style={{ width: size, height: size }} className="object-contain rounded-md" />;
  }
  return (
    <div
      style={{ width: size, height: size, background: draft.primaryColor }}
      className="rounded-md flex items-center justify-center text-white text-xs font-bold"
    >
      {(draft.companyName || "C").charAt(0)}
    </div>
  );
}

function DesktopPreview({ draft }: { draft: BrandingDraft }) {
  const primary = draft.primaryColor;
  return (
    <div className="rounded-lg border border-border overflow-hidden bg-background shadow-sm">
      <div className="flex h-[320px]">
        <div className="w-44 shrink-0 border-r border-border bg-muted/30 p-3 flex flex-col gap-1">
          <div className="flex items-center gap-2 mb-3 px-1">
            <Logo draft={draft} />
            <div className="leading-tight">
              <p className="text-xs font-bold truncate">{draft.companyName || "Company"}</p>
              {draft.tagline && <p className="text-[9px] text-muted-foreground truncate">{draft.tagline}</p>}
            </div>
          </div>
          {NAV.map((item, i) => (
            <div
              key={item}
              className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-md"
              style={i === 0 ? { background: `${primary}1f`, color: primary } : {}}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: i === 0 ? primary : "hsl(var(--muted-foreground))" }}
              />
              <span className={i === 0 ? "font-medium" : "text-muted-foreground"}>{item}</span>
            </div>
          ))}
          {draft.poweredByVisible && (
            <p className="mt-auto text-center text-[8px] text-muted-foreground">Powered by ReadyLoq</p>
          )}
        </div>
        <div className="flex-1 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="h-5 w-28 rounded bg-muted" />
            <div
              className="h-7 px-3 rounded-md text-[10px] font-medium flex items-center"
              style={{ background: primary, color: readableForeground(primary) }}
            >
              New Inspection
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-lg border border-border p-2.5">
                <div className="h-4 w-10 rounded mb-2" style={{ background: i === 0 ? primary : draft.accentColor }} />
                <div className="h-2 w-full rounded bg-muted mb-1" />
                <div className="h-2 w-2/3 rounded bg-muted" />
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="h-2.5 w-1/3 rounded" style={{ background: primary }} />
            <div className="h-2 w-full rounded bg-muted" />
            <div className="h-2 w-5/6 rounded bg-muted" />
          </div>
        </div>
      </div>
    </div>
  );
}

function MobilePreview({ draft }: { draft: BrandingDraft }) {
  const primary = draft.primaryColor;
  return (
    <div className="flex justify-center">
      <div className="w-[210px] rounded-[1.6rem] border-4 border-foreground/15 overflow-hidden bg-background shadow-md">
        <div
          className="px-3 py-2 flex items-center gap-2"
          style={{ background: primary, color: readableForeground(primary) }}
        >
          <Logo draft={draft} size={20} />
          <p className="text-xs font-bold truncate">{draft.companyName || "Company"}</p>
        </div>
        <div className="p-3 space-y-2.5 h-[300px]">
          <div className="rounded-lg border border-border p-2.5 space-y-1.5">
            <div className="h-2.5 w-1/2 rounded" style={{ background: primary }} />
            <div className="h-2 w-full rounded bg-muted" />
            <div className="h-2 w-4/5 rounded bg-muted" />
          </div>
          {[0, 1].map((i) => (
            <div key={i} className="rounded-lg border border-border p-2.5 flex items-center gap-2">
              <div className="w-8 h-8 rounded-md" style={{ background: i === 0 ? `${primary}26` : `${draft.accentColor}26` }} />
              <div className="flex-1 space-y-1">
                <div className="h-2 w-2/3 rounded bg-muted" />
                <div className="h-2 w-1/2 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-border flex">
          {NAV.map((item, i) => (
            <div key={item} className="flex-1 flex flex-col items-center py-1.5 gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: i === 0 ? primary : "hsl(var(--muted-foreground))" }} />
              <span className="text-[7px]" style={{ color: i === 0 ? primary : undefined }}>
                {item.split(" ")[0]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PdfPreview({ draft }: { draft: BrandingDraft }) {
  const primary = draft.primaryColor;
  const onPrimary = readableForeground(primary);
  const logoSrc = draft.logoUrl
    ? brandLogoSrc({ logoUrl: draft.logoUrl })
    : draft.appIconUrl
      ? brandIconSrc({ appIconUrl: draft.appIconUrl, logoUrl: null })
      : null;
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {/* Cover */}
      <div className="rounded-lg overflow-hidden border border-border shadow-sm" style={{ background: "#0f172a" }}>
        <div style={{ height: 6, background: primary }} />
        <div className="p-4 text-white space-y-3 h-[300px] flex flex-col">
          <div className="space-y-1.5">
            {logoSrc ? (
              <img src={logoSrc} alt="" className="w-9 h-9 object-contain" />
            ) : (
              <div className="w-9 h-9 rounded-md flex items-center justify-center text-xs font-bold" style={{ background: primary, color: onPrimary }}>
                {(draft.companyName || "C").charAt(0)}
              </div>
            )}
            <p className="text-sm font-bold">{draft.companyName || "Company"}</p>
            {draft.tagline && <p className="text-[9px] text-slate-400">{draft.tagline}</p>}
          </div>
          <div style={{ height: 1, background: primary }} />
          <div>
            <p className="text-xs font-semibold">Pest Control Inspection Report</p>
            <p className="text-[9px] text-slate-400">123 Main St — Quarterly Service</p>
          </div>
          <div className="space-y-1 text-[8px]">
            {[
              ["REPORT", "RPT-0042"],
              ["TECHNICIAN", "Marcus Chen"],
              ["RISK LEVEL", "MEDIUM"],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <span className="text-slate-400 w-16">{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
          <p className="mt-auto text-[7px] text-slate-500">{draft.supportInfo || draft.companyEmail || ""}</p>
        </div>
      </div>

      {/* Inner page */}
      <div className="rounded-lg overflow-hidden border border-border bg-white shadow-sm">
        <div className="p-4 space-y-3 h-[300px] flex flex-col">
          <div className="rounded px-2.5 py-1.5 text-[10px] font-bold" style={{ background: primary, color: onPrimary }}>
            Executive Summary
          </div>
          <div className="px-2.5 py-1.5 rounded text-white text-[10px] font-bold w-max" style={{ background: "#f59e0b" }}>
            MEDIUM RISK
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {["6", "4", "3"].map((n, i) => (
              <div key={i} className="rounded p-1.5 text-center" style={{ background: "#f3f4f6" }}>
                <p className="text-sm font-bold" style={{ color: primary }}>{n}</p>
                <p className="text-[6px] text-gray-500">Metric</p>
              </div>
            ))}
          </div>
          <div className="rounded border border-gray-200 p-2 flex gap-1.5">
            <div className="w-1 rounded" style={{ background: "#f97316" }} />
            <div className="space-y-1 flex-1">
              <div className="h-1.5 w-1/3 rounded bg-gray-300" />
              <div className="h-1.5 w-full rounded bg-gray-100" />
            </div>
          </div>
          <div className="mt-auto pt-2 border-t border-gray-200 flex items-center justify-between text-[6px] text-gray-500">
            <span className="truncate pr-2">
              {(draft.companyName || "Company") + " — " + (draft.reportFooterText || "Confidential Inspection Report")}
            </span>
            {draft.poweredByVisible && <span className="shrink-0">Powered by ReadyLoq</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function BrandPreview({ draft }: { draft: BrandingDraft }) {
  return (
    <Tabs defaultValue="desktop" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="desktop" className="gap-1.5">
          <Monitor className="h-3.5 w-3.5" /> Desktop
        </TabsTrigger>
        <TabsTrigger value="mobile" className="gap-1.5">
          <Smartphone className="h-3.5 w-3.5" /> Mobile
        </TabsTrigger>
        <TabsTrigger value="pdf" className="gap-1.5">
          <FileText className="h-3.5 w-3.5" /> PDF
        </TabsTrigger>
      </TabsList>
      <TabsContent value="desktop" className="mt-4">
        <DesktopPreview draft={draft} />
      </TabsContent>
      <TabsContent value="mobile" className="mt-4">
        <MobilePreview draft={draft} />
      </TabsContent>
      <TabsContent value="pdf" className="mt-4">
        <PdfPreview draft={draft} />
      </TabsContent>
    </Tabs>
  );
}
