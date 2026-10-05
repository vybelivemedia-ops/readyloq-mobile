/**
 * Inventory baseline setup — first-time flow to count what's in the truck/bag.
 *
 * Shows the product catalog with a quantity input for each product.
 * Submits all at once via POST /technician/inventory/baseline.
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Screen } from "@/components/ui/Screen";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useColors } from "@/hooks/useColors";
import { listProducts, type Product } from "@/lib/api-client/products";
import { setInventoryBaseline } from "@/lib/api-client/inventory";

export default function InventoryBaselineScreen() {
  const colors = useColors();
  const router = useRouter();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // qty map: productId → { qty: string; unit: string }
  const [quantities, setQuantities] = useState<Record<number, { qty: string; unit: string }>>({});

  useEffect(() => {
    listProducts()
      .then(setProducts)
      .catch(() => Alert.alert("Error", "Could not load product catalog."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = search.trim()
    ? products.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.activeIngredients ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : products;

  const setQty = (productId: number, qty: string) => {
    setQuantities((prev) => ({
      ...prev,
      [productId]: { qty, unit: prev[productId]?.unit ?? "unit" },
    }));
  };

  const setUnit = (productId: number, unit: string) => {
    setQuantities((prev) => ({
      ...prev,
      [productId]: { qty: prev[productId]?.qty ?? "0", unit },
    }));
  };

  const countFilled = Object.values(quantities).filter(
    (v) => parseFloat(v.qty) > 0,
  ).length;

  const handleSave = async () => {
    const items = Object.entries(quantities)
      .map(([id, v]) => ({
        productId: parseInt(id),
        quantityOnHand: parseFloat(v.qty) || 0,
        unit: v.unit || "unit",
      }))
      .filter((i) => i.quantityOnHand > 0);

    if (items.length === 0) {
      Alert.alert(
        "No quantities entered",
        "Enter a quantity for at least one product to save your baseline.",
      );
      return;
    }

    setSaving(true);
    try {
      await setInventoryBaseline(items);
      Alert.alert(
        "Inventory saved",
        `${items.length} product${items.length !== 1 ? "s" : ""} added to your inventory.`,
        [{ text: "OK", onPress: () => router.replace("/inventory") }],
      );
    } catch {
      Alert.alert("Error", "Could not save inventory. Please try again.");
    } finally {
      setSaving(false);
    }
  };

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
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.foreground} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>
              Inventory setup
            </Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
              Count what's in your truck or bag right now
            </Text>
          </View>
        </View>

        {countFilled > 0 && (
          <View
            style={{
              marginTop: 8,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 8,
              backgroundColor: colors.primary + "18",
            }}
          >
            <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
              {countFilled} product{countFilled !== 1 ? "s" : ""} with quantity entered
            </Text>
          </View>
        )}

        {/* Search */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 8,
            backgroundColor: colors.muted,
            borderRadius: 10,
            paddingHorizontal: 12,
            gap: 8,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Ionicons name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search products…"
            placeholderTextColor={colors.mutedForeground}
            style={{
              flex: 1,
              paddingVertical: 10,
              color: colors.foreground,
              fontFamily: "Inter_400Regular",
              fontSize: 14,
            }}
          />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120, gap: 8 }}>
        {filtered.map((product) => {
          const entry = quantities[product.id];
          const hasQty = entry && parseFloat(entry.qty) > 0;
          return (
            <Card
              key={product.id}
              style={{
                padding: 14,
                borderColor: hasQty ? colors.primary + "55" : colors.border,
                backgroundColor: hasQty ? colors.primary + "06" : colors.card,
              }}
            >
              <View style={{ gap: 10 }}>
                <View>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                    {product.name}
                  </Text>
                  {product.activeIngredients ? (
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 }}>
                      {product.activeIngredients}
                    </Text>
                  ) : null}
                  {product.epaRegistrationNumber ? (
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
                      EPA {product.epaRegistrationNumber}
                    </Text>
                  ) : null}
                </View>
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <View style={{ flex: 2, gap: 4 }}>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
                      Quantity on hand
                    </Text>
                    <TextInput
                      value={entry?.qty ?? ""}
                      onChangeText={(v) => setQty(product.id, v)}
                      placeholder="0"
                      keyboardType="numeric"
                      placeholderTextColor={colors.mutedForeground}
                      style={{
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 8,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        color: colors.foreground,
                        fontFamily: "Inter_400Regular",
                        fontSize: 15,
                      }}
                    />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
                      Unit
                    </Text>
                    <TextInput
                      value={entry?.unit ?? ""}
                      onChangeText={(v) => setUnit(product.id, v)}
                      placeholder="oz"
                      placeholderTextColor={colors.mutedForeground}
                      style={{
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 8,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        color: colors.foreground,
                        fontFamily: "Inter_400Regular",
                        fontSize: 15,
                      }}
                    />
                  </View>
                </View>
              </View>
            </Card>
          );
        })}
      </ScrollView>

      {/* Sticky footer */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: 32,
          backgroundColor: colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          gap: 10,
        }}
      >
        <Button
          onPress={handleSave}
          disabled={saving || countFilled === 0}
          title={
            saving
              ? "Saving…"
              : countFilled === 0
                ? "Enter quantities above to save"
                : `Save ${countFilled} product${countFilled !== 1 ? "s" : ""} to inventory`
          }
        />
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: colors.mutedForeground, textAlign: "center", fontFamily: "Inter_400Regular", fontSize: 14 }}>
            Skip for now
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}
