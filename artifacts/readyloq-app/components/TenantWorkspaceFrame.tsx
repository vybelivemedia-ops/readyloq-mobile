import React from "react";
import { View } from "react-native";
import { FullScreenLoader } from "@/components/ui/Loader";

/**
 * A warm authorization check hides and blocks the already-mounted navigator,
 * rather than destroying an inspection and its native session owner.
 * The gate still revokes local-data/sync scope while validation is pending.
 */
export function TenantWorkspaceFrame({
  blocked,
  children,
}: {
  blocked?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1, opacity: blocked ? 0 : 1 }}
        pointerEvents={blocked ? "none" : "auto"}
        accessibilityElementsHidden={Boolean(blocked)}
        importantForAccessibility={blocked ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      {blocked ? (
        <View style={{ position: "absolute", inset: 0 }}>
          <FullScreenLoader label={blocked} />
        </View>
      ) : null}
    </View>
  );
}
