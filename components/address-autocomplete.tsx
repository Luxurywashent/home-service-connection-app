import React, { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { getApiBaseUrl } from "@/constants/oauth";

interface Prediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

interface AddressAutocompleteProps {
  value: string;
  onChangeText: (text: string) => void;
  onSelectAddress: (fullAddress: string) => void;
  placeholder?: string;
  style?: ViewStyle | ViewStyle[];
  inputStyle?: TextStyle | TextStyle[];
  /** Bias results to a specific region, e.g. "us" */
  region?: string;
  /** Restrict to specific country codes, e.g. ["us"] */
  countries?: string[];
}

export function AddressAutocomplete({
  value,
  onChangeText,
  onSelectAddress,
  placeholder = "Start typing an address...",
  style,
  inputStyle,
  region = "us",
  countries = ["us"],
}: AddressAutocompleteProps) {
  const colors = useColors();
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPredictions = useCallback(async (input: string) => {
    if (!input || input.length < 3) {
      setPredictions([]);
      setShowDropdown(false);
      return;
    }
    setLoading(true);
    try {
      // Use server-side proxy to avoid API key referrer restrictions
      const countriesParam = countries.map((c) => `country:${c}`).join(",");
      const apiBase = getApiBaseUrl();
      const url = `${apiBase}/api/places/autocomplete?input=${encodeURIComponent(input)}&countries=${encodeURIComponent(countriesParam)}&region=${region}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === "OK" || data.status === "ZERO_RESULTS") {
        setPredictions(data.predictions ?? []);
        setShowDropdown((data.predictions ?? []).length > 0);
      }
    } catch (e) {
      console.warn("[AddressAutocomplete] fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, [countries, region]);

  function handleChangeText(text: string) {
    onChangeText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPredictions(text), 350);
  }

  function handleSelect(prediction: Prediction) {
    onSelectAddress(prediction.description);
    onChangeText(prediction.description);
    setPredictions([]);
    setShowDropdown(false);
  }

  return (
    <View style={[{ position: "relative", zIndex: 999 }, style]}>
      <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
        <TextInput
          value={value}
          onChangeText={handleChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          style={[styles.input, { color: colors.foreground }, inputStyle]}
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="done"
          onBlur={() => {
            // Slight delay so tap on dropdown registers first
            setTimeout(() => setShowDropdown(false), 200);
          }}
          onFocus={() => {
            if (predictions.length > 0) setShowDropdown(true);
          }}
        />
        {loading && (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 10 }} />
        )}
      </View>

      {showDropdown && predictions.length > 0 && (
        <View style={[styles.dropdown, { backgroundColor: colors.background, borderColor: colors.border, shadowColor: colors.foreground }]}>
          {/* Use ScrollView + .map() instead of FlatList to avoid VirtualizedList nesting warnings */}
          <ScrollView
            keyboardShouldPersistTaps="always"
            style={{ maxHeight: 220 }}
            showsVerticalScrollIndicator={false}
          >
            {predictions.map((item, index) => (
              <TouchableOpacity
                key={item.place_id}
                onPress={() => handleSelect(item)}
                style={[
                  styles.predictionRow,
                  { borderBottomColor: colors.border },
                  index === predictions.length - 1 && { borderBottomWidth: 0 },
                ]}
              >
                <Text style={[styles.mainText, { color: colors.foreground }]} numberOfLines={1}>
                  {item.structured_formatting.main_text}
                </Text>
                <Text style={[styles.secondaryText, { color: colors.muted }]} numberOfLines={1}>
                  {item.structured_formatting.secondary_text}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 14,
  },
  dropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 4,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 1000,
  },
  predictionRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  mainText: {
    fontSize: 14,
    fontWeight: "600",
  },
  secondaryText: {
    fontSize: 12,
    marginTop: 1,
  },
});
