import { ActivityIndicator, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";
import type { CompanyJobAuthorityMode } from "@/lib/jobsync-company-authority";
import { companyCanonicalListState } from "@/lib/jobsync-company-authority";

export function CompanyAuthorityLoading({ message = "Confirming Company identity…" }: { message?: string }) {
  const colors = useColors();
  return (
    <View style={{ alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingVertical: 40 }}>
      <ActivityIndicator color={colors.primary} />
      <Text style={{ color: colors.muted, fontSize: 13, marginTop: 12, textAlign: "center" }}>{message}</Text>
    </View>
  );
}

export function CompanyAuthorityMessage({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  const colors = useColors();
  return (
    <View style={{ alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingVertical: 40 }}>
      <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700", textAlign: "center" }}>{title}</Text>
      {detail ? <Text style={{ color: colors.muted, fontSize: 13, marginTop: 8, textAlign: "center" }}>{detail}</Text> : null}
    </View>
  );
}

export function companyTimeListState(input: { loading: boolean; error: string | null; itemCount: number }) {
  return companyCanonicalListState(input);
}

export function isUnknownCompanyAuthority(mode: CompanyJobAuthorityMode) {
  return mode === "unknown";
}
