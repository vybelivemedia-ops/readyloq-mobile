/**
 * TreatmentLogWizard — six-step chemical application compliance modal.
 *
 * Enforces the six label-derived guardrails before allowing a treatment to be
 * recorded, in order:
 *
 *  Step 0 — Pest & Product:   select target pest, pick a product (off-label
 *                              combinations appear greyed-out)
 *  Step 1 — Site gate:        pick site classification; blocks if off-label
 *  Step 2 — Equipment check:  display required nozzle/pressure/droplet;
 *                              technician confirms correct hardware
 *  Step 3 — Rate calculator:  enter area → calculate required product volume;
 *                              enforces label maximum rate (Next disabled if over)
 *  Step 4 — Pre-mix checklist: all PPE + mixing-step items must be checked
 *  Step 5 — Env. warning:     check ambient temp vs maxTempF and phytotoxicity
 *                              notes; acknowledgement required if triggered
 *
 * On successful submit the wizard calls onLogged() and closes.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  createTreatmentLog,
  listProducts,
  type ChecklistItem,
  type Product,
} from "@/lib/api-client/products";
import { getRecentMixes, type RecentMix, type RouteAssignmentWithProduct } from "@/lib/api-client/daily-route";
import { useColors } from "@/hooks/useColors";
import { PEST_TYPES } from "@/constants/inspection";

// ─── Site classification catalogue ───────────────────────────────────────────

const SITE_CLASSIFICATIONS: { value: string; label: string }[] = [
  { value: "residential_interior", label: "Residential — Interior" },
  { value: "residential_exterior", label: "Residential — Exterior" },
  { value: "commercial_interior", label: "Commercial — Interior" },
  { value: "commercial_exterior", label: "Commercial — Exterior" },
  { value: "food_handling_area", label: "Food Handling Area" },
  { value: "structural_void", label: "Structural Void / Crawlspace" },
  { value: "ornamental", label: "Ornamental Plants" },
  { value: "turf_lawn", label: "Turf / Lawn" },
  { value: "perimeter", label: "Building Perimeter" },
];

// ─── Signal word → colour ─────────────────────────────────────────────────────

const SIGNAL_COLORS: Record<string, string> = {
  DANGER: "#ef4444",
  WARNING: "#f59e0b",
  CAUTION: "#d29922",
  NONE: "#6b7280",
};

// ─── PPE items prepended to every checklist ────────────────────────────────────

const PPE_ITEMS = [
  "Nitrile or chemical-resistant gloves worn",
  "Eye protection / safety glasses worn",
  "Long sleeves and closed-toe shoes worn",
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  /** Whether the wizard modal is open. */
  visible: boolean;
  /** Called when the technician dismisses or cancels the wizard. */
  onClose: () => void;
  /** Server inspection ID — used for the POST /inspections/:id/treatment-logs call. */
  inspectionId: number;
  /**
   * Pest types already associated with this inspection — used as the primary
   * chip list in Step 0.  Falls back to the global PEST_TYPES list when empty.
   */
  pestTypes: string[];
  /** Called on successful submission so the parent can refetch treatment logs. */
  onLogged: () => void;
  /**
   * Technician's daily route chemical assignments (product→pest pairings).
   * When provided (non-empty), Step 0 gains a "Today's Route" tab that shows
   * assignment cards for one-tap selection — tapping a card pre-fills both
   * product AND pest and advances directly to Site (Step 1).
   */
  routeAssignments?: RouteAssignmentWithProduct[];
}

// ─── Step-level progress ──────────────────────────────────────────────────────

const STEP_TITLES = [
  "Pest & Product",
  "Application Site",
  "Equipment Check",
  "Rate Calculator",
  "Pre-mix Checklist",
  "Environmental Check",
];
const TOTAL_STEPS = STEP_TITLES.length;

// ─── Component ────────────────────────────────────────────────────────────────

