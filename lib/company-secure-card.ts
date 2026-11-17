export type CompanySecureCardConfiguration = {
  publishableKey: string;
  accountId: string;
  mode: "live" | "test";
};
export type CompanySecureCardMetadata = { complete: boolean; brand: string | null; last4: string | null };
export type CompanySecureCardToken = { paymentMethodId: string; brand: string | null; last4: string | null };
export type CompanySecureCardResult = {
  outcome: "succeeded" | "processing" | "failed" | "canceled" | "unknown";
  intentId?: string;
  message?: string;
};
export type CompanySecureCardHandle = {
  tokenize(): Promise<CompanySecureCardToken>;
  confirm(clientSecret: string, paymentMethodId: string): Promise<CompanySecureCardResult>;
  clear(): void;
};
export type CompanySecureCardProps = {
  configuration: CompanySecureCardConfiguration;
  scopeKey: string;
  isCurrent: () => boolean;
  disabled?: boolean;
  onReady: (ready: boolean) => void;
  onChange: (metadata: CompanySecureCardMetadata) => void;
};
/** Never forward a provider exception containing client secrets or card information to the UI. */
export function secureCardMessage(kind: "unavailable" | "incomplete" | "expired" | "tokenization" | "confirmation") {
  const messages = {
    unavailable: "Secure card entry is unavailable on this device. Reopen checkout after the native payment setup is enabled.",
    incomplete: "Complete the card details before continuing.",
    expired: "This checkout changed. Reopen the Job before collecting payment.",
    tokenization: "The secure card details could not be verified. Check the card and try again before confirming payment.",
    confirmation: "The payment outcome could not be confirmed. Refresh the original payment status; do not submit another payment.",
  };
  return messages[kind];
}
export function validateSecureCardConfiguration(value: CompanySecureCardConfiguration) {
  return /^pk_(?:live|test)_[A-Za-z0-9]+$/.test(value.publishableKey)
    && value.publishableKey.startsWith(`pk_${value.mode}_`)
    && /^acct_[A-Za-z0-9]+$/.test(value.accountId);
}
