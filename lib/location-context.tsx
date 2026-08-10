import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "selectedLocationId";

interface LocationContextValue {
  selectedLocationId: string | null;
  setSelectedLocationId: (id: string | null) => void;
}

const LocationContext = createContext<LocationContextValue>({
  selectedLocationId: null,
  setSelectedLocationId: () => {},
});

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [selectedLocationId, setSelectedLocationIdState] = useState<string | null>(null);

  // Load persisted value on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val) setSelectedLocationIdState(val);
    });
  }, []);

  const setSelectedLocationId = useCallback((id: string | null) => {
    setSelectedLocationIdState(id);
    if (id) {
      AsyncStorage.setItem(STORAGE_KEY, id);
    } else {
      AsyncStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  return (
    <LocationContext.Provider value={{ selectedLocationId, setSelectedLocationId }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  return useContext(LocationContext);
}
