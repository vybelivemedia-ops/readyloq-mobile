import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { router, Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import React from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useGetUnreadCount } from "@workspace/api-client-react";

function useMessagesUnread(): number {
  const { data } = useGetUnreadCount();
  return data?.unread ?? 0;
}

function LiveTabButton({ onPress }: { onPress: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={styles.liveTabOuter}
    >
      <View
        style={[
          styles.liveTabInner,
          {
            backgroundColor: colors.live,
            shadowColor: colors.live,
          },
        ]}
      >
        <Feather name="radio" size={22} color="#FFF" />
      </View>
    </TouchableOpacity>
  );
}

function MessageIcon({ color, focused }: { color: string; focused: boolean }) {
  const colors = useColors();
  const unread = useMessagesUnread();
  return (
    <View style={styles.msgIconWrap}>
      <Feather name="message-square" size={22} color={color} />
      {unread > 0 && (
        <View style={[styles.unreadDot, { backgroundColor: colors.live }]}>
          <Text style={styles.unreadDotText}>{unread > 9 ? "9+" : unread}</Text>
        </View>
      )}
    </View>
  );
}

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="clips">
        <Icon sf={{ default: "film", selected: "film.fill" }} />
        <Label>Clips</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="live">
        <Icon sf={{ default: "dot.radiowaves.left.and.right", selected: "dot.radiowaves.left.and.right" }} />
        <Label>Live</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="messages">
        <Icon sf={{ default: "message", selected: "message.fill" }} />
        <Label>Messages</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="discover">
        <Icon sf={{ default: "safari", selected: "safari.fill" }} />
        <Label>Discover</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf={{ default: "person", selected: "person.fill" }} />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const unread = useMessagesUnread();

  // The tab bar is absolutely positioned, so React Navigation's automatic
  // safe-area sizing is bypassed once height/paddingBottom are overridden. On
  // native (edge-to-edge on Android, home indicator on iOS) we must reserve the
  // OS bottom inset ourselves so the bar always renders ABOVE the system
  // navigation controls and no icons/labels are clipped. Web has no inset.
  const baseHeight = isWeb ? 84 : 64;
  const basePaddingBottom = isWeb ? 20 : 8;
  const bottomInset = isWeb ? 0 : insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 10,
          fontFamily: "Inter_500Medium",
          marginTop: -2,
        },
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.card,
          borderTopWidth: 0,
          borderTopColor: colors.border,
          height: baseHeight + bottomInset,
          paddingBottom: basePaddingBottom + bottomInset,
          paddingTop: 4,
          elevation: 0,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={95}
              tint="dark"
              style={[StyleSheet.absoluteFill, styles.blurBg]}
            />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card }]} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="house" tintColor={color} size={22} />
            ) : (
              <Feather name="home" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="clips"
        options={{
          title: "Clips",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="film" tintColor={color} size={22} />
            ) : (
              <Feather name="film" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="live"
        options={{
          title: "",
          tabBarIcon: () => null,
          tabBarButton: (props) => (
            <LiveTabButton onPress={() => props.onPress?.(null as never)} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          tabBarIcon: ({ color, focused }) =>
            isIOS ? (
              <View style={styles.msgIconWrap}>
                <SymbolView
                  name={focused ? "message.fill" : "message"}
                  tintColor={color}
                  size={22}
                />
                {unread > 0 && (
                  <View style={[styles.unreadDot, { backgroundColor: colors.live }]}>
                    <Text style={styles.unreadDotText}>
                      {unread > 9 ? "9+" : unread}
                    </Text>
                  </View>
                )}
              </View>
            ) : (
              <MessageIcon color={color} focused={focused} />
            ),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: "Discover",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="safari" tintColor={color} size={22} />
            ) : (
              <Feather name="compass" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person" tintColor={color} size={22} />
            ) : (
              <Feather name="user" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}

const styles = StyleSheet.create({
  blurBg: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  liveTabOuter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 4,
  },
  liveTabInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -16,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 16,
    elevation: 8,
  },
  msgIconWrap: {
    position: "relative",
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadDot: {
    position: "absolute",
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  unreadDotText: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    color: "#FFF",
  },
});
