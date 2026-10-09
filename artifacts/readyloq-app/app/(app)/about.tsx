import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Card } from "@/components/ui/Card";
import { PreviewUpdateIdentity } from "@/components/PreviewUpdateIdentity";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import {
  APP_VERSION,
  ANDROID_VERSION_CODE,
  CODENAME,
  RELEASE_NOTES,
  RELEASE_TYPE,
  VERSION_NAME,
} from "@/constants/version";

export default function AboutScreen() {
  const colors = useColors();
  const router = useRouter();

  const meta = [
    { label: "Version", value: `${APP_VERSION} (build ${ANDROID_VERSION_CODE})` },
    { label: "Codename", value: CODENAME },
    { label: "Release type", value: RELEASE_TYPE },
  ];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 16,
          paddingBottom: 32,
          width: "100%",
          maxWidth: 700,
          alignSelf: "center",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.card,
            }}
          >
            <Ionicons name="arrow-back" size={20} color={colors.foreground} />
          </Pressable>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 22 }}>
            About ReadyLoq
          </Text>
        </View>

        <Card>
          <View style={{ gap: 4, alignItems: "center", paddingVertical: 8 }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>
              {VERSION_NAME}
            </Text>
            <Text
              style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14 }}
            >
              “{CODENAME}”
            </Text>
          </View>
          <View style={{ marginTop: 8, gap: 8 }}>
            {meta.map((row) => (
              <View
                key={row.label}
                style={{ flexDirection: "row", justifyContent: "space-between" }}
              >
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontFamily: "Inter_400Regular",
                    fontSize: 14,
                  }}
                >
                  {row.label}
                </Text>
                <Text
                  style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}
                >
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        </Card>

        <PreviewUpdateIdentity />

        {RELEASE_NOTES.map((section) => (
          <Card key={section.title}>
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_700Bold",
                fontSize: 16,
                marginBottom: 8,
              }}
            >
              {section.title}
            </Text>
            <View style={{ gap: 6 }}>
              {section.items.map((item) => (
                <View key={item} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                  <Text style={{ color: colors.primary, fontSize: 14, lineHeight: 20 }}>•</Text>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontFamily: "Inter_400Regular",
                      fontSize: 14,
                      lineHeight: 20,
                      flex: 1,
                    }}
                  >
                    {item}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
