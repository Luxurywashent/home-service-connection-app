import { Platform, View, type ViewProps } from "react-native";
import { SafeAreaView, useSafeAreaInsets, type Edge } from "react-native-safe-area-context";

import { cn } from "@/lib/utils";

export interface ScreenContainerProps extends ViewProps {
  /**
   * SafeArea edges to apply. Defaults to ["top", "left", "right"].
   * Bottom is typically handled by Tab Bar.
   */
  edges?: Edge[];
  /**
   * Tailwind className for the content area.
   */
  className?: string;
  /**
   * Additional className for the outer container (background layer).
   */
  containerClassName?: string;
  /**
   * Additional className for the SafeAreaView (content layer).
   */
  safeAreaClassName?: string;
}

/**
 * A container component that properly handles SafeArea and background colors.
 *
 * The outer View extends to full screen (including status bar area) with the background color,
 * while the inner SafeAreaView ensures content is within safe bounds.
 *
 * Usage:
 * ```tsx
 * <ScreenContainer className="p-4">
 *   <Text className="text-2xl font-bold text-foreground">
 *     Welcome
 *   </Text>
 * </ScreenContainer>
 * ```
 */
export function ScreenContainer({
  children,
  edges = ["top", "left", "right"],
  className,
  containerClassName,
  safeAreaClassName,
  style,
  ...props
}: ScreenContainerProps) {
  const insets = useSafeAreaInsets();
  const wantsTop = edges.includes("top");
  const wantsBottom = edges.includes("bottom");

  // On iOS native, fullScreenModal presentation causes SafeAreaView to not apply
  // top insets correctly in react-native-safe-area-context v5. Apply paddingTop
  // directly on the outer container and strip "top" from SafeAreaView edges.
  const useManualTopInset = Platform.OS === "ios" && wantsTop;
  const safeAreaEdges = useManualTopInset
    ? (edges.filter((e) => e !== "top") as Edge[])
    : edges;

  // On Android with edgeToEdgeEnabled, the system navigation bar overlaps content.
  // When bottom edge is NOT requested (tab bar screens), we still need bottom padding
  // to prevent content from being hidden behind the gesture navigation bar.
  const androidBottomPad =
    Platform.OS === "android" && !wantsBottom && insets.bottom > 0
      ? insets.bottom
      : 0;

  return (
    <View
      className={cn("flex-1", "bg-background", containerClassName)}
      style={useManualTopInset ? { paddingTop: insets.top } : undefined}
      {...props}
    >
      <SafeAreaView
        edges={safeAreaEdges}
        className={cn("flex-1", safeAreaClassName)}
        style={style}
      >
        <View
          className={cn("flex-1", className)}
          style={androidBottomPad > 0 ? { paddingBottom: androidBottomPad } : undefined}
        >
          {children}
        </View>
      </SafeAreaView>
    </View>
  );
}
