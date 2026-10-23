import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";
import { subscribeCompanyClockNotice } from "@/lib/company-clock-notice";

/** Full-width clock feedback under the navigation row, so it does not sit beside the menu. */
export function CompanyClockNotice() {
  const colors = useColors();
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => subscribeCompanyClockNotice(setNotice), []);

  if (!notice) return null;
  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
      <Text style={{ color: colors.error, fontSize: 12, lineHeight: 16 }} numberOfLines={3}>
        {notice}
      </Text>
    </View>
  );
}
