import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { ReactNode } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useSignOut } from "@/hooks/useSignOut";

export const paths = [
  { label: "Overview", path: "/mission-control", icon: "apps-outline" },
  { label: "Companies", path: "/mission-control/companies", icon: "business-outline" },
  { label: "Properties", path: "/mission-control/properties", icon: "home-outline" },
  { label: "Technicians", path: "/mission-control/technicians", icon: "people-outline" },
  { label: "Inspections", path: "/mission-control/inspections", icon: "document-text-outline" },
  { label: "Incidents", path: "/mission-control/incidents", icon: "alert-circle-outline" },
  { label: "Approvals", path: "/mission-control/approvals", icon: "shield-checkmark-outline" },
  { label: "Audit", path: "/mission-control/audit", icon: "list-outline" },
  { label: "AI operations", path: "/mission-control/ai", icon: "hardware-chip-outline" },
] as const;
export const go = (router: ReturnType<typeof useRouter>, path: string) => router.push(path as never);
export const nice = (v: unknown) => v == null || v === "" ? "—" : String(v).replace(/_/g, " ");
export const date = (v?: string | null) => v ? new Date(v).toLocaleString() : "—";
export const errorText = (e: unknown) => e instanceof Error ? e.message : "The request could not be completed.";

export function Shell({ title, eyebrow = "PLATFORM / MISSION CONTROL", children, refreshing, onRefresh }: { title: string; eyebrow?: string; children: ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  const c = useColors(), insets = useSafeAreaInsets(), { width } = useWindowDimensions(), router = useRouter();
  const signOut = useSignOut();
  const { isConnected } = useNetworkStatus();
  const wide = width >= 760;
  const confirmSignOut = () => Alert.alert("Sign out?", "End your platform session on this device.", [
    { text: "Stay signed in", style: "cancel" },
    { text: "Sign out", style: "destructive", onPress: () => { void signOut().catch(() => Alert.alert("Sign out failed", "Please try again.")); } },
  ]);
  return <View style={[s.root, { backgroundColor: c.background }]}>
    <View style={{ paddingTop: insets.top + 10, borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.card }}>
      <View style={[s.header, { maxWidth: 1100, alignSelf: "center", width: "100%" }]}>
        <Pressable onPress={() => router.canGoBack() ? router.back() : go(router, "/mission-control")} style={s.iconButton} accessibilityLabel="Go back" accessibilityRole="button" testID="button-back"><Ionicons name="arrow-back" size={21} color={c.foreground} /></Pressable>
        <View style={{ flex: 1 }}><Text style={[s.eyebrow, { color: c.primary }]}>{eyebrow}</Text><Text numberOfLines={1} style={[s.heading, { color: c.foreground }]}>{title}</Text></View>
        <View style={[s.liveDot, { backgroundColor: isConnected ? c.success : c.warning }]} />
        <Pressable onPress={confirmSignOut} style={[s.signOut, { borderColor: c.border }]} accessibilityLabel="Sign out" accessibilityRole="button" testID="button-sign-out"><Ionicons name="log-out-outline" size={17} color={c.foreground} /><Text style={[s.signOutText, { color: c.foreground }]}>Sign out</Text></Pressable>
      </View>
      {!isConnected && <Text style={[s.offline, { color: c.warning }]}>OFFLINE · Showing cached data when available. Decisions require a connection.</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.nav, wide && { justifyContent: "center", flexGrow: 1 }]}>
        {paths.map(p => <Pressable key={p.path} onPress={() => go(router, p.path)} style={[s.navItem, { borderColor: c.border }]} accessibilityLabel={p.label} accessibilityRole="button" testID={`nav-${p.label.toLowerCase().replace(" ", "-")}`}><Ionicons name={p.icon} size={15} color={c.primary} /><Text style={[s.navLabel, { color: c.foreground }]}>{p.label}</Text></Pressable>)}
      </ScrollView>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.primary} /> : undefined} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 42, maxWidth: wide ? 1000 : 620 }]}>
      {children}
    </ScrollView>
  </View>;
}
export function Label({ children }: { children: ReactNode }) { const c = useColors(); return <Text style={[s.eyebrow, { color: c.mutedForeground, marginTop: 22, marginBottom: 10 }]}>{children}</Text>; }
export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) { const c = useColors(); return <Text style={[s.body, { color: muted ? c.mutedForeground : c.foreground }]}>{children}</Text>; }
export function Panel({ children, onPress, accent, testID }: { children: ReactNode; onPress?: () => void; accent?: string; testID?: string }) { const c = useColors(); const content = <View style={[s.panel, { backgroundColor: c.card, borderColor: c.border, borderLeftColor: accent ?? c.border, borderLeftWidth: accent ? 3 : 1 }]}>{children}</View>; return onPress ? <Pressable onPress={onPress} testID={testID} accessibilityRole="button">{content}</Pressable> : content; }
export function Row({ title, subtitle, meta, onPress, tone }: { title: string; subtitle?: string; meta?: string; onPress?: () => void; tone?: string }) { const c = useColors(); return <Panel onPress={onPress} accent={tone}><View style={s.row}><View style={{ flex: 1, gap: 4 }}><Text style={[s.rowTitle, { color: c.foreground }]}>{title}</Text>{subtitle && <Body muted>{subtitle}</Body>}{meta && <Text style={[s.meta, { color: c.mutedForeground }]}>{meta}</Text>}</View>{onPress && <Ionicons name="chevron-forward" size={17} color={c.mutedForeground} />}</View></Panel>; }
export function Metric({ value, label }: { value: string | number; label: string }) { const c = useColors(); return <View style={[s.metric, { backgroundColor: c.card, borderColor: c.border }]}><Text style={[s.metricValue, { color: c.foreground }]}>{value}</Text><Text style={[s.eyebrow, { color: c.mutedForeground }]}>{label.toUpperCase()}</Text></View>; }
export function Action({ label, onPress, danger = false, disabled = false }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) { const c = useColors(); return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [s.action, { backgroundColor: danger ? c.destructive : c.primary, opacity: disabled ? .4 : pressed ? .75 : 1 }]} testID={`button-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`} accessibilityRole="button"><Text style={[s.actionText, { color: danger ? c.destructiveForeground : c.primaryForeground }]}>{label}</Text></Pressable>; }
export function Field({ value, onChangeText, placeholder, multiline = false }: { value: string; onChangeText: (v: string) => void; placeholder: string; multiline?: boolean }) { const c = useColors(); return <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={c.mutedForeground} multiline={multiline} style={[s.field, { color: c.foreground, backgroundColor: c.card, borderColor: c.border, minHeight: multiline ? 96 : 48, textAlignVertical: "top" }]} testID={`input-${placeholder.toLowerCase().replace(/[^a-z]+/g, "-")}`} />; }
export function QueryState({ query, empty = "No records in this scope." }: { query: { isLoading: boolean; isError: boolean; error?: unknown; refetch: () => unknown }; empty?: string }) { const c = useColors(); if (query.isLoading) return <View style={{ gap: 12 }}>{[0,1,2].map(i => <View key={i} style={{ height: 84, borderRadius: 12, backgroundColor: c.card, opacity: 1 - i * .18 }} />)}</View>; if (query.isError) return <Panel><Body>{errorText(query.error)}</Body><View style={{ marginTop: 14 }}><Action label="Retry" onPress={() => { void query.refetch(); }} /></View></Panel>; return <Panel><Body muted>{empty}</Body></Panel>; }
export function Pager({ page, total, onChange }: { page: number; total: number; onChange: (v: number) => void }) { return <View style={[s.row, { justifyContent: "space-between", marginTop: 12 }]}><Action label="Previous" disabled={page <= 1} onPress={() => onChange(page - 1)} /><Body muted>{page} / {Math.max(1, total)}</Body><Action label="Next" disabled={page >= total} onPress={() => onChange(page + 1)} /></View>; }
export const s = StyleSheet.create({
  root: { flex: 1 }, header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 14, gap: 7 }, iconButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }, signOut: { minHeight: 44, flexDirection: "row", gap: 5, alignItems: "center", paddingHorizontal: 8, borderWidth: 1, borderRadius: 8 }, signOutText: { fontFamily: "Inter_600SemiBold", fontSize: 11 }, eyebrow: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 1.5 }, heading: { fontFamily: "Inter_700Bold", fontSize: 24, letterSpacing: -.7, marginTop: 4 }, liveDot: { width: 8, height: 8, borderRadius: 4 }, offline: { fontFamily: "Inter_500Medium", fontSize: 11, paddingHorizontal: 24, paddingBottom: 9 },
  nav: { paddingHorizontal: 18, paddingBottom: 13, gap: 7 }, navItem: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 13, minHeight: 44, borderWidth: 1, borderRadius: 22 }, navLabel: { fontFamily: "Inter_600SemiBold", fontSize: 11 }, content: { width: "100%", alignSelf: "center", paddingHorizontal: 18, paddingTop: 22, gap: 10 }, panel: { padding: 17, borderRadius: 13, borderWidth: 1 }, body: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21 }, row: { flexDirection: "row", alignItems: "center", gap: 12 }, rowTitle: { fontFamily: "Inter_700Bold", fontSize: 16, lineHeight: 22 }, meta: { fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 3 }, metric: { borderRadius: 13, borderWidth: 1, padding: 18, flexGrow: 1, minWidth: 145 }, metricValue: { fontFamily: "Inter_700Bold", fontSize: 32, marginBottom: 9 }, action: { paddingHorizontal: 15, paddingVertical: 12, borderRadius: 9, alignItems: "center", justifyContent: "center", minHeight: 44 }, actionText: { fontFamily: "Inter_700Bold", fontSize: 12 }, field: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 12, fontFamily: "Inter_400Regular", fontSize: 14 },
});