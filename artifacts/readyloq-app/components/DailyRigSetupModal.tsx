/**
 * DailyRigSetupModal — morning setup screen for the technician's daily rig.
 *
 * Shows the full company product catalogue as a multi-select checklist.
 * The technician picks 3–5 products loaded on their truck; these become the
 * "Today's Rig" quick-pick in the treatment log wizard throughout the day.
 *
 * Saves to AsyncStorage immediately; background-syncs to the server when online.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { listProducts, type Product } from "@/lib/api-client/products";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  /** Currently selected product IDs (from the existing rig, if any). */
  initialProductIds?: number[];
  onClose: () => void;
  /** Called with the confirmed product ID list. */
  onSave: (productIds: number[]) => void;
}

const RECOMMENDED_MAX = 5;

export function DailyRigSetupModal({
  visible,
  initialProductIds = [],
  onClose,
  onSave,
}: Props) {
  const colors = useColors();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set(initialProductIds));

  // Reset selection to match prop when modal opens.
  useEffect(() => {
    if (visible) {
      setSelected(new Set(initialProductIds));
      setFetchError(null);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch product catalogue on first open.
  useEffect(() => {
    if (!visible || products.length > 0) return;
    setLoading(true);
    listProducts()
      .then(setProducts)
      .catch(() => setFetchError("Could not load products. Check your connection."))
      .finally(() => setLoading(false));
  }, [visible, products.length]);

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSave = () => {
    onSave(Array.from(selected));
    onClose();
  };

  const tooMany = selected.size > RECOMMENDED_MAX;

  const renderProduct = ({ item }: { item: Product }) => {
    const isSelected = selected.has(item.id);
    return (
      <Pressable
        onPress={() => toggle(item.id)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 12,
          paddingHorizontal: 4,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          gap: 12,
        }}
      >
        {/* Checkbox */}
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: isSelected ? colors.primary : colors.mutedForeground,
            backgroundColor: isSelected ? colors.primary : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isSelected ? (
            <Ionicons name="checkmark" size={13} color={colors.primaryForeground} />
          ) : null}
        </View>

        {/* Product info */}
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 14,
            }}
          >
            {item.name}
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
            }}
            numberOfLines={1}
          >
            {item.activeIngredients}
          </Text>
        </View>

        {/* Badges */}
        <View style={{ gap: 4, alignItems: "flex-end" }}>
          {item.signalWord && item.signalWord !== "NONE" ? (
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 4,
                backgroundColor:
                  item.signalWord === "DANGER"
                    ? "#ef4444"
                    : item.signalWord === "WARNING"
                      ? "#f59e0b"
                      : "#d29922",
              }}
            >
              <Text
                style={{
                  color: "#fff",
                  fontFamily: "Inter_700Bold",
                  fontSize: 9,
                  letterSpacing: 0.5,
                }}
              >
                {item.signalWord}
              </Text>
            </View>
          ) : null}
          {item.productType === "restricted-use" ? (
            <Text
              style={{
                color: "#f85149",
                fontFamily: "Inter_600SemiBold",
                fontSize: 10,
              }}
            >
              RUP
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

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
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_700Bold",
                fontSize: 20,
              }}
            >
              Today's rig
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 13,
                marginTop: 2,
              }}
            >
              Select the products on your truck today
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* Selection count pill */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 20,
            paddingVertical: 10,
            gap: 8,
          }}
        >
          <View
            style={{
              paddingHorizontal: 12,
              paddingVertical: 5,
              borderRadius: 999,
              backgroundColor: selected.size > 0 ? colors.primary + "22" : colors.card,
              borderWidth: 1,
              borderColor: selected.size > 0 ? colors.primary : colors.border,
            }}
          >
            <Text
              style={{
                color: selected.size > 0 ? colors.primary : colors.mutedForeground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 13,
              }}
            >
              {selected.size} product{selected.size !== 1 ? "s" : ""} selected
            </Text>
          </View>
          {tooMany ? (
            <Text
              style={{
                color: "#f59e0b",
                fontFamily: "Inter_400Regular",
                fontSize: 12,
                flex: 1,
              }}
            >
              3–5 recommended for a full day route
            </Text>
          ) : null}
        </View>

        {/* Product list */}
        {loading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
            <ActivityIndicator color={colors.primary} />
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 14,
              }}
            >
              Loading products…
            </Text>
          </View>
        ) : fetchError ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}>
            <Ionicons name="cloud-offline-outline" size={36} color={colors.mutedForeground} />
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 14,
                textAlign: "center",
              }}
            >
              {fetchError}
            </Text>
          </View>
        ) : (
          <FlatList
            data={products}
            keyExtractor={(p) => String(p.id)}
            renderItem={renderProduct}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}
          />
        )}

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
            disabled={selected.size === 0}
            style={{
              paddingVertical: 15,
              borderRadius: 12,
              alignItems: "center",
              backgroundColor: selected.size === 0 ? colors.primary + "66" : colors.primary,
            }}
          >
            <Text
              style={{
                color: colors.primaryForeground,
                fontFamily: "Inter_700Bold",
                fontSize: 16,
              }}
            >
              {selected.size === 0
                ? "Select products to continue"
                : `Load ${selected.size} product${selected.size !== 1 ? "s" : ""} onto rig`}
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
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_500Medium",
                fontSize: 14,
              }}
            >
              Cancel
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
