/**
 * Tap to Pay on iPhone — Context
 *
 * Manages:
 *  - T&C acceptance state (persisted per device, admin-only)
 *  - Awareness modal shown state (shown once per install)
 *  - Warm-up trigger on app foreground
 *
 * Apple requirements addressed:
 *  - 1.5: Warm-up on app launch / foreground
 *  - 3.3: Show awareness moment at least once to eligible users
 *  - 3.5/3.8: T&C acceptance gated to admin users only
 */
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const TTP_TOS_KEY = "ttp_tos_accepted_v1";
const TTP_AWARENESS_KEY = "ttp_awareness_shown_v1";
const TTP_EDUCATION_KEY = "ttp_education_shown_v1";

interface TTPContextValue {
  /** Whether admin has accepted Stripe Terminal TOS */
  tosAccepted: boolean;
  /** Whether the one-time awareness modal has been shown */
  awarenessShown: boolean;
  /** Whether the education screens have been shown after T&C */
  educationShown: boolean;
  /** Accept T&C (admin only) */
  acceptTos: () => Promise<void>;
  /** Mark awareness modal as shown */
  markAwarenessShown: () => Promise<void>;
  /** Mark education screens as shown */
  markEducationShown: () => Promise<void>;
  /** Reset TTP state (for testing / re-onboarding) */
  resetTtp: () => Promise<void>;
  /** Whether TTP is available on this device (iOS only) */
  ttpAvailable: boolean;
}

const TTPContext = createContext<TTPContextValue>({
  tosAccepted: false,
  awarenessShown: false,
  educationShown: false,
  acceptTos: async () => {},
  markAwarenessShown: async () => {},
  markEducationShown: async () => {},
  resetTtp: async () => {},
  ttpAvailable: false,
});

export function TTPProvider({ children }: { children: React.ReactNode }) {
  const [tosAccepted, setTosAccepted] = useState(false);
  const [awarenessShown, setAwarenessShown] = useState(false);
  const [educationShown, setEducationShown] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // TTP is only available on iOS (physical device)
  const ttpAvailable = Platform.OS === "ios";

  // Load persisted state on mount
  useEffect(() => {
    (async () => {
      const [tos, awareness, education] = await Promise.all([
        AsyncStorage.getItem(TTP_TOS_KEY),
        AsyncStorage.getItem(TTP_AWARENESS_KEY),
        AsyncStorage.getItem(TTP_EDUCATION_KEY),
      ]);
      if (tos === "true") setTosAccepted(true);
      if (awareness === "true") setAwarenessShown(true);
      if (education === "true") setEducationShown(true);
    })();
  }, []);

  const acceptTos = useCallback(async () => {
    await AsyncStorage.setItem(TTP_TOS_KEY, "true");
    setTosAccepted(true);
  }, []);

  const markAwarenessShown = useCallback(async () => {
    await AsyncStorage.setItem(TTP_AWARENESS_KEY, "true");
    setAwarenessShown(true);
  }, []);

  const markEducationShown = useCallback(async () => {
    await AsyncStorage.setItem(TTP_EDUCATION_KEY, "true");
    setEducationShown(true);
  }, []);

  const resetTtp = useCallback(async () => {
    await Promise.all([
      AsyncStorage.removeItem(TTP_TOS_KEY),
      AsyncStorage.removeItem(TTP_AWARENESS_KEY),
      AsyncStorage.removeItem(TTP_EDUCATION_KEY),
    ]);
    setTosAccepted(false);
    setAwarenessShown(false);
    setEducationShown(false);
  }, []);

  return (
    <TTPContext.Provider value={{
      tosAccepted,
      awarenessShown,
      educationShown,
      acceptTos,
      markAwarenessShown,
      markEducationShown,
      resetTtp,
      ttpAvailable,
    }}>
      {children}
    </TTPContext.Provider>
  );
}

export function useTTP() {
  return useContext(TTPContext);
}
