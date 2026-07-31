/**
 * Billing screen — ReadyLoq
 *
 * Accessible from the Owner dashboard. Shows the company's current
 * subscription status, seat count, and provides quick actions:
 *
 *   • Upgrade to Solo Operator or Growth Team via Stripe Checkout
 *   • Manage existing subscription via Stripe Customer Portal
 *   • Adjust seat count (Growth Team only)
 *
 * Checkout and portal sessions open in the device browser via Expo.
 * All mutations are Owner-only; the screen is reached through the owner
 * dashboard and is not listed in the tab bar for other roles.
 */

import { useAuth, useUser } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useLicenseStatus } from "@/hooks/useLicenseStatus";
import { API_BASE } from "@/lib/api";

// ─── Pricing constants (mirrors seed-products.ts) ────────────────────────────

const PLANS = {
  solo: {
    name: "Solo Operator",
    tagline: "Full AI platform · 1 seat",
    monthly: "$69/mo",
    yearly: "$690/yr",
    features: [
      "FAIE Vision AI analysis",
      "Offline sync",
      "Single-operator dashboard",
      "Customer report generation",
      "Unlimited inspections",
    ],
  },
  growth: {
    name: "Growth Team",
    tagline: "$129 base + $39/seat · unlimited scale",
    monthly: "$129/mo base",
    yearly: "$1,290/yr base",
    perSeat: { monthly: "$39/mo", yearly: "$390/yr" },
    features: [
      "All Solo Operator features",
      "Owner, Manager, Sales Lead & Tech roles",
      "Pipeline tracking & hot-zone mapping",
      "Team performance analytics",
      "Manager review queue",
    ],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function startCheckout(
  token: string | null,
  body: {
    tier: "solo" | "growth";
    period: "monthly" | "yearly";
    seats?: number;
    email: string;
  },
): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/billing/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Checkout failed (${res.status})`);
  }
  const { url } = (await res.json()) as { url: string };
  return url;
}

async function openPortal(token: string | null): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/billing/portal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Portal failed (${res.status})`);
  }
  const { url } = (await res.json()) as { url: string };
  return url;
}

async function updateSeats(token: string | null, seats: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/billing/seats`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ seats }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Seat update failed (${res.status})`);
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ isActive, status }: { isActive: boolean; status: string | null }) {
  const colors = useColors();
  const label =
    status === "active"   ? "Active"
    : status === "trialing" ? "Trial"
    : status === "past_due" ? "Payment due"
    : status === "canceled" ? "Canceled"
    : "No subscription";

  const color =
    isActive            ? (colors.success ?? "#16a34a")
    : status === "past_due" ? (colors.warning ?? "#d97706")
    : colors.mutedForeground;

  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 20,
        backgroundColor: color + "22",
        alignSelf: "flex-start",
      }}
    >
      <Text style={{ color, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function FeatureList({ features }: { features: string[] }) {
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      {features.map((f) => (
        <View key={f} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success ?? "#16a34a"} />
          <Text style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}>
            {f}
          </Text>
        </View>
      ))}
    </View>
  );
}

