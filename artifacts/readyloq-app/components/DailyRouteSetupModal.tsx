/**
 * DailyRouteSetupModal — morning route chemical assignment screen.
 *
 * Replaces the old "rig inventory" checkbox list with explicit product→pest
 * pairings. Each assignment tells the system: "I'm using [Product] against
 * [Pest] on today's route." Examples:
 *   - Suspend SC → German Cockroaches
 *   - Termidor NY → Ants
 *   - Contrac Blox → Rodents
 *
 * The technician can free-type the chemical name or pick from the catalogue.
 * This context is then used by:
 *  - TreatmentLogWizard Step 0 "Today's Route" tab (one-tap pre-fill)
 *  - FAIE vision intelligence to verify equipment→product→pest alignment
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { listProducts, type Product } from "@/lib/api-client/products";
import { getDailyRoute } from "@/lib/api-client/daily-route";
import { useColors } from "@/hooks/useColors";
import type { RouteAssignment } from "@/lib/api-client/daily-route";
import { PEST_TYPES } from "@/constants/inspection";

/** Returns yesterday's date as "YYYY-MM-DD" using the device's local clock. */
function yesterdayDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Props {
  visible: boolean;
  initialAssignments?: RouteAssignment[];
  onClose: () => void;
  onSave: (assignments: RouteAssignment[]) => void;
}

type AddStep = "product" | "pest" | "notes";

