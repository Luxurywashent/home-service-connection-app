/**
 * TapToPayCheckout
 *
 * Handles the full Tap to Pay on iPhone flow using Stripe Terminal SDK.
 * Requires:
 *  - Apple Tap to Pay entitlement (approved)
 *  - Stripe Terminal connection token from server
 *  - iOS 16+ device with NFC
 */
import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
} from "react-native";
// Stripe Terminal is iOS-only — dynamic require prevents Android crash at module load time
const isIOS = Platform.OS === "ios";
const stripeTerminalModule = isIOS
  ? (() => { try { return require("@stripe/stripe-terminal-react-native"); } catch { return null; } })()
  : null;
const useStripeTerminal: typeof import("@stripe/stripe-terminal-react-native")["useStripeTerminal"] =
  stripeTerminalModule?.useStripeTerminal ?? (() => ({ initialize: async () => {}, discoverReaders: async () => {}, connectLocalMobileReader: async () => ({ reader: null, error: null }), collectPaymentMethod: async () => ({ error: null }), confirmPaymentIntent: async () => ({ error: null }), cancelCollectPaymentMethod: async () => {}, retrievePaymentIntent: async () => ({ paymentIntent: null, error: null }), createPaymentIntent: async () => ({ paymentIntent: null, error: null }), readers: [], discoveryStatus: "idle", connectedReader: null, paymentStatus: "not_ready" } as any));
const StripeTerminalProvider: React.ComponentType<{ logLevel?: string; tokenProvider: () => Promise<string>; children: React.ReactNode }> =
  stripeTerminalModule?.StripeTerminalProvider ?? (({ children }: { children: React.ReactNode }) => <>{children}</>) as any;
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { useTTP } from "@/lib/ttp-context";

// ─── Inner component that uses the Terminal hooks ─────────────────────────────
interface TapToPayInnerProps {
  amountCents: number;
  jobId: string;
  customerName: string;
  serviceTitle: string;
  onSuccess: (paymentIntentId: string) => void;
  onCancel: () => void;
}

