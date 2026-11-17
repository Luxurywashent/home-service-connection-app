import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CardField, initStripe, createPaymentMethod, confirmPayment } from "@stripe/stripe-react-native";
import { useJobSheetColors } from "@/hooks/use-job-sheet-colors";
import {
  secureCardMessage, validateSecureCardConfiguration,
  type CompanySecureCardProps, type CompanySecureCardHandle, type CompanySecureCardResult,
} from "@/lib/company-secure-card";

// Stripe's native client is process-wide. Serialize account changes and every
// tokenization/confirmation so a second Company cannot switch it mid-operation.
let providerQueue: Promise<unknown> = Promise.resolve();
let activeProviderScope: string | null = null;
function serialize<T>(action: () => Promise<T>): Promise<T> {
  const pending = providerQueue.then(action, action);
  providerQueue = pending.catch(() => undefined);
  return pending;
}
const unavailable = () => new Error(secureCardMessage("unavailable"));
const expired = () => new Error(secureCardMessage("expired"));

export const CompanySecureCardField = forwardRef<CompanySecureCardHandle, CompanySecureCardProps>(function CompanySecureCardField(props, ref) {
  const colors = useJobSheetColors();
  const live = useRef(props);
  const mounted = useRef(false);
  const complete = useRef(false);
  const field = useRef<React.ElementRef<typeof CardField>>(null);
  const readyBinding = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const configuration = useMemo(() => ({ accountId: props.configuration.accountId, mode: props.configuration.mode,
    publishableKey: props.configuration.publishableKey }), [props.configuration.accountId, props.configuration.mode, props.configuration.publishableKey]);
  const binding = JSON.stringify([props.scopeKey, configuration.accountId, configuration.mode, configuration.publishableKey]);
  useLayoutEffect(() => { live.current = props; }, [props]);
  const current = useCallback(() => mounted.current && live.current.isCurrent()
    && JSON.stringify([live.current.scopeKey, live.current.configuration.accountId, live.current.configuration.mode, live.current.configuration.publishableKey]) === binding, [binding]);
  useEffect(() => {
    mounted.current = true;
    complete.current = false;
    setReady(false); setFailed(false);
    if (readyBinding.current !== null && current()) live.current.onReady(false);
    readyBinding.current = null;
    let canceled = false;
    void serialize(async () => {
      if (canceled || !current()) return;
      if (!validateSecureCardConfiguration(configuration)) throw unavailable();
      await initStripe({ publishableKey: configuration.publishableKey,
        stripeAccountId: configuration.accountId, urlScheme: "homeserviceconnection", setReturnUrlSchemeOnAndroid: true });
      if (canceled || !current()) return;
      activeProviderScope = binding;
      readyBinding.current = binding;
      setReady(true); live.current.onReady(true);
    }).catch(() => {
      if (canceled || !current()) return;
      setFailed(true); live.current.onReady(false);
    });
    return () => { canceled = true; mounted.current = false; complete.current = false; };
  }, [binding, configuration, current]);
  useImperativeHandle(ref, () => ({
    tokenize: () => serialize(async () => {
      if (!current() || live.current.disabled) throw expired();
      if (!ready || activeProviderScope !== binding) throw unavailable();
      if (!complete.current) throw new Error(secureCardMessage("incomplete"));
      const result = await createPaymentMethod({ paymentMethodType: "Card" }).catch(() => { throw new Error(secureCardMessage("tokenization")); });
      if (!current() || activeProviderScope !== binding) throw expired();
      if (result.error || !result.paymentMethod || !/^pm_[A-Za-z0-9]+$/.test(result.paymentMethod.id)
        || result.paymentMethod.liveMode !== (props.configuration.mode === "live")) throw new Error(secureCardMessage("tokenization"));
      const card = result.paymentMethod.Card;
      return { paymentMethodId: result.paymentMethod.id,
        brand: typeof card?.brand === "string" ? card.brand : null,
        last4: typeof card?.last4 === "string" && /^\d{4}$/.test(card.last4) ? card.last4 : null };
    }),
    confirm: (clientSecret, paymentMethodId, isAuthorized) => serialize(async (): Promise<CompanySecureCardResult> => {
      if (!current() || live.current.disabled || activeProviderScope !== binding || !ready) throw expired();
      if (!/^pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/.test(clientSecret) || !/^pm_[A-Za-z0-9]+$/.test(paymentMethodId)) throw unavailable();
      // This method is invoked only by the controller's final signature-approved
      // event. Earlier screens tokenize; they never confirm a PaymentIntent.
      if (isAuthorized && !isAuthorized()) throw expired();
      const result = await confirmPayment(clientSecret, { paymentMethodType: "Card", paymentMethodData: { paymentMethodId } }).catch(() => { throw new Error(secureCardMessage("confirmation")); });
      if (!current() || activeProviderScope !== binding) return { outcome: "unknown", message: secureCardMessage("confirmation") };
      if (result.error) return { outcome: result.error.code === "Canceled" ? "canceled" : "unknown", message: secureCardMessage("confirmation") };
      const intent = result.paymentIntent;
      const expectedId = clientSecret.split("_secret_")[0];
      if (!intent || intent.id !== expectedId || intent.livemode !== (props.configuration.mode === "live")) return { outcome: "unknown", message: secureCardMessage("confirmation") };
      return { outcome: intent.status === "Succeeded" ? "succeeded" : intent.status === "Processing" ? "processing" : "unknown", intentId: intent.id };
    }),
    clear: () => {
      if (!current()) return;
      complete.current = false; field.current?.clear();
      live.current.onChange({ complete: false, brand: null, last4: null });
    },
  }), [binding, ready, props.configuration.mode, current]);
  return <View style={styles.container}>
    {ready && <CardField ref={field} postalCodeEnabled dangerouslyGetFullCardDetails={false}
      cardStyle={{ backgroundColor: colors.background, textColor: colors.foreground, placeholderColor: colors.muted,
        borderColor: colors.border, borderWidth: 1, borderRadius: 10, fontSize: 16 }}
      style={styles.field} onCardChange={(details) => {
        if (!current() || live.current.disabled) return;
        complete.current = details.complete === true;
        // Copy only an explicit masked allowlist, never the entire SDK event.
        live.current.onChange({ complete: complete.current, brand: typeof details.brand === "string" ? details.brand : null,
          last4: /^\d{4}$/.test(details.last4 ?? "") ? details.last4 : null });
      }} />}
    {!ready && <Text accessibilityRole={failed ? "alert" : undefined} style={[styles.note, { color: failed ? colors.error : colors.muted }]}>
      {failed ? secureCardMessage("unavailable") : "Preparing secure card entry…"}
    </Text>}
  </View>;
});
const styles = StyleSheet.create({ container: { minHeight: 56 }, field: { height: 56, width: "100%" }, note: { fontSize: 14, lineHeight: 20 } });
