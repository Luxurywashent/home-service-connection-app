import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type EmployeeRole = "detailer" | "admin" | "office" | "operations_manager" | "door_hanger_rep" | "sales";

export interface EmployeeSession {
  employeeId: string;
  fullName: string;
  email: string | null;
  role: EmployeeRole;
  city: string | null;
  hireDate: string | null;
  profilePhotoUrl: string | null;
  phoneNumber: string | null;
  hourlyRate: number | null;
  upsellBonusPct: number | null;
}

interface AuthContextType {
  employee: EmployeeSession | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isOpsManager: boolean;
  isDoorHangerRep: boolean;
  isSalesRep: boolean;
  loading: boolean;
  login: (employee: EmployeeSession, rememberMe: boolean) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  employee: null,
  isAuthenticated: false,
  isAdmin: false,
  isOpsManager: false,
  isDoorHangerRep: false,
  isSalesRep: false,
  loading: true,
  login: async () => {},
  logout: async () => {},
});

const STORAGE_KEY = "tlw_employee_session";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [employee, setEmployee] = useState<EmployeeSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((data) => {
      if (data) {
        try {
          setEmployee(JSON.parse(data));
        } catch {}
      }
      setLoading(false);
    });
  }, []);

  const login = useCallback(async (emp: EmployeeSession, rememberMe: boolean) => {
    setEmployee(emp);
    if (rememberMe) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(emp)).catch(() => {});
    } else {
      await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    }
  }, []);

  const logout = useCallback(async () => {
    // Clear the per-employee schedule cache before wiping employee state
    if (employee?.employeeId) {
      await AsyncStorage.removeItem(`tlw_schedule_jobs_v9_${employee.employeeId}`).catch(() => {});
    }
    setEmployee(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
    // Also clear old shared cache keys so stale jobs from another user don't persist
    await AsyncStorage.removeItem("tlw_schedule_jobs_v8").catch(() => {});
    await AsyncStorage.removeItem("tlw_schedule_jobs_v9_anon").catch(() => {});
  }, [employee?.employeeId]);

  const isAdmin = employee?.role === "admin" || employee?.role === "office" || employee?.role === "operations_manager";
  const isOpsManager = employee?.role === "operations_manager";
  const isDoorHangerRep = employee?.role === "door_hanger_rep";
  const isSalesRep = employee?.role === "sales" || employee?.role === "door_hanger_rep";

  return (
    <AuthContext.Provider value={{ employee, isAuthenticated: !!employee, isAdmin, isOpsManager, isDoorHangerRep, isSalesRep, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useEmployeeAuth() {
  return useContext(AuthContext);
}