function PlanCard({
  tier,
  period,
  onSubscribe,
  isCurrent,
}: {
  tier: "solo" | "growth";
  period: "monthly" | "yearly";
  onSubscribe: (tier: "solo" | "growth") => void;
  isCurrent: boolean;
}) {
  const colors = useColors();
  const plan = PLANS[tier];
  const price = tier === "solo"
    ? (period === "monthly" ? plan.monthly : plan.yearly)
    : (period === "monthly" ? plan.monthly : plan.yearly);

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 17 }}>
            {plan.name}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 }}>
            {plan.tagline}
          </Text>
        </View>
        {isCurrent && (
          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: colors.primary + "22" }}>
            <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 11 }}>Current</Text>
          </View>
        )}
      </View>

      <Text style={{ color: colors.primary, fontFamily: "Inter_700Bold", fontSize: 22 }}>
        {price}
        {tier === "growth" && (
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
            {"  "}+{" "}
            {period === "monthly"
              ? PLANS.growth.perSeat!.monthly
              : PLANS.growth.perSeat!.yearly}{" "}
            per additional seat
          </Text>
        )}
      </Text>

      <FeatureList features={plan.features} />

      {!isCurrent && (
        <Pressable
          onPress={() => onSubscribe(tier)}
          style={({ pressed }) => ({
            backgroundColor: colors.primary,
            borderRadius: colors.radius,
            padding: 14,
            alignItems: "center",
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
            Subscribe — {price}
          </Text>
        </Pressable>
      )}
    </Card>
  );
}

// ─── Seat manager (Growth Team only) ─────────────────────────────────────────

function SeatManager({
  billedSeats,
  activeMembers,
  onUpdate,
}: {
  billedSeats: number;
  activeMembers: number;
  onUpdate: (seats: number) => Promise<void>;
}) {
  const colors = useColors();
  const [seats, setSeats] = useState(String(billedSeats));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const n = parseInt(seats, 10);
    if (isNaN(n) || n < 0) {
      Alert.alert("Invalid value", "Enter a non-negative whole number.");
      return;
    }
    setSaving(true);
    try {
      await onUpdate(n);
      Alert.alert("Seats updated", `Billing adjusted to ${n} additional seat${n === 1 ? "" : "s"}.`);
    } catch (err) {
      Alert.alert("Error", (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const overage = Math.max(0, activeMembers - 1 - billedSeats);

  return (
    <Card style={{ gap: 12 }}>
      <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
        Seat management
      </Text>

      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
          Active team members
        </Text>
        <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
          {activeMembers}
        </Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
          Billed additional seats
        </Text>
        <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
          {billedSeats}
        </Text>
      </View>

      {overage > 0 && (
        <View
          style={{
            flexDirection: "row",
            gap: 8,
            padding: 10,
            borderRadius: 8,
            backgroundColor: (colors.warning ?? "#d97706") + "18",
          }}
        >
          <Ionicons name="warning-outline" size={16} color={colors.warning ?? "#d97706"} />
          <Text style={{ color: colors.warning ?? "#d97706", fontFamily: "Inter_500Medium", fontSize: 13, flex: 1 }}>
            {overage} team member{overage === 1 ? "" : "s"} exceed{overage === 1 ? "s" : ""} your billed seats.
            Update to avoid service interruption.
          </Text>
        </View>
      )}

      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, marginBottom: 4 }}>
            Additional seats to bill (beyond owner)
          </Text>
          <TextInput
            value={seats}
            onChangeText={setSeats}
            keyboardType="number-pad"
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
              color: colors.foreground,
              fontFamily: "Inter_400Regular",
              fontSize: 15,
              backgroundColor: colors.card,
            }}
          />
        </View>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={({ pressed }) => ({
            backgroundColor: colors.primary,
            borderRadius: 8,
            padding: 12,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed || saving ? 0.75 : 1,
            alignSelf: "flex-end",
            minWidth: 80,
          })}
        >
          {saving ? (
            <ActivityIndicator color={colors.primaryForeground} size="small" />
          ) : (
            <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
              Save
            </Text>
          )}
        </Pressable>
      </View>
    </Card>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function BillingScreen() {
  const colors   = useColors();
  const router   = useRouter();
  const qc       = useQueryClient();
  const { getToken } = useAuth();
  const { user: clerkUser } = useUser();
  const { data: license, isLoading, refetch } = useLicenseStatus();

  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const [working, setWorking] = useState(false);

  const email = clerkUser?.emailAddresses[0]?.emailAddress ?? "";

  const handleCheckout = async (tier: "solo" | "growth") => {
    setWorking(true);
    try {
      const token = await getToken();
      const url = await startCheckout(token, { tier, period, email, seats: 0 });
      if (url) {
        await WebBrowser.openBrowserAsync(url);
        // Refetch license status after returning
        await refetch();
        void qc.invalidateQueries({ queryKey: ["license-status"] });
      }
    } catch (err) {
      Alert.alert("Checkout error", (err as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const handlePortal = async () => {
    setWorking(true);
    try {
      const token = await getToken();
      const url = await openPortal(token);
      if (url) {
        await WebBrowser.openBrowserAsync(url);
        await refetch();
        void qc.invalidateQueries({ queryKey: ["license-status"] });
      }
    } catch (err) {
      Alert.alert("Portal error", (err as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const handleSeatUpdate = async (seats: number) => {
    const token = await getToken();
    await updateSeats(token, seats);
    await refetch();
    void qc.invalidateQueries({ queryKey: ["license-status"] });
  };

  return (
    <Screen>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 8,
        }}
      >
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 20, flex: 1 }}>
          Subscription
        </Text>
        {working && <ActivityIndicator color={colors.primary} />}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
      >
        {/* Current status card */}
        {isLoading ? (
          <View style={{ alignItems: "center", padding: 32 }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <Card style={{ gap: 10 }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
              Current plan
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}>
                {license?.tier === "solo"
                  ? "Solo Operator"
                  : license?.tier === "growth"
                  ? "Growth Team"
                  : "No active plan"}
              </Text>
              <StatusBadge isActive={license?.isActive ?? false} status={license?.status ?? null} />
            </View>

            {license?.isActive && (
              <Pressable
                onPress={handlePortal}
                disabled={working}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: colors.accent,
                  opacity: pressed || working ? 0.75 : 1,
                })}
              >
                <Ionicons name="card-outline" size={18} color={colors.primary} />
                <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                  Manage billing · invoices · cancel
                </Text>
                <Ionicons
                  name="open-outline"
                  size={14}
                  color={colors.mutedForeground}
                  style={{ marginLeft: "auto" }}
                />
              </Pressable>
            )}
          </Card>
        )}

        {/* Seat manager — Growth Team only */}
        {license?.tier === "growth" && license.isActive && (
          <SeatManager
            billedSeats={license.billedSeats}
            activeMembers={license.activeTeamMembers}
            onUpdate={handleSeatUpdate}
          />
        )}

        {/* Billing period toggle */}
        {!license?.isActive && (
          <>
            <View
              style={{
                flexDirection: "row",
                backgroundColor: colors.card,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 4,
              }}
            >
              {(["monthly", "yearly"] as const).map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setPeriod(p)}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    alignItems: "center",
                    borderRadius: 7,
                    backgroundColor: period === p ? colors.primary : "transparent",
                  }}
                >
                  <Text
                    style={{
                      color: period === p ? colors.primaryForeground : colors.mutedForeground,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 13,
                    }}
                  >
                    {p === "monthly" ? "Monthly" : "Yearly (save ~17%)"}
                  </Text>
                </Pressable>
              ))}
            </View>

            <PlanCard
              tier="solo"
              period={period}
              onSubscribe={handleCheckout}
              isCurrent={license?.tier === "solo"}
            />
            <PlanCard
              tier="growth"
              period={period}
              onSubscribe={handleCheckout}
              isCurrent={license?.tier === "growth"}
            />
          </>
        )}

        {/* Upgrade prompt when on solo but want to switch to growth */}
        {license?.tier === "solo" && license.isActive && (
          <>
            <View
              style={{
                flexDirection: "row",
                backgroundColor: colors.card,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 4,
              }}
            >
              {(["monthly", "yearly"] as const).map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setPeriod(p)}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    alignItems: "center",
                    borderRadius: 7,
                    backgroundColor: period === p ? colors.primary : "transparent",
                  }}
                >
                  <Text
                    style={{
                      color: period === p ? colors.primaryForeground : colors.mutedForeground,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 13,
                    }}
                  >
                    {p === "monthly" ? "Monthly" : "Yearly (save ~17%)"}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Card style={{ gap: 12 }}>
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
                Upgrade to Growth Team
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                Add team members, unlock multi-operator roles, pipeline tracking,
                and hot-zone mapping. Start at{" "}
                {period === "monthly" ? PLANS.growth.monthly : PLANS.growth.yearly}{" "}
                + {period === "monthly" ? PLANS.growth.perSeat!.monthly : PLANS.growth.perSeat!.yearly}{" "}
                per additional seat.
              </Text>
              <FeatureList
                features={[
                  "Owner, Manager, Sales Lead & Tech roles",
                  "Pipeline tracking & hot-zone mapping",
                  "Team analytics & review queue",
                ]}
              />
              <Pressable
                onPress={() => handleCheckout("growth")}
                disabled={working}
                style={({ pressed }) => ({
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius,
                  padding: 14,
                  alignItems: "center",
                  opacity: pressed || working ? 0.85 : 1,
                })}
              >
                <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
                  Upgrade to Growth Team
                </Text>
              </Pressable>
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
