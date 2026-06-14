import { createContext, useContext, useEffect, useState } from "react";
import {
  useGetActiveBranding,
  getGetActiveBrandingQueryKey,
  useGetCompanyBranding,
  getGetCompanyBrandingQueryKey,
  type BrandingProfile,
} from "@workspace/api-client-react";
import { DEFAULT_BRANDING, DEFAULT_LOGO, applyBrandingToDocument } from "@/lib/branding";

const BrandingContext = createContext<BrandingProfile>(DEFAULT_BRANDING);
const BrandingPreviewContext = createContext<(b: BrandingProfile | null) => void>(() => {});

export function useBranding(): BrandingProfile {
  return useContext(BrandingContext);
}

/**
 * Returns a setter that overrides the live document branding for preview.
 * Pass a profile to preview it across the whole app; pass null to restore the
 * active profile. Centralizing preview here ensures an active-profile refetch
 * can never clobber an in-progress preview (the provider re-applies preview
 * over active on every render).
 */
export function useBrandingPreview(): (b: BrandingProfile | null) => void {
  return useContext(BrandingPreviewContext);
}

function BrandedSplash() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background">
      <img
        src={DEFAULT_LOGO}
        alt="Loading"
        className="w-16 h-16 rounded-2xl animate-pulse"
      />
    </div>
  );
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useGetActiveBranding({
    query: { queryKey: getGetActiveBrandingQueryKey(), staleTime: 60_000 },
  });
  // Post-login the caller's company brand overrides the platform default. When
  // signed out or not yet onboarded this request 401/403s and is ignored, so
  // the pre-login experience keeps the platform (ReadyLoq) brand.
  const { data: companyBrand } = useGetCompanyBranding({
    query: { queryKey: getGetCompanyBrandingQueryKey(), staleTime: 60_000, retry: false },
  });
  const [preview, setPreview] = useState<BrandingProfile | null>(null);

  const active = companyBrand ?? data ?? DEFAULT_BRANDING;
  const effective = preview ?? active;

  useEffect(() => {
    applyBrandingToDocument(effective);
  }, [effective]);

  if (isLoading && !data) return <BrandedSplash />;

  return (
    <BrandingPreviewContext.Provider value={setPreview}>
      <BrandingContext.Provider value={effective}>{children}</BrandingContext.Provider>
    </BrandingPreviewContext.Provider>
  );
}
