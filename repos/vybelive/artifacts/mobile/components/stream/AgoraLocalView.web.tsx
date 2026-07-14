import React from "react";
import { StyleSheet, View } from "react-native";

interface AgoraLocalViewProps {
  engineRef: React.MutableRefObject<null>;
  uid: number;
  style?: object;
}

export function AgoraLocalView({ style }: AgoraLocalViewProps) {
  return <View style={[StyleSheet.absoluteFill, style]} />;
}