export function DailyRouteSetupModal({
  visible,
  initialAssignments = [],
  onClose,
  onSave,
}: Props) {
  const colors = useColors();

  // ── Products catalogue ──────────────────────────────────────────────────────
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");

  // ── Current assignment list ─────────────────────────────────────────────────
  const [assignments, setAssignments] = useState<RouteAssignment[]>(initialAssignments);

  // ── In-progress "add assignment" flow ──────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addStep, setAddStep] = useState<AddStep>("product");
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [pendingPest, setPendingPest] = useState<string | null>(null);
  const [pendingNotes, setPendingNotes] = useState("");
  // Allow free-type chemical input (for products not in catalogue)
  const [customChemical, setCustomChemical] = useState("");

  // ── Copy Yesterday's Kit ────────────────────────────────────────────────────
  const [copyingYesterday, setCopyingYesterday] = useState(false);

  // Reset on open
  useEffect(() => {
    if (visible) {
      setAssignments(initialAssignments);
      setAddOpen(false);
      setPendingProduct(null);
      setPendingPest(null);
      setPendingNotes("");
      setCustomChemical("");
      setProductSearch("");
      setFetchError(null);
      setCopyingYesterday(false);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopyYesterday = useCallback(async () => {
    if (copyingYesterday) return;
    setCopyingYesterday(true);
    try {
      const rig = await getDailyRoute(yesterdayDateString());
      if (!rig || rig.assignments.length === 0) {
        Alert.alert(
          "Nothing to copy",
          "You didn't have any chemical assignments yesterday. Add them manually below.",
        );
        return;
      }
      setAssignments(rig.assignments);
    } catch {
      Alert.alert("Error", "Could not load yesterday's kit. Please try again.");
    } finally {
      setCopyingYesterday(false);
    }
  }, [copyingYesterday]);

  // Load product catalogue
  useEffect(() => {
    if (!visible || products.length > 0) return;
    setLoadingProducts(true);
    listProducts()
      .then(setProducts)
      .catch(() => setFetchError("Could not load product catalogue. You can still type a product name."))
      .finally(() => setLoadingProducts(false));
  }, [visible, products.length]);

  const filteredProducts = productSearch.trim()
    ? products.filter((p) =>
        p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
        (p.activeIngredients ?? "").toLowerCase().includes(productSearch.toLowerCase()),
      )
    : products;

  const resetAdd = () => {
    setAddOpen(false);
    setAddStep("product");
    setPendingProduct(null);
    setPendingPest(null);
    setPendingNotes("");
    setCustomChemical("");
    setProductSearch("");
  };

  const startAdd = () => {
    setAddStep("product");
    setAddOpen(true);
  };

  const selectProduct = (product: Product) => {
    setPendingProduct(product);
    setCustomChemical("");
    setAddStep("pest");
  };

  const useCustomChemical = () => {
    if (!customChemical.trim()) return;
    // Represent a free-typed chemical as productId = 0 with the name as notes
    // until it can be matched to a catalogue entry.
    setPendingProduct({ id: 0, name: customChemical.trim() } as Product);
    setAddStep("pest");
  };

  const selectPest = (pest: string) => {
    setPendingPest(pest);
    setAddStep("notes");
  };

  const commitAssignment = useCallback(() => {
    if (!pendingProduct || !pendingPest) return;
    const assignment: RouteAssignment = {
      productId: pendingProduct.id,
      targetPest: pendingPest,
      notes: pendingNotes.trim() || undefined,
    };
    setAssignments((prev) => [...prev, assignment]);
    resetAdd();
  }, [pendingProduct, pendingPest, pendingNotes]);

  const removeAssignment = (idx: number) => {
    setAssignments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = () => {
    onSave(assignments);
    onClose();
  };

  const getProductName = (a: RouteAssignment) => {
    const found = products.find((p) => p.id === a.productId);
    if (found) return found.name;
    if (a.notes?.startsWith("__custom__")) return a.notes.replace("__custom__", "");
    return `Product #${a.productId}`;
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 14,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            gap: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>
              Today's route chemicals
            </Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 }}>
              Assign a product to each pest target on today's route
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 10 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Current assignments */}
          {assignments.length === 0 && !addOpen ? (
            <View style={{ gap: 10 }}>
              {/* Empty state */}
              <View
                style={{
                  padding: 20,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderStyle: "dashed",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Ionicons name="flask-outline" size={28} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14, textAlign: "center" }}>
                  No chemicals assigned yet.{"\n"}Add a product for each pest you're treating today.
                </Text>
              </View>

              {/* Copy Yesterday's Kit — one-tap shortcut */}
              <Pressable
                onPress={() => { void handleCopyYesterday(); }}
                disabled={copyingYesterday}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  paddingVertical: 13,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.primary + "55",
                  backgroundColor: colors.primary + "0C",
                  gap: 8,
                  opacity: pressed || copyingYesterday ? 0.7 : 1,
                })}
              >
                {copyingYesterday ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="copy-outline" size={16} color={colors.primary} />
                )}
                <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                  {copyingYesterday ? "Loading yesterday's kit…" : "Copy Yesterday's Kit"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {assignments.map((a, idx) => {
            const name = getProductName(a);
            return (
              <View
                key={idx}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 14,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.primary + "55",
                  backgroundColor: colors.primary + "0A",
                  gap: 10,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                      {name}
                    </Text>
                    <Ionicons name="arrow-forward" size={12} color={colors.mutedForeground} />
                    <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                      {a.targetPest}
                    </Text>
                  </View>
                  {a.notes ? (
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                      {a.notes}
                    </Text>
                  ) : null}
                </View>
                <Pressable onPress={() => removeAssignment(idx)} hitSlop={10}>
                  <Ionicons name="close-circle" size={20} color={colors.mutedForeground} />
                </Pressable>
              </View>
            );
          })}

          {/* ── Add assignment flow ─────────────────────────────────────────── */}
          {!addOpen ? (
            <Pressable
              onPress={startAdd}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                borderStyle: "dashed",
                gap: 8,
              }}
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
              <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                Add chemical assignment
              </Text>
            </Pressable>
          ) : (
            <View
              style={{
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                overflow: "hidden",
              }}
            >
              {/* Step indicator */}
              <View style={{ flexDirection: "row", backgroundColor: colors.muted, padding: 12, gap: 8 }}>
                {(["product", "pest", "notes"] as AddStep[]).map((s, i) => {
                  const done =
                    (s === "product" && (pendingProduct != null)) ||
                    (s === "pest" && pendingPest != null);
                  const active = addStep === s;
                  return (
                    <View
                      key={s}
                      style={{
                        flex: 1,
                        height: 3,
                        borderRadius: 2,
                        backgroundColor: done
                          ? colors.primary
                          : active
                            ? colors.primary + "80"
                            : colors.border,
                      }}
                    />
                  );
                })}
              </View>

              <View style={{ padding: 16, gap: 14 }}>
                {/* Step 1: Pick product */}
                {addStep === "product" ? (
                  <>
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
                      Which chemical?
                    </Text>

                    {/* Free-type input */}
                    <View style={{ gap: 6 }}>
                      <TextInput
                        value={customChemical}
                        onChangeText={setCustomChemical}
                        placeholder="Type a chemical name (e.g. Suspend SC)"
                        placeholderTextColor={colors.mutedForeground}
                        style={{
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 10,
                          paddingHorizontal: 14,
                          paddingVertical: 11,
                          color: colors.foreground,
                          fontFamily: "Inter_400Regular",
                          fontSize: 15,
                        }}
                      />
                      {customChemical.trim().length > 2 ? (
                        <Pressable
                          onPress={useCustomChemical}
                          style={{
                            paddingVertical: 10,
                            borderRadius: 8,
                            backgroundColor: colors.primary,
                            alignItems: "center",
                          }}
                        >
                          <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                            Use "{customChemical.trim()}"
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>

                    {/* Catalogue search */}
                    <View style={{ gap: 8 }}>
                      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                        OR PICK FROM CATALOGUE
                      </Text>
                      <TextInput
                        value={productSearch}
                        onChangeText={setProductSearch}
                        placeholder="Search catalogue…"
                        placeholderTextColor={colors.mutedForeground}
                        style={{
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 8,
                          paddingHorizontal: 12,
                          paddingVertical: 9,
                          color: colors.foreground,
                          fontFamily: "Inter_400Regular",
                          fontSize: 14,
                        }}
                      />
                      {loadingProducts ? (
                        <ActivityIndicator color={colors.primary} />
                      ) : fetchError ? (
                        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular" }}>
                          {fetchError}
                        </Text>
                      ) : (
                        filteredProducts.slice(0, 8).map((p) => (
                          <Pressable
                            key={p.id}
                            onPress={() => selectProduct(p)}
                            style={{
                              paddingVertical: 10,
                              paddingHorizontal: 12,
                              borderRadius: 8,
                              borderWidth: 1,
                              borderColor: colors.border,
                              backgroundColor: colors.background,
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                                {p.name}
                              </Text>
                              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }} numberOfLines={1}>
                                {p.activeIngredients}
                              </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={14} color={colors.mutedForeground} />
                          </Pressable>
                        ))
                      )}
                    </View>
                  </>
                ) : null}

                {/* Step 2: Pick pest */}
                {addStep === "pest" ? (
                  <>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                      <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                        {pendingProduct?.name}
                      </Text>
                    </View>
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
                      For which pest?
                    </Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {PEST_TYPES.map((pest) => (
                        <Pressable
                          key={pest}
                          onPress={() => selectPest(pest)}
                          style={{
                            paddingHorizontal: 14,
                            paddingVertical: 9,
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: pendingPest === pest ? colors.primary : colors.border,
                            backgroundColor: pendingPest === pest ? colors.primary + "22" : colors.card,
                          }}
                        >
                          <Text style={{
                            color: pendingPest === pest ? colors.primary : colors.foreground,
                            fontFamily: "Inter_500Medium",
                            fontSize: 13,
                          }}>
                            {pest}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : null}

                {/* Step 3: Optional notes + confirm */}
                {addStep === "notes" ? (
                  <>
                    <View style={{ gap: 4 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                        <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                          {pendingProduct?.name} → {pendingPest}
                        </Text>
                      </View>
                    </View>
                    <View style={{ gap: 6 }}>
                      <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}>
                        Notes <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>(optional)</Text>
                      </Text>
                      <TextInput
                        value={pendingNotes}
                        onChangeText={setPendingNotes}
                        placeholder="e.g. kitchen drains, perimeter only, bait stations"
                        placeholderTextColor={colors.mutedForeground}
                        style={{
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 10,
                          paddingHorizontal: 14,
                          paddingVertical: 11,
                          color: colors.foreground,
                          fontFamily: "Inter_400Regular",
                          fontSize: 14,
                        }}
                      />
                    </View>
                    <Pressable
                      onPress={commitAssignment}
                      style={{
                        paddingVertical: 13,
                        borderRadius: 10,
                        backgroundColor: colors.primary,
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_700Bold", fontSize: 15 }}>
                        Add to route
                      </Text>
                    </Pressable>
                  </>
                ) : null}

                {/* Cancel add */}
                <Pressable onPress={resetAdd}>
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center" }}>
                    Cancel
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Footer */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: 28,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            gap: 10,
          }}
        >
          <Pressable
            onPress={handleSave}
            disabled={assignments.length === 0}
            style={{
              paddingVertical: 15,
              borderRadius: 12,
              alignItems: "center",
              backgroundColor: assignments.length === 0 ? colors.primary + "55" : colors.primary,
            }}
          >
            <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_700Bold", fontSize: 16 }}>
              {assignments.length === 0
                ? "Add at least one assignment"
                : `Save ${assignments.length} assignment${assignments.length !== 1 ? "s" : ""}`}
            </Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            style={{
              paddingVertical: 12,
              borderRadius: 12,
              alignItems: "center",
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 14 }}>
              Cancel
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
