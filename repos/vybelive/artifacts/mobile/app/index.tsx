import { Redirect } from "expo-router";
import { View, ActivityIndicator, StyleSheet } from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { useStream } from "@/contexts/StreamContext";
import { useColors } from "@/hooks/useColors";
import {
  getGetActiveStreamQueryKey,
  useGetActiveStream,
} from "@workspace/api-client-react";

export default function Index() {
  const { isAuthenticated, isLoading } = useAuth();
  const { isLive } = useStream();
  const colors = useColors();

  // On a cold start the in-memory StreamContext is empty (isLive === false). If
  // the backend still reports a live stream for this user, the app crashed or
  // was killed mid-broadcast — route to the recovery screen so the creator can
  // explicitly Rejoin or End. When already live in memory we skip the check.
  const {
    data: activeStream,
    isLoading: activeLoading,
  } = useGetActiveStream({
    query: {
      queryKey: getGetActiveStreamQueryKey(),
      enabled: isAuthenticated && !isLive,
      retry: false,
      staleTime: 0,
      gcTime: 0,
    },
  });

  const checkingRecovery = isAuthenticated && !isLive && activeLoading;

  if (isLoading || checkingRecovery) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (isAuthenticated) {
    if (!isLive && activeStream) {
      return <Redirect href="/stream/recover" />;
    }
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/(auth)/welcome" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
