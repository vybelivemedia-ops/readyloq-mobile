import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  useListSubscriptionPlans,
  useGetMySubscription,
  useCreateSubscription,
  useCreateCheckoutSession,
  useCancelSubscription,
} from "@workspace/api-client-react";

export default function SubscriptionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const { data: plans, isLoading: plansLoading } = useListSubscriptionPlans();
  const { data: subscription } = useGetMySubscription();
  const createSubscription = useCreateSubscription();
  const createCheckoutSession = useCreateCheckoutSession();
  const cancelSubscription = useCancelSubscription();

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const handleSubscribe = async (planId: string) => {
    const plan = plans?.find((p) => p.id === planId);

    if (!plan || plan.price === 0) {
      // Free plan — provision directly
      try {
        await createSubscription.mutateAsync({ data: { planId } });
        Alert.alert("Started!", "You are now on the free plan.");
      } catch {
        Alert.alert("Error", "Failed to activate plan. Please try again.");
      }
      return;
    }

    // Paid plan — initiate checkout session (payment required server-side).
    // The server creates a Stripe checkout session and returns a checkoutUrl;
    // only a verified Stripe webhook (not this client) can activate the plan.
    try {
      const result = await createCheckoutSession.mutateAsync({ data: { planId } });
      if (result?.checkoutUrl) {
        await Linking.openURL(result.checkoutUrl);
      } else {
        Alert.alert("Checkout Started", "Complete your payment to activate this plan.");
      }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 503) {
        Alert.alert(
          "Payment Coming Soon",
          "Paid plans are not yet available. Check back soon!",
        );
      } else {
        Alert.alert("Error", "Could not start checkout. Please try again.");
      }
    }
  };

  const handleCancel = () => {
    Alert.alert(
      "Cancel Subscription",
      "Your access will continue until the end of the billing period.",
      [
        { text: "Keep Subscription", style: "cancel" },
        {
          text: "Cancel",
          style: "destructive",
          onPress: async () => {
            await cancelSubscription.mutateAsync();
            Alert.alert("Cancelled", "Your subscription has been cancelled.");
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 16, paddingBottom: 40 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Subscription</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Current plan */}
      <LinearGradient
        colors={["#7B61FF30", "#FF3B6C20"]}
        style={[styles.currentPlanCard, { borderColor: colors.primary + "50" }]}
      >
        <View style={styles.currentPlanHeader}>
          <View>
            <Text style={[styles.currentPlanLabel, { color: colors.mutedForeground }]}>Current Plan</Text>
            <Text style={[styles.currentPlanName, { color: colors.foreground }]}>
              VYBE {(user?.plan ?? "free").toUpperCase()}
            </Text>
          </View>
          {user?.plan !== "free" && (
            <View style={[styles.activeBadge, { backgroundColor: colors.neonGreen + "25", borderColor: colors.neonGreen + "60" }]}>
              <View style={[styles.activeDot, { backgroundColor: colors.neonGreen }]} />
              <Text style={[styles.activeBadgeText, { color: colors.neonGreen }]}>Active</Text>
            </View>
          )}
        </View>
        {subscription && (
          <Text style={[styles.renewalText, { color: colors.mutedForeground }]}>
            Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
          </Text>
        )}
      </LinearGradient>

      {/* Plans */}
      {plansLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <View style={styles.plansContainer}>
          {plans?.map((plan) => {
            const isCurrent = user?.plan === plan.name.toLowerCase();
            const isPopular = plan.name.toLowerCase() === "pro";

            return (
              <View
                key={plan.id}
                style={[
                  styles.planCard,
                  {
                    backgroundColor: isPopular ? colors.primary + "15" : colors.card,
                    borderColor: isPopular ? colors.primary : colors.border,
                    shadowColor: isPopular ? colors.primary : "transparent",
                  },
                ]}
              >
                {isPopular && (
                  <View style={[styles.popularBadge, { backgroundColor: colors.primary }]}>
                    <Text style={styles.popularText}>MOST POPULAR</Text>
                  </View>
                )}

                <View style={styles.planHeader}>
                  <Text style={[styles.planName, { color: colors.foreground }]}>
                    VYBE {plan.name.toUpperCase()}
                  </Text>
                  <View style={styles.planPriceRow}>
                    <Text style={[styles.planPrice, { color: colors.foreground }]}>
                      ${plan.price}
                    </Text>
                    <Text style={[styles.planInterval, { color: colors.mutedForeground }]}>
                      /{plan.interval === "monthly" ? "mo" : "yr"}
                    </Text>
                  </View>
                </View>

                <View style={styles.featuresList}>
                  {plan.features.map((feature) => (
                    <View key={feature} style={styles.featureRow}>
                      <Feather name="check" size={13} color={isPopular ? colors.primary : colors.neonGreen} />
                      <Text style={[styles.featureText, { color: colors.secondaryForeground }]}>
                        {feature}
                      </Text>
                    </View>
                  ))}
                </View>

                {isCurrent ? (
                  <View style={[styles.currentPlanBtn, { backgroundColor: colors.muted }]}>
                    <Text style={[styles.currentPlanBtnText, { color: colors.mutedForeground }]}>Current Plan</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => handleSubscribe(plan.id)}
                    style={[
                      styles.subscribeBtn,
                      { backgroundColor: isPopular ? colors.primary : colors.secondary },
                    ]}
                  >
                    <Text
                      style={[
                        styles.subscribeBtnText,
                        { color: isPopular ? "#FFF" : colors.foreground },
                      ]}
                    >
                      {plan.price === 0 ? "Start Free" : `Subscribe – $${plan.price}/${plan.interval === "monthly" ? "mo" : "yr"}`}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      )}

      {subscription && !subscription.cancelAtPeriodEnd && user?.plan !== "free" && (
        <TouchableOpacity onPress={handleCancel} style={styles.cancelLink}>
          <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>
            Cancel subscription
          </Text>
        </TouchableOpacity>
      )}

      <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
        Subscriptions auto-renew. Cancel anytime in your account settings. By subscribing you agree to our Terms of Service.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 20 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  currentPlanCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
    gap: 8,
  },
  currentPlanHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  currentPlanLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  currentPlanName: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  activeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3 },
  activeBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  renewalText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  plansContainer: { gap: 14 },
  planCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
    gap: 16,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  popularBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderBottomLeftRadius: 12,
  },
  popularText: {
    color: "#FFF",
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
  },
  planHeader: { gap: 4 },
  planName: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  planPriceRow: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  planPrice: { fontSize: 30, fontFamily: "Inter_700Bold" },
  planInterval: { fontSize: 15, fontFamily: "Inter_400Regular", paddingBottom: 3 },
  featuresList: { gap: 8 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  subscribeBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  subscribeBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  currentPlanBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  currentPlanBtnText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  cancelLink: { alignItems: "center", paddingVertical: 8 },
  cancelText: { fontSize: 14, fontFamily: "Inter_400Regular", textDecorationLine: "underline" },
  disclaimer: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
  },
});
