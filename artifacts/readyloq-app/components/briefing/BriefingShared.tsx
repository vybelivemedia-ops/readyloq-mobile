import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, View } from "react-native";

import { Card } from "@/components/ui/Card";
import { useColors } from "@/hooks/useColors";
import { useWindowSizeClass } from "@/hooks/useWindowSizeClass";

export type BriefingStat = {
  label: string;
  value: string | number;
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
};

/** The dashboard's 2-up (compact) / 4-up stat card grid. */
export function StatGrid({ stats }: { stats: BriefingStat[] }) {
  const colors = useColors();
  const { isCompact } = useWindowSizeClass();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      {stats.map((s) => (
        <Card key={s.label} style={{ width: isCompact ? "47.5%" : "23%", gap: 8 }}>
          <Ionicons name={s.icon} size={22} color={s.tone} />
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 26 }}>
            {s.value}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
            {s.label}
          </Text>
        </Card>
      ))}
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 17 }}>
      {children}
    </Text>
  );
}

export function EmptyCard({ text }: { text: string }) {
  const colors = useColors();
  return (
    <Card>
      <Text
        style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", textAlign: "center" }}
      >
        {text}
      </Text>
    </Card>
  );
}

/** A tappable row inside a `<Card padded={false}>` list. */
export function ListRow({
  icon,
  tone,
  title,
  subtitle,
  right,
  first,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
  first: boolean;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 12,
        padding: 14,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
        alignItems: "center",
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: colors.accent,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={18} color={tone} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}
        >
          {title}
        </Text>
        <Text
          numberOfLines={1}
          style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}
        >
          {subtitle}
        </Text>
      </View>
      {right}
    </View>
  );
}

export function formatMoney(v: number): string {
  return `$${Math.round(v).toLocaleString()}`;
}
