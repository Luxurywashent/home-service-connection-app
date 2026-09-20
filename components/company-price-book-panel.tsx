import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { CompanyAuthorityLoading, CompanyAuthorityMessage } from "@/components/company-authority-state";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useCompanyPriceBook } from "@/hooks/use-company-price-book";
import { COMPANY_PRICE_BOOK_WEB_AUTHORITY_NOTICE } from "@/lib/jobsync-company-authority";

/**
 * Company-mode Price Book: read-only view of the canonical HSC catalog.
 * Mutations stay on the web Price Book — mobile must not write local price_book_services.
 */
export function CompanyPriceBookPanel({ token: _token }: { token: string }) {
  const colors = useColors();
  const { services, isLoading, error, refresh } = useCompanyPriceBook();

  return (
    <ScreenContainer edges={["left", "right"]} className="flex-1">
      <ScrollView contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 16, paddingTop: 16 }}>
        <Text style={{ color: colors.foreground, fontSize: 24, fontWeight: "800" }}>Price Book</Text>
        <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 16, marginTop: 4 }}>
          Canonical Home Service Connected catalog for this Company. Local Luxury Wash price book mutations stay unmounted.
        </Text>

        <View style={{
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          marginBottom: 16,
          padding: 14,
        }}>
          <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700" }}>Web is the write authority</Text>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>{COMPANY_PRICE_BOOK_WEB_AUTHORITY_NOTICE}</Text>
        </View>

        {isLoading ? (
          <CompanyAuthorityLoading message="Loading Company Price Book…" />
        ) : error ? (
          <CompanyAuthorityMessage
            title="Company Price Book is unavailable"
            detail={error}
          />
        ) : services.length === 0 ? (
          <CompanyAuthorityMessage
            title="No active services"
            detail="Add or activate services on the Home Service Connected web Price Book. Mobile will not seed a local catalog."
          />
        ) : (
          services.map((service) => (
            <View
              key={service.serviceId}
              style={{
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: 12,
                borderWidth: 1,
                marginBottom: 10,
                padding: 14,
              }}
            >
              <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>
                {service.emoji ? `${service.emoji} ` : ""}{service.name}
              </Text>
              {service.description ? (
                <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>{service.description}</Text>
              ) : null}
              <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600", marginTop: 8 }}>
                ${Number(service.basePrice || 0).toFixed(2)}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>Service ID {service.serviceId}</Text>
            </View>
          ))
        )}

        {!isLoading && !error ? (
          <View style={{ alignItems: "center", marginTop: 8 }}>
            {isLoading ? <ActivityIndicator color={colors.primary} /> : (
              <Text
                onPress={() => { void refresh(); }}
                style={{ color: colors.primary, fontSize: 14, fontWeight: "700", paddingVertical: 8 }}
              >
                Refresh catalog
              </Text>
            )}
          </View>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}
