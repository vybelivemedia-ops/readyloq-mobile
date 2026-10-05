/**
 * Billing screen — ReadyLoq.
 *
 * Subscription pricing is intentionally monthly-only. Existing subscriptions
 * are managed through the Stripe customer portal rather than duplicated here.
 */
import { useAuth, useUser } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useLicenseStatus } from "@/hooks/useLicenseStatus";
import { API_BASE } from "@/lib/api";

type PlanKey = "solo" | "micro" | "small" | "growth" | "professional" | "enterprise" | "pilot";

const PLANS: Record<PlanKey, {
  name: string;
  price: string;
  tagline: string;
  features: string[];
  pilot?: boolean;
}> = {
  solo: { name: "Solo", price: "$99/mo", tagline: "For independent operators", features: ["FAIE Vision AI analysis", "Offline sync", "Unlimited inspections"] },
  micro: { name: "Micro", price: "$299/mo", tagline: "For small teams getting started", features: ["Everything in Solo", "Team roles and collaboration", "Customer report generation"] },
  small: { name: "Small", price: "$699/mo", tagline: "For growing inspection teams", features: ["Everything in Micro", "Pipeline tracking", "Team performance analytics"] },
  growth: { name: "Growth", price: "$1,299/mo", tagline: "For established multi-operator teams", features: ["Everything in Small", "Hot-zone mapping", "Manager review queue"] },
  professional: { name: "Professional", price: "$2,499/mo", tagline: "For high-volume operations", features: ["Everything in Growth", "Advanced operational insights", "Priority support"] },
  enterprise: { name: "Enterprise", price: "$4,500/mo", tagline: "For enterprise-scale operations", features: ["Everything in Professional", "Enterprise controls", "Dedicated success support"] },
  pilot: { name: "Suburban pilot", price: "$500/mo", tagline: "Three-month pilot program", pilot: true, features: ["Full platform access", "Three monthly charges", "Ends after three billing cycles"] },
};

