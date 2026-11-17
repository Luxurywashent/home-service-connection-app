import React, { useEffect, useLayoutEffect, useRef } from "react";
import {
  AppState,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  TouchableOpacity,
  View,
} from "react-native";
import { useJobSheetColors } from "@/hooks/use-job-sheet-colors";
import {
  normalizeCompanyJobInvoiceRecipientEmail,
  type CompanyJobInvoiceMethod,
} from "@/lib/company-job-invoice-intent";

export type CompanyJobInvoiceRecipientProps = {
  method: CompanyJobInvoiceMethod;
  /** Empty means default on-file. Parent resets on every fresh sheet open. */
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  /** Canonical Company Job detail email only; display, never an override. */
  defaultEmail?: string | null;
  /** A failed backend acceptance gate must be explained, not hidden. */
  sendingUnavailableReason?: string | null;
  /** Required captured sheet/Job/session/focus/lock guard; never default true. */
  isCurrent: () => boolean;
  onInputFocus?: TextInputProps["onFocus"];
  onInputBlur?: TextInputProps["onBlur"];
};

/** Controlled optional email input only. Parent owns authority and sending. */
export function CompanyJobInvoiceRecipient(
  props: CompanyJobInvoiceRecipientProps,
) {
  const colors = useJobSheetColors();
  const live = useRef({ props, mounted: true });
  useLayoutEffect(() => {
    live.current.props = props;
  });
  useEffect(() => {
    const lifetime = live.current;
    lifetime.mounted = true;
    return () => {
      lifetime.mounted = false;
    };
  }, []);
  const current = () =>
    live.current.mounted &&
    live.current.props === props &&
    !props.disabled &&
    AppState.currentState === "active" &&
    props.isCurrent();
  let error: string | null = null;
  try {
    normalizeCompanyJobInvoiceRecipientEmail(props.value);
  } catch {
    error =
      "Enter a valid invoice recipient email, or leave blank for the email on file.";
  }
  if (props.method === "sms")
    return (
      <Text style={[styles.hint, { color: colors.muted }]}>
        Text invoices use the customer phone on file. Phone overrides are
        unavailable.
      </Text>
    );
  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.foreground }]}>
        Invoice recipient email (optional)
      </Text>
      <Text style={[styles.hint, { color: colors.muted }]}>
        Email on file: {props.defaultEmail?.trim() || "Unavailable in canonical Job detail"}
      </Text>
      <TextInput
        accessibilityLabel="Invoice recipient email (optional)"
        value={props.value}
        onChangeText={(value) => {
          if (current()) props.onChange(value);
        }}
        editable={!props.disabled}
        placeholder="Leave blank to use email on file"
        placeholderTextColor={colors.muted}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="emailAddress"
        maxLength={320}
        returnKeyType="done"
        onFocus={(event) => {
          if (current()) props.onInputFocus?.(event);
        }}
        onBlur={(event) => {
          if (current()) props.onInputBlur?.(event);
        }}
        style={[
          styles.input,
          {
            color: colors.foreground,
            borderColor: colors.border,
            backgroundColor: colors.surface,
          },
        ]}
      />
      {props.value !== "" && (
        <TouchableOpacity
          disabled={props.disabled}
          accessibilityRole="button"
          accessibilityLabel="Use customer email on file"
          onPress={() => {
            if (current()) props.onChange("");
          }}
          style={styles.reset}
        >
          <Text style={{ color: colors.foreground }}>Use email on file</Text>
        </TouchableOpacity>
      )}
      <Text style={[styles.hint, { color: colors.muted }]}>
        Blank uses the customer email on file. An override applies only to this
        invoice request; it does not change the customer profile. A resend
        requires a separate explicit choice.
      </Text>
      {props.sendingUnavailableReason && (
        <Text
          accessibilityRole="alert"
          style={[styles.hint, { color: colors.warning }]}
        >
          {props.sendingUnavailableReason}
        </Text>
      )}
      {error && (
        <Text
          accessibilityRole="alert"
          style={[styles.hint, { color: colors.error }]}
        >
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 20, gap: 8 },
  label: { fontWeight: "600", fontSize: 14 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  reset: { alignSelf: "flex-start", paddingVertical: 8 },
  hint: { fontSize: 12, lineHeight: 18 },
});
