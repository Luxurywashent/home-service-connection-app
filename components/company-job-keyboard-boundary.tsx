import React from "react";
import { KeyboardAvoidingView, Platform, type KeyboardAvoidingViewProps } from "react-native";

export type CompanyJobKeyboardBoundaryProps = Omit<KeyboardAvoidingViewProps, "behavior" | "enabled" | "contentContainerStyle"> & {
  active?: boolean;
};

/**
 * Replaces (never nests inside) the existing modal KAV/root. Keep safe areas,
 * headers and footers exactly where the caller already renders them. Android
 * React Native Modal owns adjustResize; this boundary adds no IME height/inset.
 */
export function CompanyJobKeyboardBoundary({ active = true, keyboardVerticalOffset = 0, ...props }: CompanyJobKeyboardBoundaryProps) {
  return <KeyboardAvoidingView {...props} enabled={active && Platform.OS === "ios"}
    behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={keyboardVerticalOffset} />;
}