async function startCheckout(token: string | null, body: { tier: PlanKey; period: "monthly"; email: string }): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/billing/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Checkout failed (${res.status})`);
  }
  return ((await res.json()) as { url: string }).url;
}

async function openPortal(token: string | null): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/billing/portal`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Portal failed (${res.status})`);
  }
  return ((await res.json()) as { url: string }).url;
}

function StatusBadge({ isActive, status }: { isActive: boolean; status: string | null }) {
  const colors = useColors();
  const label = status === "active" ? "Active" : status === "trialing" ? "Trial" : status === "past_due" || status === "unpaid" ? "Payment due" : status === "incomplete" ? "Payment incomplete" : status === "canceled" ? "Canceled" : status === "incomplete_expired" ? "Expired" : "No subscription";
  const color = isActive ? (colors.success ?? "#16a34a") : status === "past_due" || status === "unpaid" || status === "incomplete" ? (colors.warning ?? "#d97706") : colors.mutedForeground;
  return <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: color + "22", alignSelf: "flex-start" }}><Text style={{ color, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>{label}</Text></View>;
}

function FeatureList({ features }: { features: string[] }) {
  const colors = useColors();
  return <View style={{ gap: 6 }}>{features.map((feature) => <View key={feature} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Ionicons name="checkmark-circle" size={16} color={colors.success ?? "#16a34a"} /><Text style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}>{feature}</Text></View>)}</View>;
}

function PlanCard({ tier, onSubscribe, isCurrent }: { tier: PlanKey; onSubscribe: (tier: PlanKey) => void; isCurrent: boolean }) {
  const colors = useColors();
  const plan = PLANS[tier];
  return <Card style={{ gap: 12 }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
      <View style={{ flex: 1 }}><Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 17 }}>{plan.name}</Text><Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 }}>{plan.tagline}</Text></View>
      {isCurrent && <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: colors.primary + "22" }}><Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 11 }}>Current</Text></View>}
    </View>
    <Text style={{ color: colors.primary, fontFamily: "Inter_700Bold", fontSize: 22 }}>{plan.price}</Text>
    <FeatureList features={plan.features} />
    {plan.pilot && <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>No automatic standard-plan charge after the pilot. You must select and accept a standard plan.</Text>}
    {!isCurrent && <Pressable accessibilityRole="button" accessibilityLabel={`${plan.name} ${tier === "pilot" ? "pilot" : "subscription"}`} onPress={() => onSubscribe(tier)} style={({ pressed }) => ({ backgroundColor: colors.primary, borderRadius: colors.radius, padding: 14, alignItems: "center", opacity: pressed ? 0.85 : 1 })}><Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>{tier === "pilot" ? "Start three-month pilot" : `Subscribe — ${plan.price}`}</Text></Pressable>}
  </Card>;
}

export default function BillingScreen() {
  const colors = useColors();
  const router = useRouter();
  const qc = useQueryClient();
  const { getToken } = useAuth();
  const { user: clerkUser } = useUser();
  const { data: license, isLoading, refetch } = useLicenseStatus();
  const [working, setWorking] = useState(false);
  const email = clerkUser?.emailAddresses[0]?.emailAddress ?? "";
  const subscriptionStatus = license?.status;
  const hasCustomerOrSubscription = Boolean(license?.stripeCustomerId || license?.stripeSubscriptionId);
  const hasNonterminalSubscription = Boolean(license?.stripeSubscriptionId) && !["canceled", "incomplete_expired"].includes(subscriptionStatus ?? "");

  const handleCheckout = async (tier: PlanKey) => {
    setWorking(true);
    try {
      const url = await startCheckout(await getToken(), { tier, period: "monthly", email });
      if (url) { await WebBrowser.openBrowserAsync(url); await refetch(); void qc.invalidateQueries({ queryKey: ["license-status"] }); }
    } catch (err) { Alert.alert("Checkout error", (err as Error).message); } finally { setWorking(false); }
  };

  const handlePortal = async () => {
    setWorking(true);
    try {
      const url = await openPortal(await getToken());
      if (url) { await WebBrowser.openBrowserAsync(url); await refetch(); void qc.invalidateQueries({ queryKey: ["license-status"] }); }
    } catch (err) { Alert.alert("Portal error", (err as Error).message); } finally { setWorking(false); }
  };

  return <Screen>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color={colors.foreground} /></Pressable>
      <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 20, flex: 1 }}>Subscription</Text>
      {working && <ActivityIndicator color={colors.primary} />}
    </View>
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
      {isLoading ? <View style={{ alignItems: "center", padding: 32 }}><ActivityIndicator color={colors.primary} /></View> : <Card style={{ gap: 10 }}>
        <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>Current plan</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}>{license?.tier ? (PLANS[license.tier as PlanKey]?.name ?? license.tier) : "No active plan"}</Text><StatusBadge isActive={license?.isActive ?? false} status={license?.status ?? null} /></View>
        {hasCustomerOrSubscription && <><Pressable accessibilityRole="button" onPress={handlePortal} disabled={working} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 8, backgroundColor: colors.accent, opacity: pressed || working ? 0.75 : 1 })}><Ionicons name="card-outline" size={18} color={colors.primary} /><Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Manage subscription · invoices · cancel</Text><Ionicons name="open-outline" size={14} color={colors.mutedForeground} style={{ marginLeft: "auto" }} /></Pressable>
          {(subscriptionStatus === "past_due" || subscriptionStatus === "incomplete" || subscriptionStatus === "unpaid") && <Text style={{ color: colors.warning ?? "#d97706", fontFamily: "Inter_400Regular", fontSize: 13 }}>Payment needs attention. Update your payment method in the billing portal before starting another plan.</Text>}
        </>}
      </Card>}
      {!hasNonterminalSubscription && <><Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}>Monthly plans</Text>{(Object.keys(PLANS) as PlanKey[]).map((tier) => <PlanCard key={tier} tier={tier} onSubscribe={handleCheckout} isCurrent={license?.tier === tier} />)}<Card style={{ gap: 8 }}><Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>Enterprise+ Custom</Text><Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>Need a custom deployment or contract? Contact sales to discuss an Enterprise+ plan.</Text><Pressable accessibilityRole="button" onPress={() => Linking.openURL("mailto:sales@readyloq.com?subject=ReadyLoq%20Enterprise%2B%20inquiry")} style={{ backgroundColor: colors.primary, borderRadius: colors.radius, padding: 14, alignItems: "center" }}><Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>Contact sales</Text></Pressable></Card></>}
    </ScrollView>
  </Screen>;
}