function TapToPayInner({
  amountCents,
  jobId,
  customerName,
  serviceTitle,
  onSuccess,
  onCancel,
}: TapToPayInnerProps) {
  const colors = useColors();
  const [status, setStatus] = useState<
    "initializing" | "idle" | "checking" | "connecting" | "waiting" | "processing" | "capturing" | "success" | "error"
  >("initializing");
  const [errorMsg, setErrorMsg] = useState("");

  const getConnectionToken = trpc.stripe.getConnectionToken.useMutation();
  const createPaymentIntent = trpc.stripe.createPaymentIntent.useMutation();
  const captureTerminalPayment = trpc.stripe.captureTerminalPayment.useMutation();

  const {
    initialize,
    supportsReadersOfType,
    discoverReaders,
    connectReader,
    collectPaymentMethod,
    confirmPaymentIntent,
    cancelCollectPaymentMethod,
    disconnectReader,
    connectedReader,
  } = useStripeTerminal({
    onUpdateDiscoveredReaders: async (readers) => {
      if (readers.length === 0) return;
      setStatus("connecting");
      const { error } = await connectReader({
        discoveryMethod: "tapToPay",
        reader: readers[0]!,
        locationId: "tml_Fcm7TwKu3H8qQh", // Luxury Wash On Wheels location
        merchantDisplayName: "Luxury Wash On Wheels",
        tosAcceptancePermitted: true,
        autoReconnectOnUnexpectedDisconnect: true,
      });
      if (error) {
        setErrorMsg(error.message);
        setStatus("error");
      }
    },
  });

  // Initialize the SDK as soon as the component mounts
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const { error } = await initialize();
        if (cancelled) return;
        if (error) {
          setErrorMsg(error.message);
          setStatus("error");
        } else {
          setStatus("idle");
        }
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.message ?? "Failed to initialize Stripe Terminal.");
        setStatus("error");
      }
    };
    init();
    return () => { cancelled = true; };
  }, []);

  const handleStart = useCallback(async () => {
    if (Platform.OS !== "ios") {
      Alert.alert("Not Supported", "Tap to Pay is only available on iOS devices.");
      return;
    }

    try {
      setStatus("checking");
      setErrorMsg("");

      // 1. Check device compatibility
      const { readerSupportResult, error: supportError } = await supportsReadersOfType({
        deviceType: "tapToPay",
        simulated: false,
        discoveryMethod: "tapToPay",
      });

      if (supportError || !readerSupportResult) {
        setErrorMsg("This device does not support Tap to Pay. Requires iPhone XS or later with iOS 16+.");
        setStatus("error");
        return;
      }

      // 2. Discover and connect (handled in onUpdateDiscoveredReaders callback)
      setStatus("connecting");
      const { error: discoverError } = await discoverReaders({
        discoveryMethod: "tapToPay",
        simulated: false,
      });

      if (discoverError) {
        setErrorMsg(discoverError.message);
        setStatus("error");
        return;
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to initialize Tap to Pay.");
      setStatus("error");
    }
  }, [supportsReadersOfType, discoverReaders]);

  // Once connected, create payment intent and collect payment
  useEffect(() => {
    if (status !== "connecting" || !connectedReader) return;

    const run = async () => {
      try {
        setStatus("waiting");

        // 3. Create payment intent on server (manual capture for Terminal)
        const { clientSecret } = await createPaymentIntent.mutateAsync({
          amountCents,
          description: `${serviceTitle} — ${customerName}`,
          captureMethod: "manual",
          paymentMethodTypes: ["card_present"],
        });

        // 4. Collect payment method (shows the "Tap card here" UI)
        const { paymentIntent: collected, error: collectError } = await collectPaymentMethod({
          paymentIntent: { clientSecret } as any,
        });

        if (collectError) {
          setErrorMsg(collectError.message);
          setStatus("error");
          return;
        }

        setStatus("processing");

        // 5. Confirm payment intent (processes the tap)
        const { paymentIntent: confirmed, error: confirmError } = await confirmPaymentIntent({
          paymentIntent: collected!,
        });

        if (confirmError) {
          setErrorMsg(confirmError.message);
          setStatus("error");
          return;
        }

        setStatus("capturing");

        // 6. Capture on server (for manual capture payment intents)
        try {
          await captureTerminalPayment.mutateAsync({
            paymentIntentId: confirmed!.id,
          });
        } catch {
          // If capture fails (already captured), continue
        }

        setStatus("success");
        setTimeout(() => {
          onSuccess(confirmed!.id);
        }, 1200);
      } catch (e: any) {
        setErrorMsg(e?.message ?? "Payment failed.");
        setStatus("error");
      }
    };

    run();
  }, [status, connectedReader]);

  const handleCancel = async () => {
    if (status === "waiting") {
      await cancelCollectPaymentMethod();
    }
    if (connectedReader) {
      await disconnectReader();
    }
    onCancel();
  };

  const totalDollars = (amountCents / 100).toFixed(2);
  const { tosAccepted } = useTTP();

  // Apple requirement: show OS version error if iOS < 17.6
  const iosVersionOk = Platform.OS === "ios" ? (() => {
    const v = Platform.Version as string;
    const parts = v.split(".").map(Number);
    const major = parts[0] ?? 0;
    const minor = parts[1] ?? 0;
    return major > 17 || (major === 17 && minor >= 6);
  })() : false;

  if (Platform.OS !== "ios") {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={onCancel} style={styles.backBtn}>
          <Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text>
        </TouchableOpacity>
        <View style={[styles.statusBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 48, textAlign: "center" }}>📱</Text>
          <Text style={[styles.statusTitle, { color: colors.foreground }]}>iOS Only</Text>
          <Text style={[styles.statusDesc, { color: colors.muted }]}>
            Tap to Pay on iPhone is only available on iOS devices.
          </Text>
        </View>
        <TouchableOpacity onPress={onCancel} style={[styles.secondaryBtn, { borderColor: colors.border }]} activeOpacity={0.8}>
          <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Use a Different Method</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!iosVersionOk) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={onCancel} style={styles.backBtn}>
          <Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text>
        </TouchableOpacity>
        <View style={[styles.statusBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 48, textAlign: "center" }}>⚠️</Text>
          <Text style={[styles.statusTitle, { color: colors.foreground }]}>iOS Update Required</Text>
          <Text style={[styles.statusDesc, { color: colors.muted }]}>
            Tap to Pay on iPhone requires iOS 17.6 or later. Please update your iPhone in Settings → General → Software Update.
          </Text>
        </View>
        <TouchableOpacity onPress={onCancel} style={[styles.secondaryBtn, { borderColor: colors.border }]} activeOpacity={0.8}>
          <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Use a Different Method</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!tosAccepted) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={onCancel} style={styles.backBtn}>
          <Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text>
        </TouchableOpacity>
        <View style={[styles.statusBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 48, textAlign: "center" }}>🔒</Text>
          <Text style={[styles.statusTitle, { color: colors.foreground }]}>Setup Required</Text>
          <Text style={[styles.statusDesc, { color: colors.muted }]}>
            Tap to Pay must be enabled by an admin before it can be used. Go to Finance → Settings → Tap to Pay to set it up.
          </Text>
        </View>
        <TouchableOpacity onPress={onCancel} style={[styles.secondaryBtn, { borderColor: colors.border }]} activeOpacity={0.8}>
          <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Use a Different Method</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <TouchableOpacity onPress={handleCancel} style={styles.backBtn}>
        <Text style={{ color: colors.primary, fontSize: 15 }}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={[styles.title, { color: colors.foreground }]}>Tap to Pay on iPhone</Text>
      <Text style={[styles.subtitle, { color: colors.muted }]}>
        {customerName} · {serviceTitle}
      </Text>

      {/* Amount */}
      <View style={[styles.totalBox, { backgroundColor: "#8B5CF618", borderColor: "#8B5CF640" }]}>
        <Text style={[styles.totalLabel, { color: colors.muted }]}>Total to Charge</Text>
        <Text style={[styles.totalAmount, { color: "#8B5CF6" }]}>${totalDollars}</Text>
      </View>

      {/* Status UI */}
      <View style={[styles.statusBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {status === "initializing" && (
          <>
            <ActivityIndicator size="large" color="#8B5CF6" />
            <Text style={[styles.statusTitle, { color: colors.foreground }]}>
              Initializing...
            </Text>
          </>
        )}

        {status === "idle" && (
          <>
            <Text style={{ fontSize: 52, textAlign: "center" }}>📲</Text>
            <Text style={[styles.statusTitle, { color: colors.foreground }]}>
              Ready to Accept Payment
            </Text>
            <Text style={[styles.statusDesc, { color: colors.muted }]}>
              Customer taps their card, Apple Pay, or Google Pay directly on this iPhone. No hardware needed.
            </Text>
          </>
        )}

        {(status === "checking" || status === "connecting") && (
          <>
            <ActivityIndicator size="large" color="#8B5CF6" />
            <Text style={[styles.statusTitle, { color: colors.foreground }]}>
              {status === "checking" ? "Checking device..." : "Initializing reader..."}
            </Text>
          </>
        )}

        {status === "waiting" && (
          <>
            <Text style={{ fontSize: 52, textAlign: "center" }}>💳</Text>
            <Text style={[styles.statusTitle, { color: colors.foreground }]}>
              Ready — Ask Customer to Tap
            </Text>
            <Text style={[styles.statusDesc, { color: colors.muted }]}>
              Hold the iPhone near the customer's card, Apple Pay, or Google Pay to collect payment.
            </Text>
            <ActivityIndicator size="small" color="#8B5CF6" style={{ marginTop: 8 }} />
          </>
        )}

        {status === "processing" && (
          <>
            <ActivityIndicator size="large" color="#8B5CF6" />
            <Text style={[styles.statusTitle, { color: colors.foreground }]}>Processing...</Text>
          </>
        )}

        {status === "capturing" && (
          <>
            <ActivityIndicator size="large" color="#22C55E" />
            <Text style={[styles.statusTitle, { color: colors.foreground }]}>Finalizing payment...</Text>
          </>
        )}

        {status === "success" && (
          <>
            <Text style={{ fontSize: 52, textAlign: "center" }}>✅</Text>
            <Text style={[styles.statusTitle, { color: "#22C55E" }]}>Payment Successful!</Text>
            <Text style={[styles.statusDesc, { color: colors.muted }]}>${totalDollars} charged</Text>
          </>
        )}

        {status === "error" && (
          <>
            <Text style={{ fontSize: 52, textAlign: "center" }}>❌</Text>
            <Text style={[styles.statusTitle, { color: colors.error ?? "#EF4444" }]}>Payment Failed</Text>
            <Text style={[styles.statusDesc, { color: colors.muted }]}>{errorMsg}</Text>
          </>
        )}
      </View>

      {/* Action buttons */}
      {status === "idle" && (
        <TouchableOpacity
          onPress={handleStart}
          style={[styles.primaryBtn, { backgroundColor: "#8B5CF6" }]}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryBtnText}>Start Tap to Pay →</Text>
        </TouchableOpacity>
      )}

      {status === "error" && (
        <View style={{ gap: 10 }}>
          <TouchableOpacity
            onPress={() => setStatus("idle")}
            style={[styles.primaryBtn, { backgroundColor: "#8B5CF6" }]}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryBtnText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleCancel}
            style={[styles.secondaryBtn, { borderColor: colors.border }]}
            activeOpacity={0.8}
          >
            <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>
              Use a Different Method
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {(status === "waiting") && (
        <TouchableOpacity
          onPress={handleCancel}
          style={[styles.secondaryBtn, { borderColor: colors.border }]}
          activeOpacity={0.8}
        >
          <Text style={[styles.secondaryBtnText, { color: colors.muted }]}>Cancel</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Outer wrapper with StripeTerminalProvider ────────────────────────────────
export interface TapToPayCheckoutProps extends TapToPayInnerProps {}

export function TapToPayCheckout(props: TapToPayCheckoutProps) {
  const getConnectionToken = trpc.stripe.getConnectionToken.useMutation();

  const fetchConnectionToken = useCallback(async () => {
    try {
      const { secret } = await getConnectionToken.mutateAsync();
      return secret;
    } catch {
      return "";
    }
  }, []);

  return (
    <StripeTerminalProvider
      logLevel="none"
      tokenProvider={fetchConnectionToken}
    >
      <TapToPayInner {...props} />
    </StripeTerminalProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 0,
  },
  backBtn: {
    paddingVertical: 6,
    paddingHorizontal: 2,
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 13,
    marginBottom: 12,
  },
  totalBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    alignItems: "center",
    marginBottom: 12,
  },
  totalLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  totalAmount: {
    fontSize: 36,
    fontWeight: "800",
  },
  statusBox: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    minHeight: 160,
    justifyContent: "center",
  },
  statusTitle: {
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  statusDesc: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
  primaryBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 10,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
