import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { trpc } from "@/lib/trpc";

const INVESTOR_TOKEN_KEY = "investor_session_token";

interface InvestorUser {
  investorId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  accountStatus: string;
  role?: string;
}

interface InvestorAuthContextType {
  investor: InvestorUser | null;
  token: string | null;
  isLoading: boolean;
  isInvestorAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const InvestorAuthContext = createContext<InvestorAuthContextType>({
  investor: null, token: null, isLoading: true, isInvestorAdmin: false,
  login: async () => {}, logout: async () => {},
});

export function InvestorAuthProvider({ children }: { children: React.ReactNode }) {
  const [investor, setInvestor] = useState<InvestorUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loginMutation = trpc.investor.login.useMutation();
  const logoutMutation = trpc.investor.logout.useMutation();
  const meQuery = trpc.investor.me.useQuery(
    { token: token ?? "" },
    { enabled: !!token, retry: false }
  );

  // Load saved token on mount
  useEffect(() => {
    AsyncStorage.getItem(INVESTOR_TOKEN_KEY).then((saved) => {
      if (saved) setToken(saved);
      else setIsLoading(false);
    });
  }, []);

  // When token loads, fetch investor profile
  useEffect(() => {
    if (meQuery.data) {
      setInvestor(meQuery.data as InvestorUser);
      setIsLoading(false);
    } else if (meQuery.isError) {
      setToken(null);
      setInvestor(null);
      AsyncStorage.removeItem(INVESTOR_TOKEN_KEY);
      setIsLoading(false);
    }
  }, [meQuery.data, meQuery.isError]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginMutation.mutateAsync({ email, password });
    await AsyncStorage.setItem(INVESTOR_TOKEN_KEY, result.token);
    setToken(result.token);
    setInvestor(result.investor as InvestorUser);
  }, [loginMutation]);

  const logout = useCallback(async () => {
    if (token) {
      try { await logoutMutation.mutateAsync({ token }); } catch {}
    }
    await AsyncStorage.removeItem(INVESTOR_TOKEN_KEY);
    setToken(null);
    setInvestor(null);
  }, [token, logoutMutation]);

  const isInvestorAdmin = investor?.role === 'investor_admin';

  return (
    <InvestorAuthContext.Provider value={{ investor, token, isLoading, isInvestorAdmin, login, logout }}>
      {children}
    </InvestorAuthContext.Provider>
  );
}

export function useInvestorAuth() {
  return useContext(InvestorAuthContext);
}
