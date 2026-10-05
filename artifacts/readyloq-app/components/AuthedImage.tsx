import { useAuth } from "@clerk/expo";
import { Image, ImageContentFit, ImageStyle } from "expo-image";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleProp, View, ViewStyle } from "react-native";

import { API_BASE } from "@/lib/api";
import { useColors } from "@/hooks/useColors";

/**
 * Displays an image served from a protected `/api/storage/...` path by
 * attaching the Clerk bearer token as a request header. Falls back to a muted
 * placeholder while the token resolves.
 */
export function AuthedImage({
  path,
  style,
  contentFit = "cover",
}: {
  path: string;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
}) {
  const colors = useColors();
  const { getToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getToken().then((t) => {
      if (active) setToken(t);
    });
    return () => {
      active = false;
    };
  }, [getToken]);

  const isLocalFile = path.startsWith("file:");
  const uri = path.startsWith("http") || isLocalFile ? path : `${API_BASE}${path}`;

  if (!token) {
    return (
      <View
        style={[
          { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
          style as StyleProp<ViewStyle>,
        ]}
      >
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  return (
    <Image
      source={isLocalFile ? { uri } : { uri, headers: { Authorization: `Bearer ${token}` } }}
      style={style}
      contentFit={contentFit}
      transition={150}
    />
  );
}
