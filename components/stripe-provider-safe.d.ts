/**
 * Type declarations for the platform-split StripeProvider wrapper.
 * Metro resolves to .native.tsx on iOS/Android and .web.tsx on web.
 */
import type { ReactNode } from "react";

interface SafeStripeProviderProps {
  publishableKey: string;
  merchantIdentifier?: string;
  children: ReactNode;
}

export declare function SafeStripeProvider(props: SafeStripeProviderProps): JSX.Element;
