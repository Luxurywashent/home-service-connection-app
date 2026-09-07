import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import {
  getHomeServiceConnectedPriceBook,
  type HomeServiceConnectedPriceBookService,
} from "@/lib/jobsync-mobile-api";

type CompanyPriceBookState = {
  services: HomeServiceConnectedPriceBookService[];
  isLoading: boolean;
  error: string | null;
};

const INITIAL_STATE: CompanyPriceBookState = {
  services: [],
  isLoading: false,
  error: null,
};

/** Reads only active services from the signed-in Company workspace. */
export function useCompanyPriceBook() {
  const { session } = useJobSyncAuth();
  const isCompanySession = session?.portal === "company";
  const [state, setState] = useState<CompanyPriceBookState>(INITIAL_STATE);

  const refresh = useCallback(async () => {
    if (!isCompanySession || !session?.token) {
      setState(INITIAL_STATE);
      return;
    }
    setState((current) => ({ ...current, isLoading: true, error: null }));
    try {
      const services = await getHomeServiceConnectedPriceBook(session.token);
      setState({ services, isLoading: false, error: null });
    } catch (error) {
      setState({
        services: [],
        isLoading: false,
        error: error instanceof Error ? error.message : "Home Service Connected could not load this Company Price Book.",
      });
    }
  }, [isCompanySession, session?.token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  return { ...state, isCompanySession, refresh };
}
