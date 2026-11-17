import React, { forwardRef, useEffect, useImperativeHandle } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { CompanySecureCardHandle, CompanySecureCardProps } from "@/lib/company-secure-card";

export const CompanySecureCardField = forwardRef<CompanySecureCardHandle, CompanySecureCardProps>(function CompanySecureCardField(props, ref) {
  useImperativeHandle(ref, () => ({
    tokenize: async () => { throw new Error("Native card collection requires the installed iOS or Android app."); },
    confirm: async () => { throw new Error("Browser previews cannot confirm a native card payment."); },
    clear: () => undefined,
  }), []);
  useEffect(() => { if (props.isCurrent()) props.onReady(false); }, [props]);
  return <View style={styles.field}><Text style={styles.note}>Secure card entry is available only in the installed mobile app. This browser preview cannot collect card details.</Text></View>;
});
const styles = StyleSheet.create({ field: { minHeight: 56, padding: 12, borderWidth: 1, borderColor: "#2e333c", borderRadius: 10 }, note: { color: "#a5a9b2", fontSize: 14, lineHeight: 20 } });
