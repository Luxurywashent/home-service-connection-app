import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { trpc } from "./trpc";

const CUSTOMER_TOKEN_KEY = "customer_session_token";
const CUSTOMER_DATA_KEY = "customer_data";

export interface CustomerData {
  customerId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  profilePhotoUrl?: string | null;
}

interface CustomerContextType {
  customer: CustomerData | null;
  token: string | null;
  loading: boolean;
  loginCustomer: (token: string, customer: CustomerData) => Promise<void>;
  logoutCustomer: () => Promise<void>;
  isCustomerAuthenticated: boolean;
}

const CustomerContext = createContext<CustomerContextType>({
  customer: null,
  token: null,
  loading: true,
  loginCustomer: async () => {},
  logoutCustomer: async () => {},
  isCustomerAuthenticated: false,
});

export function CustomerProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [savedToken, savedCustomer] = await Promise.all([
          AsyncStorage.getItem(CUSTOMER_TOKEN_KEY),
          AsyncStorage.getItem(CUSTOMER_DATA_KEY),
        ]);
        if (savedToken && savedCustomer) {
          setToken(savedToken);
          setCustomer(JSON.parse(savedCustomer));
        }
      } catch (e) {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loginCustomer = async (newToken: string, newCustomer: CustomerData) => {
    await AsyncStorage.setItem(CUSTOMER_TOKEN_KEY, newToken);
    await AsyncStorage.setItem(CUSTOMER_DATA_KEY, JSON.stringify(newCustomer));
    setToken(newToken);
    setCustomer(newCustomer);
  };

  const logoutCustomer = async () => {
    await AsyncStorage.removeItem(CUSTOMER_TOKEN_KEY);
    await AsyncStorage.removeItem(CUSTOMER_DATA_KEY);
    setToken(null);
    setCustomer(null);
  };

  return (
    <CustomerContext.Provider
      value={{
        customer,
        token,
        loading,
        loginCustomer,
        logoutCustomer,
        isCustomerAuthenticated: !!customer && !!token,
      }}
    >
      {children}
    </CustomerContext.Provider>
  );
}

export function useCustomerAuth() {
  return useContext(CustomerContext);
}
