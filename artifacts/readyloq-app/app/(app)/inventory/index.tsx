/**
 * Inventory screen — technician's on-hand chemical stock.
 *
 * Shows each product with quantity on hand and a quick +/- adjuster.
 * Owners and managers can access this from Settings to view a tech's profile;
 * technicians reach it from their own Settings entry.
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "@clerk/expo";
import { Screen } from "@/components/ui/Screen";
import { Card } from "@/components/ui/Card";
import { useColors } from "@/hooks/useColors";
import {
  getMyInventory,
  getMyStockHealth,
  logRestockEvent,
  updateInventoryItem,
  type InventoryProduct,
  type TruckStockHealth,
} from "@/lib/api-client/inventory";
import { getRouteReadiness, type RouteReadiness } from "@/lib/api-client/daily-route";
import { listProducts, type Product } from "@/lib/api-client/products";

// ─── Formatting helpers ────────────────────────────────────────────────────────

function formatLastApplied(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}

// ─── Route Readiness banner ───────────────────────────────────────────────────
//
// "Today's Route Readiness" — a TODAY-scoped signal: will the technician run
// out of a product they've declared on today's rig, given the stops on
// today's schedule? Visually distinct (red, alert-circle) from the amber
// "trending" Stock Health tag rendered per-product below, since the two are
// deliberately not blended into one score.

function RouteReadinessBanner({ readiness }: { readiness: RouteReadiness | null }) {
  const colors = useColors();
  if (!readiness) return null;

  if (readiness.overallStatus === "not-set-up") {
    return (
      <Card style={{ marginHorizontal: 16, marginBottom: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Ionicons name="clipboard-outline" size={18} color={colors.mutedForeground} />
        <Text style={{ flex: 1, color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
          Set up today's route rig to see your Route Readiness.
        </Text>
      </Card>
    );
  }

  const shortProducts = readiness.products.filter((p) => p.status === "short");

  if (readiness.overallStatus === "short") {
    return (
      <Card style={{ marginHorizontal: 16, marginBottom: 12, padding: 14, gap: 8, borderColor: "#ef4444", borderWidth: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="alert-circle" size={18} color="#ef4444" />
          <Text style={{ color: "#ef4444", fontFamily: "Inter_700Bold", fontSize: 14 }}>
            Short on stock for today's route
          </Text>
        </View>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
          {readiness.stopCount} stop{readiness.stopCount !== 1 ? "s" : ""} scheduled today
        </Text>
        {shortProducts.map((p) => (
          <Text key={p.productId} style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
            • {p.productName}: {p.quantityOnHand.toFixed(1)} {p.unit} on hand, ~{p.expectedUsageToday?.toFixed(1)} {p.unit} expected
          </Text>
        ))}
      </Card>
    );
  }

  return (
    <Card style={{ marginHorizontal: 16, marginBottom: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
      <Text style={{ flex: 1, color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
        Ready for today's route — {readiness.stopCount} stop{readiness.stopCount !== 1 ? "s" : ""} scheduled
      </Text>
    </Card>
  );
}

// ─── Restock modal ────────────────────────────────────────────────────────────

function RestockModal({
  product,
  onClose,
  onSaved,
}: {
  product: InventoryProduct;
  onClose: () => void;
  onSaved: () => void;
}) {
  const colors = useColors();
  const [qty, setQty] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const amount = parseFloat(qty);
    if (Number.isNaN(amount) || amount <= 0) {
      Alert.alert("Invalid quantity", "Enter a positive number.");
      return;
    }
    setSaving(true);
    try {
      await logRestockEvent({
        productId: product.productId,
        quantityReceived: amount,
        unit: product.unit,
        source: "manual",
      });
      onSaved();
      onClose();
    } catch {
      Alert.alert("Error", "Could not log restock. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        justifyContent: "flex-end",
      }}
    >
      <View
        style={{
          backgroundColor: colors.background,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          padding: 24,
          gap: 16,
        }}
      >
        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}>
          Log restock — {product.productName}
        </Text>
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
            Quantity received ({product.unit})
          </Text>
          <TextInput
            value={qty}
            onChangeText={setQty}
            placeholder="e.g. 32"
            keyboardType="numeric"
            placeholderTextColor={colors.mutedForeground}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 10,
              padding: 12,
              color: colors.foreground,
              fontFamily: "Inter_400Regular",
              fontSize: 16,
            }}
          />
        </View>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={({ pressed }) => ({
            paddingVertical: 14,
            borderRadius: 12,
            alignItems: "center",
            backgroundColor: colors.primary,
            opacity: pressed || saving ? 0.7 : 1,
          })}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 }}>
              Add to inventory
            </Text>
          )}
        </Pressable>
        <Pressable onPress={onClose}>
          <Text style={{ color: colors.mutedForeground, textAlign: "center", fontFamily: "Inter_400Regular" }}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Add product modal ────────────────────────────────────────────────────────

function AddProductModal({
  existing,
  onClose,
  onAdded,
}: {
  existing: InventoryProduct[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const colors = useColors();
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Product | null>(null);
  const [qty, setQty] = useState("0");
  const [unit, setUnit] = useState("unit");
  const [threshold, setThreshold] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    listProducts()
      .then((p) => {
        const existingIds = new Set(existing.map((e) => e.productId));
        setAllProducts(p.filter((pr) => !existingIds.has(pr.id)));
      })
      .catch(() => Alert.alert("Error", "Could not load product catalog."))
      .finally(() => setLoading(false));
  }, [existing]);

  const filtered = search.trim()
    ? allProducts.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()),
      )
    : allProducts;

  const handleAdd = async () => {
    if (!selected) return;
    const amount = parseFloat(qty);
    if (Number.isNaN(amount) || amount < 0) {
      Alert.alert("Invalid quantity", "Enter 0 or more.");
      return;
    }
    const thresholdNum = threshold.trim() ? parseFloat(threshold) : null;
    if (threshold.trim() && (Number.isNaN(thresholdNum!) || thresholdNum! < 0)) {
      Alert.alert("Invalid threshold", "Enter 0 or more, or leave blank.");
      return;
    }
    setSaving(true);
    try {
      await updateInventoryItem(selected.id, amount, unit, thresholdNum);
      onAdded();
      onClose();
    } catch {
      Alert.alert("Error", "Could not add product. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        justifyContent: "flex-end",
      }}
    >
      <View
        style={{
          backgroundColor: colors.background,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          padding: 24,
          gap: 16,
          maxHeight: "85%",
        }}
      >
        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}>
          Add product to inventory
        </Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : selected ? (
          <>
            <View
              style={{
                padding: 12,
                borderRadius: 10,
                backgroundColor: colors.primary + "15",
                borderWidth: 1,
                borderColor: colors.primary + "40",
              }}
            >
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
                {selected.name}
              </Text>
              {selected.activeIngredients ? (
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 }}>
                  {selected.activeIngredients}
                </Text>
              ) : null}
            </View>
            <View style={{ gap: 6 }}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                Starting quantity on hand
              </Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TextInput
                  value={qty}
                  onChangeText={setQty}
                  keyboardType="numeric"
                  placeholderTextColor={colors.mutedForeground}
                  style={{
                    flex: 2,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                    padding: 12,
                    color: colors.foreground,
                    fontFamily: "Inter_400Regular",
                    fontSize: 16,
                  }}
                />
                <TextInput
                  value={unit}
                  onChangeText={setUnit}
                  placeholder="unit"
                  placeholderTextColor={colors.mutedForeground}
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                    padding: 12,
                    color: colors.foreground,
                    fontFamily: "Inter_400Regular",
                    fontSize: 16,
                  }}
                />
              </View>
            </View>
            <View style={{ gap: 6 }}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                Restock alert threshold{" "}
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                  (optional)
                </Text>
              </Text>
              <TextInput
                value={threshold}
                onChangeText={setThreshold}
                keyboardType="numeric"
                placeholder="e.g. 32"
                placeholderTextColor={colors.mutedForeground}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 10,
                  padding: 12,
                  color: colors.foreground,
                  fontFamily: "Inter_400Regular",
                  fontSize: 16,
                }}
              />
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
                Managers are alerted when your on-hand quantity drops below this amount.
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => setSelected(null)}
                style={({ pressed }) => ({
                  flex: 1,
                  paddingVertical: 13,
                  borderRadius: 12,
                  alignItems: "center",
                  backgroundColor: colors.muted,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}>
                  Back
                </Text>
              </Pressable>
              <Pressable
                onPress={handleAdd}
                disabled={saving}
                style={({ pressed }) => ({
                  flex: 2,
                  paddingVertical: 13,
                  borderRadius: 12,
                  alignItems: "center",
                  backgroundColor: colors.primary,
                  opacity: pressed || saving ? 0.7 : 1,
                })}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 }}>
                    Add to inventory
                  </Text>
                )}
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search products…"
              placeholderTextColor={colors.mutedForeground}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                padding: 12,
                color: colors.foreground,
                fontFamily: "Inter_400Regular",
                fontSize: 14,
              }}
            />
            <ScrollView style={{ maxHeight: 280 }}>
              {filtered.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => setSelected(p)}
                  style={({ pressed }) => ({
                    paddingVertical: 12,
                    paddingHorizontal: 4,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}>
                    {p.name}
                  </Text>
                  {p.activeIngredients ? (
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                      {p.activeIngredients}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
              {filtered.length === 0 && (
                <Text style={{ color: colors.mutedForeground, textAlign: "center", padding: 20, fontFamily: "Inter_400Regular" }}>
                  No products found.
                </Text>
              )}
            </ScrollView>
          </>
        )}
        <Pressable onPress={onClose}>
          <Text style={{ color: colors.mutedForeground, textAlign: "center", fontFamily: "Inter_400Regular" }}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────="────────────────────────────────────

export default function InventoryScreen() {
  const colors = useColors();
  const router = useRouter();

  const [inventory, setInventory] = useState<InventoryProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restockTarget, setRestockTarget] = useState<InventoryProduct | null>(null);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [routeReadiness, setRouteReadiness] = useState<RouteReadiness | null>(null);
  const [stockHealth, setStockHealth] = useState<TruckStockHealth | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getMyInventory();
      setInventory(data);
    } catch {
      Alert.alert("Error", "Could not load inventory.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // Route Readiness and Stock Health are best-effort supplementary signals —
    // a failure to load either must never block the core inventory list.
    try {
      setRouteReadiness(await getRouteReadiness());
    } catch {
      setRouteReadiness(null);
    }
    try {
      setStockHealth(await getMyStockHealth());
    } catch {
      setStockHealth(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const totalProducts = inventory.length;
  const zeroStock = inventory.filter((i) => i.quantityOnHand <= 0).length;

  if (loading) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>My Inventory</Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
            {totalProducts} products · {zeroStock > 0 ? `${zeroStock} out of stock` : "all stocked"}
          </Text>
        </View>
        <Pressable
          onPress={() => setShowAddProduct(true)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 10,
            backgroundColor: colors.primary,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
            Add product
          </Text>
        </Pressable>
      </View>

      {inventory.length > 0 && <RouteReadinessBanner readiness={routeReadiness} />}

      {inventory.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
          <Ionicons name="flask-outline" size={48} color={colors.mutedForeground} />
          <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 18, textAlign: "center" }}>
            No products yet
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14, textAlign: "center" }}>
            Add the chemicals and supplies you carry on your route.
          </Text>
          <Pressable
            onPress={() => router.push("/inventory/baseline")}
            style={({ pressed }) => ({
              marginTop: 8,
              paddingHorizontal: 24,
              paddingVertical: 13,
              borderRadius: 12,
              backgroundColor: colors.primary,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 }}>
              Set up my inventory
            </Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {inventory.map((item) => {
            const health = stockHealth?.items.find((h) => h.productId === item.productId) ?? null;
            const readinessProduct = routeReadiness?.products.find((p) => p.productId === item.productId) ?? null;
            const shortToday = readinessProduct?.status === "short";
            return (
              <Card key={item.productId} style={{ padding: 0, overflow: "hidden" }}>
                <View style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 12 }}>
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 10,
                      backgroundColor: item.quantityOnHand <= 0 ? "#ef444420" : colors.primary + "18",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons
                      name="flask"
                      size={20}
                      color={item.quantityOnHand <= 0 ? "#ef4444" : colors.primary}
                    />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                      {item.productName}
                    </Text>
                    {item.epaRegistrationNumber ? (
                      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
                        EPA {item.epaRegistrationNumber}
                      </Text>
                    ) : null}
                    {item.lastAppliedAt ? (
                      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
                        Last applied: {formatLastApplied(item.lastAppliedAt)}
                        {item.lastAppliedOz != null
                          ? ` — ${item.lastAppliedOz % 1 === 0 ? item.lastAppliedOz.toFixed(0) : item.lastAppliedOz.toFixed(1)} oz`
                          : ""}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                      {shortToday && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#ef444420", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Ionicons name="alert-circle" size={11} color="#ef4444" />
                          <Text style={{ color: "#ef4444", fontFamily: "Inter_600SemiBold", fontSize: 10 }}>Short today</Text>
                        </View>
                      )}
                      {health?.status === "trending-short" && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#f59e0b20", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Ionicons name="trending-down" size={11} color="#f59e0b" />
                          <Text style={{ color: "#f59e0b", fontFamily: "Inter_600SemiBold", fontSize: 10 }}>
                            ~{health.projectedDaysCoverage?.toFixed(0)}d coverage left
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={{
                      color: item.quantityOnHand <= 0 ? "#ef4444" : colors.foreground,
                      fontFamily: "Inter_700Bold",
                      fontSize: 18,
                    }}>
                      {item.quantityOnHand % 1 === 0 ? item.quantityOnHand.toFixed(0) : item.quantityOnHand.toFixed(1)}
                    </Text>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                      {item.unit}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setRestockTarget(item)}
                    style={({ pressed }) => ({
                      padding: 8,
                      borderRadius: 8,
                      backgroundColor: colors.primary + "18",
                      opacity: pressed ? 0.7 : 1,
                    })}
                    hitSlop={6}
                  >
                    <Ionicons name="add" size={18} color={colors.primary} />
                  </Pressable>
                </View>
              </Card>
            );
          })}
        </ScrollView>
      )}

      {restockTarget && (
        <RestockModal
          product={restockTarget}
          onClose={() => setRestockTarget(null)}
          onSaved={() => void load()}
        />
      )}

      {showAddProduct && (
        <AddProductModal
          existing={inventory}
          onClose={() => setShowAddProduct(false)}
          onAdded={() => void load()}
        />
      )}
    </Screen>
  );
}
