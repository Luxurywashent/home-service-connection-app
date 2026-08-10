/**
 * Web passthrough - no Stripe SDK imported.
 * Metro will use this file on web, never on iOS/Android.
 */
import React from "react";

interface Props {
  publishableKey: string;
  merchantIdentifier?: string;
  children: React.ReactNode;
}

export function SafeStripeProvider({ children }: Props) {
  return <>{children}</>;
}
