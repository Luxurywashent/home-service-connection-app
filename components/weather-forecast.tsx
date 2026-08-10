/**
 * WeatherForecast — Dashboard weather section
 *
 * Uses the server-side weather.getForecast tRPC endpoint (proxied through our API server).
 * This avoids network errors on device by routing all external API calls through the server.
 * Shows current conditions + 5-day daily forecast.
 */
import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

// ── WMO weather code → emoji + description ────────────────────────────────────
function weatherCodeToInfo(code: number): { emoji: string; desc: string } {
  if (code === 0) return { emoji: "☀️", desc: "Clear" };
  if (code <= 2) return { emoji: "🌤️", desc: "Partly Cloudy" };
  if (code === 3) return { emoji: "☁️", desc: "Overcast" };
  if (code <= 49) return { emoji: "🌫️", desc: "Foggy" };
  if (code <= 55) return { emoji: "🌦️", desc: "Drizzle" };
  if (code <= 65) return { emoji: "🌧️", desc: "Rain" };
  if (code <= 77) return { emoji: "❄️", desc: "Snow" };
  if (code <= 82) return { emoji: "🌧️", desc: "Showers" };
  if (code <= 86) return { emoji: "🌨️", desc: "Snow Showers" };
  if (code <= 99) return { emoji: "⛈️", desc: "Thunderstorm" };
  return { emoji: "🌡️", desc: "Unknown" };
}

function getDayLabel(dateStr: string, index: number): string {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

interface WeatherForecastProps {
  /** City name from employee profile, e.g. "Crestview", "Miami", "New York" */
  city?: string | null;
}

export function WeatherForecast({ city }: WeatherForecastProps) {
  const colors = useColors();

  const weatherQuery = trpc.weather.getForecast.useQuery(
    { city: city ?? undefined },
    {
      staleTime: 10 * 60 * 1000, // 10 minutes
      retry: 2,
    }
  );

  const weather = weatherQuery.data;
  const loading = weatherQuery.isLoading;
  const error = weatherQuery.isError || (!loading && !weather);

  if (loading) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>🌤️ Weather Forecast</Text>
        </View>
        <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 16 }} />
      </View>
    );
  }

  if (error || !weather) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>🌤️ Weather Forecast</Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 12 }}>
          Unable to load weather data.
        </Text>
        <TouchableOpacity onPress={() => weatherQuery.refetch()} style={{ alignItems: "center", paddingBottom: 12 }}>
          <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600" }}>Tap to retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentInfo = weatherCodeToInfo(weather.current.weatherCode);

  // Determine a sky-blue gradient tint for the current conditions hero
  const isBad = weather.current.weatherCode >= 51;
  const heroTop = isBad ? "#334155" : (weather.current.isDay ? "#0EA5E9" : "#1E3A5F");

  return (
    <View style={{ marginBottom: 24 }}>
      {/* Section Header */}
      <View style={{ marginBottom: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground, marginBottom: 4 }}>
          🌤️ Weather Forecast
        </Text>
        <Text style={{ fontSize: 13, color: colors.muted }}>
          {weather.location}
        </Text>
      </View>

      {/* Current Conditions Hero */}
      <View
        style={[
          styles.heroCard,
          { backgroundColor: heroTop, borderColor: `${heroTop}60` },
        ]}
      >
        {/* Decorative circle */}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: -30,
            right: -30,
            width: 130,
            height: 130,
            borderRadius: 65,
            backgroundColor: "rgba(255,255,255,0.07)",
          }}
        />

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          {/* Left: temp + condition */}
          <View>
            <Text style={{ fontSize: 52, fontWeight: "900", color: "#FFFFFF", lineHeight: 60 }}>
              {weather.current.temp}°
            </Text>
            <Text style={{ fontSize: 16, color: "rgba(255,255,255,0.9)", fontWeight: "600", marginTop: 2 }}>
              {currentInfo.emoji}  {currentInfo.desc}
            </Text>
            <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", marginTop: 4 }}>
              Feels like {weather.current.feelsLike}°
            </Text>
          </View>

          {/* Right: detail stats */}
          <View style={{ gap: 8, alignItems: "flex-end" }}>
            <View style={styles.statPill}>
              <Text style={styles.statText}>💧 {weather.current.humidity}%</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statText}>💨 {weather.current.windSpeed} mph</Text>
            </View>
            {weather.daily[0]?.precipProb > 0 && (
              <View style={[styles.statPill, weather.daily[0].precipProb >= 50 && { backgroundColor: "rgba(239,68,68,0.3)" }]}>
                <Text style={styles.statText}>🌧️ {weather.daily[0].precipProb}% rain</Text>
              </View>
            )}
          </View>
        </View>

        {/* High / Low row */}
        <View style={{ flexDirection: "row", gap: 12, marginTop: 14 }}>
          <View style={[styles.hlPill, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
              ↑ {weather.daily[0]?.maxTemp}°
            </Text>
          </View>
          <View style={[styles.hlPill, { backgroundColor: "rgba(255,255,255,0.1)" }]}>
            <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: "700" }}>
              ↓ {weather.daily[0]?.minTemp}°
            </Text>
          </View>
        </View>
      </View>

      {/* 5-Day Forecast Row */}
      <View
        style={[
          styles.forecastRow,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        {weather.daily.map((day, i) => {
          const info = weatherCodeToInfo(day.weatherCode);
          const isToday = i === 0;
          return (
            <View
              key={day.date}
              style={[
                styles.dayCell,
                i < weather.daily.length - 1 && {
                  borderRightWidth: StyleSheet.hairlineWidth,
                  borderRightColor: colors.border,
                },
                isToday && { backgroundColor: `${colors.primary}12` },
              ]}
            >
              <Text style={{ fontSize: 11, fontWeight: isToday ? "800" : "600", color: isToday ? colors.primary : colors.muted, marginBottom: 4 }}>
                {getDayLabel(day.date, i)}
              </Text>
              <Text style={{ fontSize: 22, marginBottom: 4 }}>{info.emoji}</Text>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>
                {day.maxTemp}°
              </Text>
              <Text style={{ fontSize: 11, color: colors.muted }}>
                {day.minTemp}°
              </Text>
              {day.precipProb > 0 && (
                <Text style={{ fontSize: 10, color: day.precipProb >= 50 ? colors.error : colors.muted, marginTop: 3, fontWeight: "600" }}>
                  {day.precipProb}%
                </Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
  },
  sectionHeader: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
  },
  heroCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    marginBottom: 10,
    overflow: "hidden",
  },
  statPill: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  hlPill: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  forecastRow: {
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  dayCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
});