export function TreatmentLogWizard({
  visible,
  onClose,
  inspectionId,
  pestTypes,
  onLogged,
  routeAssignments = [],
}: Props) {
  const colors = useColors();

  // ── wizard step ────────────────────────────────────────────────────────────
  const [step, setStep] = useState(0);

  // ── Step 0: Pest + Product ─────────────────────────────────────────────────
  const [selectedPest, setSelectedPest] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  // Step 0 quick-pick tabs — only visible when routeAssignments is non-empty
  const hasRoute = routeAssignments.length > 0;
  const [step0Tab, setStep0Tab] = useState<"route" | "all">(hasRoute ? "route" : "all");
  const [recentMixes, setRecentMixes] = useState<RecentMix[]>([]);
  const [loadingRecentMixes, setLoadingRecentMixes] = useState(false);

  // ── Step 1: Site ───────────────────────────────────────────────────────────
  const [selectedSite, setSelectedSite] = useState<string | null>(null);

  // ── Step 2: Equipment ──────────────────────────────────────────────────────
  const [equipmentConfirmed, setEquipmentConfirmed] = useState(false);

  // ── Step 3: Rate calculator ────────────────────────────────────────────────
  const [areaMode, setAreaMode] = useState<"sqft" | "linear">("sqft");
  const [areaSqft, setAreaSqft] = useState("");
  const [linearFt, setLinearFt] = useState("");
  const [totalProductOz, setTotalProductOz] = useState("");
  const [dilutionOzPerGallon, setDilutionOzPerGallon] = useState("");

  // ── Step 4: Checklist ──────────────────────────────────────────────────────
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);

  // ── Step 5: Env + Submit ───────────────────────────────────────────────────
  const [tempF, setTempF] = useState("");
  const [envWarningAcknowledged, setEnvWarningAcknowledged] = useState(false);
  const [applicationNotes, setApplicationNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Reset all state when modal opens ──────────────────────────────────────
  const resetAll = useCallback(() => {
    setStep(0);
    setSelectedPest(null);
    setProducts([]);
    setLoadingProducts(false);
    setProductError(null);
    setSelectedProduct(null);
    setSelectedSite(null);
    setEquipmentConfirmed(false);
    setAreaMode("sqft");
    setAreaSqft("");
    setLinearFt("");
    setTotalProductOz("");
    setDilutionOzPerGallon("");
    setChecklistItems([]);
    setTempF("");
    setEnvWarningAcknowledged(false);
    setApplicationNotes("");
    setSubmitting(false);
    setSubmitError(null);
    // Quick-pick state
    setStep0Tab(routeAssignments.length > 0 ? "route" : "all");
    setRecentMixes([]);
    setLoadingRecentMixes(false);
  }, [routeAssignments.length]);

  useEffect(() => {
    if (visible) resetAll();
  }, [visible, resetAll]);

  // ── Product fetch ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    setLoadingProducts(true);
    setProductError(null);
    listProducts()
      .then(setProducts)
      .catch(() => setProductError("Failed to load products. Check your connection."))
      .finally(() => setLoadingProducts(false));
  }, [visible]);

  // ── Recent mixes fetch (Today's Route tab) ────────────────────────────────
  useEffect(() => {
    if (!visible || !hasRoute) return;
    setLoadingRecentMixes(true);
    getRecentMixes()
      .then(setRecentMixes)
      .catch(() => setRecentMixes([]))
      .finally(() => setLoadingRecentMixes(false));
  }, [visible, hasRoute]);

  // ── Checklist builder ──────────────────────────────────────────────────────
  // Rebuilds the checklist whenever a product is selected (Step 4 prep).
  useEffect(() => {
    if (!selectedProduct) return;
    const mixing = selectedProduct.labelRules?.mixingSteps ?? [];
    setChecklistItems([
      ...PPE_ITEMS.map((label) => ({ label, checked: false })),
      ...mixing.map((label) => ({ label, checked: false })),
    ]);
  }, [selectedProduct]);

  // ── Derived validation ─────────────────────────────────────────────────────

  const labelRules = selectedProduct?.labelRules;

  /** Rate error text — non-null when the entered volume exceeds label max. */
  const rateErrorText: string | null = (() => {
    const area = parseFloat(areaMode === "sqft" ? areaSqft : "0");
    const oz = parseFloat(totalProductOz);
    if (!area || !oz || !labelRules?.maxRateOzPer1000Sqft) return null;
    const applied = (oz / area) * 1000;
    if (applied > labelRules.maxRateOzPer1000Sqft) {
      return `Exceeds label maximum (${labelRules.maxRateOzPer1000Sqft} oz / 1,000 sq ft). Entered: ${applied.toFixed(2)} oz / 1,000 sq ft.`;
    }
    return null;
  })();

  /** Recommended product volume (oz) at the label maximum for the entered area. */
  const recommendedOz: number | null = (() => {
    const area = parseFloat(areaSqft);
    if (!area || !labelRules?.maxRateOzPer1000Sqft) return null;
    return parseFloat(((labelRules.maxRateOzPer1000Sqft * area) / 1000).toFixed(2));
  })();

  /** Environmental warnings that must be acknowledged in step 5. */
  const envWarnings: string[] = (() => {
    const warnings: string[] = [];
    const temp = parseInt(tempF, 10);
    if (!isNaN(temp) && labelRules?.maxTempF && temp > labelRules.maxTempF) {
      warnings.push(
        `Current temperature (${temp}°F) exceeds the label maximum of ${labelRules.maxTempF}°F. Application at this temperature may reduce efficacy or cause phytotoxic reactions.`,
      );
    }
    if (labelRules?.phytotoxicityNotes) {
      warnings.push(`Phytotoxicity risk: ${labelRules.phytotoxicityNotes}`);
    }
    return warnings;
  })();

  const siteApproved =
    selectedSite !== null &&
    (labelRules?.approvedSiteClassifications?.includes(selectedSite) ?? false);

  const allChecked =
    checklistItems.length > 0 && checklistItems.every((item) => item.checked);

  /**
   * Step 3 is valid when:
   * - No rate-limit error
   * - If the product has a label max rate: at least one area measurement and
   *   a product volume must be entered (otherwise the compliance record is
   *   incomplete and the server will reject it with rate_inputs_required).
   */
  const step3Valid: boolean = (() => {
    if (rateErrorText) return false;
    if (!labelRules?.maxRateOzPer1000Sqft) return true; // no rate constraint — fields optional
    const ozNum = parseFloat(totalProductOz);
    if (!ozNum || ozNum <= 0) return false;
    if (areaMode === "sqft") {
      const areaNum = parseFloat(areaSqft);
      return !!(areaNum && areaNum > 0);
    } else {
      const ftNum = parseFloat(linearFt);
      return !!(ftNum && ftNum > 0);
    }
  })();

  const canProceedStep: Record<number, boolean> = {
    0: !!selectedPest && !!selectedProduct,
    1: siteApproved,
    2: equipmentConfirmed,
    3: step3Valid,
    4: allChecked,
    5: envWarnings.length === 0 || envWarningAcknowledged,
  };

  // ── Navigation ─────────────────────────────────────────────────────────────

  const handleNext = () => {
    if (step < TOTAL_STEPS - 1) {
      setStep((s) => s + 1);
    } else {
      void handleSubmit();
    }
  };

  const handleBack = () => {
    if (step > 0) setStep((s) => s - 1);
    else handleClose();
  };

  const handleClose = () => {
    Alert.alert("Discard treatment?", "Any unsaved data will be lost.", [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          resetAll();
          onClose();
        },
      },
    ]);
  };

  // ── Submission ─────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!selectedProduct || !selectedPest || !selectedSite) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createTreatmentLog(inspectionId, {
        productId: selectedProduct.id,
        targetPest: selectedPest,
        siteClassification: selectedSite,
        // Only send the active area mode's measurement — prevents stale data
        // from a previous mode selection being submitted alongside the new one.
        areaSqft: areaMode === "sqft" && areaSqft ? parseFloat(areaSqft) : undefined,
        linearFt: areaMode === "linear" && linearFt ? parseFloat(linearFt) : undefined,
        dilutionOzPerGallon: dilutionOzPerGallon ? parseFloat(dilutionOzPerGallon) : undefined,
        totalProductOz: totalProductOz ? parseFloat(totalProductOz) : undefined,
        equipmentUsed: labelRules?.requiredEquipmentTypes?.[0] ?? undefined,
        checklistItems,
        tempAtApplicationF: tempF ? parseInt(tempF, 10) : undefined,
        environmentalWarningAcknowledged: envWarningAcknowledged,
        notes: applicationNotes.trim() || undefined,
      });
      onLogged();
      resetAll();
      onClose();
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Failed to submit. Try again.";
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Checklist toggle ───────────────────────────────────────────────────────

  const toggleCheck = (index: number) => {
    setChecklistItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, checked: !item.checked } : item,
      ),
    );
  };

  // ── Use-mix: pre-fill state from a recent mix and jump to site step ────────

  const handleUseMix = useCallback(
    (mix: RecentMix) => {
      const product = products.find((p) => p.id === mix.productId) ?? null;
      if (product) setSelectedProduct(product);
      setSelectedPest(mix.targetPest);
      setSelectedSite(mix.siteClassification);
      if (mix.areaSqft != null) {
        setAreaMode("sqft");
        setAreaSqft(String(mix.areaSqft));
      } else if (mix.linearFt != null) {
        setAreaMode("linear");
        setLinearFt(String(mix.linearFt));
      }
      if (mix.totalProductOz != null) {
        setTotalProductOz(String(mix.totalProductOz));
      }
      // Advance past the product-selection step — technician still confirms
      // site (Step 1), equipment (Step 2), rate (Step 3), checklist (Step 4),
      // and environmental check (Step 5) before the log is submitted.
      setStep(1);
    },
    [products],
  );

  // ── Render helpers ─────────────────────────────────────────────────────────

  const pestList =
    pestTypes.length > 0 ? pestTypes : PEST_TYPES.slice();

  // ── Steps ──────────────────────────────────────────────────────────────────

  // ── Shared product-card renderer (used by both tabs) ─────────────────────
  function renderProductCard(product: Product, approvedIds: Set<number>) {
    const approved = approvedIds.has(product.id);
    return (
      <Pressable
        key={product.id}
        onPress={() => approved && setSelectedProduct(product)}
        style={[
          s.productCard,
          { borderColor: colors.border, backgroundColor: colors.card },
          selectedProduct?.id === product.id && {
            borderColor: colors.primary,
            backgroundColor: "rgba(23,196,211,0.08)",
          },
          !approved && { opacity: 0.4 },
        ]}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={[s.productName, { color: colors.foreground }]}>{product.name}</Text>
            <Text style={[s.productMeta, { color: colors.mutedForeground }]}>
              {product.activeIngredients}
            </Text>
            {product.epaRegistrationNumber ? (
              <Text style={[s.productMeta, { color: colors.mutedForeground }]}>
                EPA {product.epaRegistrationNumber}
              </Text>
            ) : null}
          </View>
          <View style={{ gap: 4, alignItems: "flex-end" }}>
            {product.signalWord ? (
              <View
                style={[
                  s.signalBadge,
                  { backgroundColor: SIGNAL_COLORS[product.signalWord] ?? "#6b7280" },
                ]}
              >
                <Text style={s.signalText}>{product.signalWord}</Text>
              </View>
            ) : null}
            <View
              style={[
                s.typeBadge,
                {
                  backgroundColor:
                    product.productType === "restricted-use"
                      ? "rgba(248,81,73,0.15)"
                      : "rgba(63,185,80,0.15)",
                  borderColor:
                    product.productType === "restricted-use" ? "#f85149" : "#3fb950",
                },
              ]}
            >
              <Text
                style={[
                  s.typeText,
                  {
                    color:
                      product.productType === "restricted-use" ? "#f85149" : "#3fb950",
                  },
                ]}
              >
                {product.productType === "restricted-use" ? "RUP" : "General Use"}
              </Text>
            </View>
          </View>
        </View>
        {!approved && selectedPest ? (
          <Text
            style={{ color: "#f59e0b", fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 4 }}
          >
            Not approved for {selectedPest}
          </Text>
        ) : null}
      </Pressable>
    );
  }

  // ── Recent-mix card ────────────────────────────────────────────────────────
  function renderRecentMixCard(mix: RecentMix) {
    const siteLabel =
      SITE_CLASSIFICATIONS.find((s) => s.value === mix.siteClassification)?.label ??
      mix.siteClassification;
    const rateStr =
      mix.totalProductOz != null && (mix.areaSqft != null || mix.linearFt != null)
        ? `${mix.totalProductOz} oz · ${mix.areaSqft != null ? `${mix.areaSqft} sq ft` : `${mix.linearFt} ft`}`
        : mix.totalProductOz != null
          ? `${mix.totalProductOz} oz`
          : null;
    return (
      <View
        key={`${mix.productId}-${mix.siteClassification}`}
        style={{
          borderWidth: 1,
          borderRadius: 12,
          borderColor: colors.border,
          backgroundColor: colors.card,
          padding: 12,
          gap: 6,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text
              style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}
            >
              {mix.productName}
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 12,
                marginTop: 2,
              }}
            >
              {mix.targetPest} · {siteLabel}
            </Text>
            {rateStr ? (
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                  fontSize: 12,
                }}
              >
                {rateStr}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => handleUseMix(mix)}
            style={{
              alignSelf: "center",
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: 8,
              backgroundColor: colors.primary,
            }}
          >
            <Text
              style={{
                color: colors.primaryForeground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 12,
              }}
            >
              Use mix
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderStep0() {
    const approvedIds = new Set(
      products
        .filter((p) => p.labelRules?.approvedPestTypes?.includes(selectedPest ?? ""))
        .map((p) => p.id),
    );

    return (
      <ScrollView contentContainerStyle={{ gap: 20, paddingBottom: 20 }}>

        {/* Quick-pick tab bar — only when a route is loaded */}
        {hasRoute ? (
          <View
            style={{
              flexDirection: "row",
              borderRadius: 10,
              backgroundColor: colors.muted,
              padding: 3,
              gap: 3,
            }}
          >
            {(["route", "all"] as const).map((tab) => {
              const active = step0Tab === tab;
              return (
                <Pressable
                  key={tab}
                  onPress={() => setStep0Tab(tab)}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    borderRadius: 8,
                    alignItems: "center",
                    backgroundColor: active ? colors.card : "transparent",
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 13,
                      color: active ? colors.foreground : colors.mutedForeground,
                    }}
                  >
                    {tab === "route"
                      ? `Today's Route (${routeAssignments.length})`
                      : "All Products"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* ── Today's Route tab ───────────────────────────────────────────── */}
        {step0Tab === "route" && hasRoute ? (
          <View style={{ gap: 14 }}>
            <StepLabel text="Tap an assignment to pre-fill product & pest" />

            {/* Route assignment cards — each pre-fills product + pest + jumps to Step 1 */}
            {routeAssignments.map((assignment, idx) => {
              const productName = assignment.product?.name ?? `Product #${assignment.productId}`;
              const productObj = assignment.product
                ?? products.find((p) => p.id === assignment.productId)
                ?? null;
              const isSelected =
                selectedProduct?.id === assignment.productId &&
                selectedPest === assignment.targetPest;

              return (
                <Pressable
                  key={idx}
                  onPress={() => {
                    if (productObj) setSelectedProduct(productObj);
                    setSelectedPest(assignment.targetPest);
                    // Jump straight to Site step — both product and pest are known.
                    setStep(1);
                  }}
                  style={[
                    s.productCard,
                    { borderColor: colors.border, backgroundColor: colors.card },
                    isSelected && {
                      borderColor: colors.primary,
                      backgroundColor: "rgba(23,196,211,0.08)",
                    },
                  ]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      {/* Product → Pest pair */}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={[s.productName, { color: colors.foreground }]}>
                          {productName}
                        </Text>
                        <Ionicons name="arrow-forward" size={12} color={colors.mutedForeground} />
                        <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                          {assignment.targetPest}
                        </Text>
                      </View>
                      {/* Active ingredient */}
                      {assignment.product?.activeIngredients ? (
                        <Text style={[s.productMeta, { color: colors.mutedForeground }]}>
                          {assignment.product.activeIngredients}
                        </Text>
                      ) : null}
                      {/* Notes */}
                      {assignment.notes ? (
                        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                          {assignment.notes}
                        </Text>
                      ) : null}
                    </View>
                    {/* Signal word + RUP badges */}
                    <View style={{ gap: 4, alignItems: "flex-end" }}>
                      {assignment.product?.signalWord && assignment.product.signalWord !== "NONE" ? (
                        <View
                          style={[
                            s.signalBadge,
                            { backgroundColor: SIGNAL_COLORS[assignment.product.signalWord] ?? "#6b7280" },
                          ]}
                        >
                          <Text style={s.signalText}>{assignment.product.signalWord}</Text>
                        </View>
                      ) : null}
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={colors.primary}
                      />
                    </View>
                  </View>
                </Pressable>
              );
            })}

            {/* Recent Mixes — helpful context even in route tab */}
            {recentMixes.length > 0 ? (
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="time-outline" size={14} color={colors.mutedForeground} />
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 13,
                    }}
                  >
                    Recent mixes — tap to pre-fill rates
                  </Text>
                </View>
                {loadingRecentMixes ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  recentMixes.map((mix) => renderRecentMixCard(mix))
                )}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ── All Products tab ─────────────────────────────────────────────── */}
        {step0Tab === "all" || !hasRoute ? (
          <>
            {/* Pest chips — shown only in All Products mode */}
            <View style={{ gap: 10 }}>
              <StepLabel text="Select target pest" />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {pestList.map((pest) => (
                  <Pressable
                    key={pest}
                    onPress={() => {
                      setSelectedPest(pest);
                      setSelectedProduct(null);
                    }}
                    style={[
                      s.chip,
                      selectedPest === pest && {
                        backgroundColor: colors.primary,
                        borderColor: colors.primary,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        s.chipText,
                        {
                          color:
                            selectedPest === pest ? colors.primaryForeground : colors.foreground,
                        },
                      ]}
                    >
                      {pest}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {selectedPest ? (
              <View style={{ gap: 10 }}>
                <StepLabel text="Select product" />
                {loadingProducts ? (
                  <ActivityIndicator color={colors.primary} />
                ) : productError ? (
                  <ErrorBanner text={productError} />
                ) : (
                  products.map((product) => renderProductCard(product, approvedIds))
                )}
              </View>
            ) : null}

            {/* Recent Mixes — also available in All Products tab */}
            {hasRoute && selectedPest && recentMixes.length > 0 ? (
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="time-outline" size={14} color={colors.mutedForeground} />
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 13,
                    }}
                  >
                    Recent mixes — tap to pre-fill rates
                  </Text>
                </View>
                {recentMixes.map((mix) => renderRecentMixCard(mix))}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    );
  }

  function renderStep1() {
    return (
      <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 20 }}>
        <StepLabel text="Select application site" />
        {SITE_CLASSIFICATIONS.map((site) => {
          const approved = labelRules?.approvedSiteClassifications?.includes(site.value) ?? false;
          const isSelected = selectedSite === site.value;
          return (
            <Pressable
              key={site.value}
              onPress={() => setSelectedSite(site.value)}
              style={[
                s.siteOption,
                { borderColor: colors.border, backgroundColor: colors.card },
                isSelected && approved && { borderColor: colors.primary, backgroundColor: "rgba(23,196,211,0.08)" },
                isSelected && !approved && { borderColor: "#f85149", backgroundColor: "rgba(248,81,73,0.08)" },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[s.siteLabel, { color: colors.foreground }]}>{site.label}</Text>
              </View>
              <Ionicons
                name={approved ? "checkmark-circle" : "close-circle"}
                size={18}
                color={approved ? "#3fb950" : "#6b7280"}
              />
            </Pressable>
          );
        })}
        {selectedSite && !siteApproved ? (
          <View style={[s.warningBanner, { borderColor: "#f85149", backgroundColor: "rgba(248,81,73,0.08)" }]}>
            <Ionicons name="ban" size={16} color="#f85149" />
            <Text style={{ color: "#f85149", fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}>
              {selectedProduct?.name ?? "This product"} is not labelled for this site type. Select a site that appears with a green checkmark to continue.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    );
  }

  function renderStep2() {
    return (
      <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>
        <StepLabel text="Confirm your equipment before proceeding" />

        {/* Equipment types */}
        {labelRules?.requiredEquipmentTypes?.length ? (
          <InfoCard title="Required equipment">
            {labelRules.requiredEquipmentTypes.map((eq) => (
              <BulletRow key={eq} text={eq.replace(/_/g, " ")} color={colors.foreground} />
            ))}
          </InfoCard>
        ) : null}

        {/* Specs */}
        {labelRules?.nozzleSpec || labelRules?.pressurePsi || labelRules?.dropletSize ? (
          <InfoCard title="Label specifications">
            {labelRules.nozzleSpec ? (
              <SpecRow label="Nozzle" value={labelRules.nozzleSpec} colors={colors} />
            ) : null}
            {labelRules.pressurePsi ? (
              <SpecRow label="Pressure" value={labelRules.pressurePsi} colors={colors} />
            ) : null}
            {labelRules.dropletSize ? (
              <SpecRow label="Droplet size" value={labelRules.dropletSize} colors={colors} />
            ) : null}
          </InfoCard>
        ) : null}

        {/* Signal word callout */}
        {selectedProduct?.signalWord && selectedProduct.signalWord !== "NONE" ? (
          <View
            style={[
              s.warningBanner,
              {
                borderColor: SIGNAL_COLORS[selectedProduct.signalWord] ?? "#6b7280",
                backgroundColor: `${SIGNAL_COLORS[selectedProduct.signalWord] ?? "#6b7280"}18`,
              },
            ]}
          >
            <Ionicons name="warning" size={16} color={SIGNAL_COLORS[selectedProduct.signalWord] ?? "#6b7280"} />
            <Text
              style={{
                color: SIGNAL_COLORS[selectedProduct.signalWord] ?? "#6b7280",
                fontFamily: "Inter_600SemiBold",
                fontSize: 13,
                flex: 1,
              }}
            >
              Signal word: {selectedProduct.signalWord}. Wear appropriate PPE per the label before mixing.
            </Text>
          </View>
        ) : null}

        {/* Re-entry interval */}
        {labelRules?.reEntryIntervalHours != null ? (
          <InfoCard title="Re-entry interval (REI)">
            <Text style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14 }}>
              {labelRules.reEntryIntervalHours === 0
                ? "No REI restriction — allow treated area to dry before re-entry."
                : `${labelRules.reEntryIntervalHours} hour${labelRules.reEntryIntervalHours !== 1 ? "s" : ""} — keep people and pets out of the treated area for this period.`}
            </Text>
          </InfoCard>
        ) : null}

        {/* Confirmation toggle */}
        <Pressable
          onPress={() => setEquipmentConfirmed((v) => !v)}
          style={[
            s.confirmRow,
            {
              borderColor: equipmentConfirmed ? colors.primary : colors.border,
              backgroundColor: equipmentConfirmed ? "rgba(23,196,211,0.08)" : colors.card,
            },
          ]}
        >
          <View
            style={[
              s.checkbox,
              {
                borderColor: equipmentConfirmed ? colors.primary : colors.mutedForeground,
                backgroundColor: equipmentConfirmed ? colors.primary : "transparent",
              },
            ]}
          >
            {equipmentConfirmed ? <Ionicons name="checkmark" size={14} color={colors.primaryForeground} /> : null}
          </View>
          <Text style={[s.confirmText, { color: colors.foreground }]}>
            Confirmed — I have the correct equipment and PPE for this application.
          </Text>
        </Pressable>
      </ScrollView>
    );
  }

  function renderStep3() {
    return (
      <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>
        <StepLabel text="Enter area to calculate product volume" />

        {/* Area mode toggle */}
        <View style={[s.segmentRow, { backgroundColor: colors.secondary }]}>
          {(["sqft", "linear"] as const).map((mode) => (
            <Pressable
              key={mode}
              onPress={() => {
                setAreaMode(mode);
                // Clear the inactive area field so stale data is never sent.
                if (mode === "sqft") setLinearFt("");
                else setAreaSqft("");
              }}
              style={[
                s.segmentOption,
                areaMode === mode && { backgroundColor: colors.card },
              ]}
            >
              <Text
                style={[
                  s.segmentText,
                  { color: areaMode === mode ? colors.foreground : colors.mutedForeground },
                ]}
              >
                {mode === "sqft" ? "Area (sq ft)" : "Linear footage"}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Area input */}
        {areaMode === "sqft" ? (
          <View style={{ gap: 6 }}>
            <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>
              Treatment area (sq ft)
            </Text>
            <TextInput
              style={[s.textInput, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
              keyboardType="numeric"
              placeholder="e.g. 500"
              placeholderTextColor={colors.mutedForeground}
              value={areaSqft}
              onChangeText={(v) => {
                setAreaSqft(v);
                // Auto-fill recommended oz when area changes.
                if (!totalProductOz) {
                  const area = parseFloat(v);
                  const max = labelRules?.maxRateOzPer1000Sqft;
                  if (area && max) {
                    setTotalProductOz(((max * area) / 1000).toFixed(2));
                  }
                }
              }}
            />
            {recommendedOz !== null ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                At label maximum: {recommendedOz} fl oz of product
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: 6 }}>
            <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>Linear footage</Text>
            <TextInput
              style={[s.textInput, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
              keyboardType="numeric"
              placeholder="e.g. 150"
              placeholderTextColor={colors.mutedForeground}
              value={linearFt}
              onChangeText={setLinearFt}
            />
          </View>
        )}

        {/* Product volume */}
        <View style={{ gap: 6 }}>
          <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>
            Product volume to apply (fl oz)
            {labelRules?.maxRateOzPer1000Sqft && areaMode === "sqft"
              ? `  ·  Label max: ${labelRules.maxRateOzPer1000Sqft} oz / 1,000 sq ft`
              : ""}
          </Text>
          <TextInput
            style={[
              s.textInput,
              { borderColor: rateErrorText ? "#f85149" : colors.border, color: colors.foreground, backgroundColor: colors.card },
            ]}
            keyboardType="numeric"
            placeholder="e.g. 0.5"
            placeholderTextColor={colors.mutedForeground}
            value={totalProductOz}
            onChangeText={setTotalProductOz}
          />
          {rateErrorText ? (
            <View style={[s.warningBanner, { borderColor: "#f85149", backgroundColor: "rgba(248,81,73,0.08)", marginTop: 0 }]}>
              <Ionicons name="warning" size={14} color="#f85149" />
              <Text style={{ color: "#f85149", fontFamily: "Inter_400Regular", fontSize: 12, flex: 1 }}>
                {rateErrorText}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Dilution */}
        {labelRules?.maxRateOzPerGallon ? (
          <View style={{ gap: 6 }}>
            <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>
              Dilution (fl oz product per gallon of water)
              {labelRules.maxRateOzPerGallon
                ? `  ·  Label max: ${labelRules.maxRateOzPerGallon} oz/gal`
                : ""}
            </Text>
            <TextInput
              style={[s.textInput, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
              keyboardType="numeric"
              placeholder={`e.g. ${labelRules.maxRateOzPerGallon}`}
              placeholderTextColor={colors.mutedForeground}
              value={dilutionOzPerGallon}
              onChangeText={setDilutionOzPerGallon}
            />
          </View>
        ) : null}

        {/* Required-inputs hint — shown when maxRate product has blank fields */}
        {labelRules?.maxRateOzPer1000Sqft != null && !step3Valid && !rateErrorText ? (
          <View
            style={[
              s.warningBanner,
              { borderColor: colors.border, backgroundColor: colors.card, marginTop: 0 },
            ]}
          >
            <Ionicons name="information-circle-outline" size={14} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, flex: 1 }}>
              {areaMode === "sqft"
                ? "Enter treatment area (sq ft) and product volume to continue."
                : "Enter linear footage and product volume to continue."}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    );
  }

  function renderStep4() {
    const checkedCount = checklistItems.filter((i) => i.checked).length;
    return (
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 20 }}>
        <StepLabel text="Check every item before mixing" />
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
          {checkedCount} of {checklistItems.length} complete
        </Text>
        {checklistItems.map((item, i) => (
          <Pressable
            key={i}
            onPress={() => toggleCheck(i)}
            style={[
              s.checklistRow,
              {
                borderColor: item.checked ? colors.primary : colors.border,
                backgroundColor: item.checked ? "rgba(23,196,211,0.06)" : colors.card,
              },
            ]}
          >
            <View
              style={[
                s.checkbox,
                {
                  borderColor: item.checked ? colors.primary : colors.mutedForeground,
                  backgroundColor: item.checked ? colors.primary : "transparent",
                },
              ]}
            >
              {item.checked ? (
                <Ionicons name="checkmark" size={14} color={colors.primaryForeground} />
              ) : null}
            </View>
            <Text
              style={[
                s.checklistText,
                {
                  color: item.checked ? colors.foreground : colors.mutedForeground,
                  textDecorationLine: item.checked ? "line-through" : "none",
                },
              ]}
            >
              {/* Mark the first PPE_ITEMS.length items as PPE */}
              {i < PPE_ITEMS.length ? "⚠️ PPE: " : ""}
              {item.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    );
  }

  function renderStep5() {
    const hasWarnings = envWarnings.length > 0;
    return (
      <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>
        <StepLabel text="Confirm environmental conditions" />

        {/* Temperature */}
        <View style={{ gap: 6 }}>
          <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>
            Ambient temperature at time of application (°F)
            {labelRules?.maxTempF ? `  ·  Label max: ${labelRules.maxTempF}°F` : ""}
          </Text>
          <TextInput
            style={[s.textInput, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
            keyboardType="numeric"
            placeholder="e.g. 72"
            placeholderTextColor={colors.mutedForeground}
            value={tempF}
            onChangeText={setTempF}
          />
        </View>

        {/* Environmental warnings */}
        {envWarnings.map((w, i) => (
          <View
            key={i}
            style={[s.warningBanner, { borderColor: "#d29922", backgroundColor: "rgba(210,153,34,0.10)" }]}
          >
            <Ionicons name="warning" size={16} color="#d29922" />
            <Text style={{ color: "#d29922", fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}>
              {w}
            </Text>
          </View>
        ))}

        {/* Acknowledgement (required when warnings exist) */}
        {hasWarnings ? (
          <Pressable
            onPress={() => setEnvWarningAcknowledged((v) => !v)}
            style={[
              s.confirmRow,
              {
                borderColor: envWarningAcknowledged ? "#d29922" : colors.border,
                backgroundColor: envWarningAcknowledged ? "rgba(210,153,34,0.08)" : colors.card,
              },
            ]}
          >
            <View
              style={[
                s.checkbox,
                {
                  borderColor: envWarningAcknowledged ? "#d29922" : colors.mutedForeground,
                  backgroundColor: envWarningAcknowledged ? "#d29922" : "transparent",
                },
              ]}
            >
              {envWarningAcknowledged ? (
                <Ionicons name="checkmark" size={14} color="#fff" />
              ) : null}
            </View>
            <Text style={[s.confirmText, { color: colors.foreground }]}>
              I acknowledge the conditions above and confirm this application is appropriate.
            </Text>
          </Pressable>
        ) : (
          <View
            style={[s.warningBanner, { borderColor: "#3fb950", backgroundColor: "rgba(63,185,80,0.08)" }]}
          >
            <Ionicons name="checkmark-circle" size={16} color="#3fb950" />
            <Text style={{ color: "#3fb950", fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}>
              Environmental conditions are within label guidelines.
            </Text>
          </View>
        )}

        {/* Application notes */}
        <View style={{ gap: 6 }}>
          <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>Notes (optional)</Text>
          <TextInput
            style={[
              s.textInput,
              {
                borderColor: colors.border,
                color: colors.foreground,
                backgroundColor: colors.card,
                minHeight: 80,
                textAlignVertical: "top",
              },
            ]}
            multiline
            placeholder="e.g. Applied to kitchen perimeter, avoided food prep surfaces"
            placeholderTextColor={colors.mutedForeground}
            value={applicationNotes}
            onChangeText={setApplicationNotes}
          />
        </View>

        {/* Submit error */}
        {submitError ? (
          <View style={[s.warningBanner, { borderColor: "#f85149", backgroundColor: "rgba(248,81,73,0.08)" }]}>
            <Ionicons name="alert-circle" size={16} color="#f85149" />
            <Text style={{ color: "#f85149", fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}>
              {submitError}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    );
  }

  const stepContent = [
    renderStep0,
    renderStep1,
    renderStep2,
    renderStep3,
    renderStep4,
    renderStep5,
  ];

  const isLastStep = step === TOTAL_STEPS - 1;
  const canAdvance = canProceedStep[step] ?? false;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <Pressable style={s.backdrop} onPress={handleClose}>
          <Pressable
            style={[s.sheet, { backgroundColor: "#0d1117" }]}
            onStartShouldSetResponder={() => true}
          >
            {/* Header */}
            <View style={[s.sheetHeader, { borderBottomColor: "#2d333b" }]}>
              <Pressable onPress={handleBack} hitSlop={12} style={{ padding: 4 }}>
                <Ionicons
                  name={step === 0 ? "close" : "chevron-back"}
                  size={22}
                  color="#8b949e"
                />
              </Pressable>
              <View style={{ flex: 1, gap: 2, alignItems: "center" }}>
                <Text style={s.sheetTitle}>{STEP_TITLES[step]}</Text>
                <Text style={{ color: "#8b949e", fontFamily: "Inter_400Regular", fontSize: 12 }}>
                  Step {step + 1} of {TOTAL_STEPS}
                </Text>
              </View>
              <View style={{ width: 30 }} />
            </View>

            {/* Progress dots */}
            <View style={s.progressRow}>
              {STEP_TITLES.map((_, i) => (
                <View
                  key={i}
                  style={[
                    s.progressDot,
                    {
                      backgroundColor:
                        i < step
                          ? "#17c4d3"
                          : i === step
                            ? "#17c4d3"
                            : "#2d333b",
                      opacity: i <= step ? 1 : 0.4,
                      width: i === step ? 20 : 8,
                    },
                  ]}
                />
              ))}
            </View>

            {/* Step product label (steps 1–5) */}
            {step > 0 && selectedProduct ? (
              <View style={[s.productPill, { backgroundColor: "#161b22", borderColor: "#2d333b" }]}>
                <Ionicons name="flask-outline" size={14} color="#17c4d3" />
                <Text style={{ color: "#e6edf3", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                  {selectedProduct.name}
                </Text>
              </View>
            ) : null}

            {/* Step content */}
            <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 16 }}>
              {stepContent[step]?.()}
            </View>

            {/* Footer */}
            <View style={[s.footer, { borderTopColor: "#2d333b" }]}>
              <Pressable
                onPress={handleNext}
                disabled={!canAdvance || submitting}
                style={[
                  s.nextBtn,
                  {
                    backgroundColor: canAdvance && !submitting ? "#17c4d3" : "#2d333b",
                  },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text
                    style={[
                      s.nextBtnText,
                      { color: canAdvance && !submitting ? "#04181b" : "#6b7280" },
                    ]}
                  >
                    {isLastStep ? "Submit Application Log" : "Next"}
                  </Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepLabel({ text }: { text: string }) {
  return (
    <Text style={{ color: "#e6edf3", fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
      {text}
    </Text>
  );
}

function ErrorBanner({ text }: { text: string }) {
  return (
    <View style={[s.warningBanner, { borderColor: "#f85149", backgroundColor: "rgba(248,81,73,0.08)" }]}>
      <Ionicons name="alert-circle" size={14} color="#f85149" />
      <Text style={{ color: "#f85149", fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={[s.infoCard, { borderColor: "#2d333b", backgroundColor: "#161b22" }]}>
      <Text style={{ color: "#8b949e", fontFamily: "Inter_500Medium", fontSize: 12, marginBottom: 8 }}>
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function BulletRow({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start", paddingVertical: 2 }}>
      <Text style={{ color: "#17c4d3", fontSize: 14, lineHeight: 20 }}>•</Text>
      <Text style={{ color, fontFamily: "Inter_400Regular", fontSize: 14, flex: 1, lineHeight: 20 }}>
        {text}
      </Text>
    </View>
  );
}

function SpecRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 8, paddingVertical: 3 }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13, minWidth: 80 }}>
        {label}
      </Text>
      <Text style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "92%",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 36,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    gap: 8,
  },
  sheetTitle: {
    color: "#e6edf3",
    fontFamily: "Inter_700Bold",
    fontSize: 17,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
  },
  progressDot: {
    height: 8,
    borderRadius: 4,
  },
  productPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 20,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  nextBtn: {
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  nextBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#2d333b",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  chipText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  productCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  productName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  productMeta: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
  },
  signalBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  signalText: {
    color: "#fff",
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 0.5,
  },
  typeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  typeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
  },
  siteOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  siteLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  confirmRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    flexShrink: 0,
  },
  confirmText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  segmentRow: {
    flexDirection: "row",
    borderRadius: 10,
    padding: 3,
  },
  segmentOption: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 8,
  },
  segmentText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  fieldLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
  },
  checklistRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  checklistText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
});
