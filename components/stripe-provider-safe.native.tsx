/**
 * Native-only StripeProvider wrapper.
 * Metro will use this file on iOS and Android, never on web.
 *
 * Detects Expo Go (appOwnership === "expo") and skips the Stripe native
 * module entirely — the native binary in Expo Go does not include Stripe's
 * TurboModule (OnrampSdk), so any require() call crashes immediately.
 *
 * In a production build (standalone / EAS build), the native module is
 * linked and StripeProvider works normally.
 */
import React, { type ReactNode } from "react";
import { View } from "react-native";
import Constants from "expo-constants";

interface Props {
  publishableKey: string;
  merchantIdentifier?: string;
  children: ReactNode;
}

// Passthrough fallback used in Expo Go (no native Stripe binary)
function FallbackProvider({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1 }}>{children as React.ReactElement}</View>;
}

// Detect Expo Go: appOwnership is "expo" when running inside the Expo Go app
const isExpoGo = Constants.appOwnership === "expo";

// Only require Stripe when NOT in Expo Go to avoid TurboModule crash
let StripeProviderComponent: React.ComponentType<{
  publishableKey: string;
  merchantIdentifier?: string;
  urlScheme?: string;
  children: React.ReactElement;
}> | null = null;

if (!isExpoGo) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    StripeProviderComponent = require("@stripe/stripe-react-native").StripeProvider;
  } catch {
    // Should not happen in a production build, but guard anyway
    StripeProviderComponent = null;
  }
}

export function SafeStripeProvider({ publishableKey, merchantIdentifier, children }: Props) {
  if (!StripeProviderComponent) {
    // Expo Go or Stripe not linked — render children without Stripe context
    return <FallbackProvider>{children}</FallbackProvider>;
  }

  return (
    <StripeProviderComponent
      publishableKey={publishableKey}
      merchantIdentifier={merchantIdentifier}
      urlScheme="manus"
    >
      {children as React.ReactElement}
    </StripeProviderComponent>
  );
}
