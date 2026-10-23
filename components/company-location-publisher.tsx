import { useEffect, useMemo, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { shouldPublishCompanyLocation, shouldUseBackgroundCompanyLocation } from "@/lib/company-location-policy";
import {
  getHomeServiceConnectedTimeState,
  getJobSyncMobileSession,
  isRequestCancellation,
  publishJobSyncCompanyLocation,
} from "@/lib/jobsync-mobile-api";
import { LocationDisclosureModal } from "@/components/location-disclosure-modal";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import {
  COMPANY_LOCATION_TASK,
  acceptScopedCompanyLocationDisclosure,
  authorizeCompanyLocationBackgroundTracking,
  createCompanyLocationSessionScope,
  hasScopedCompanyLocationDisclosure,
  invalidateCompanyLocationBackgroundAuthorization,
  readStoredJobSyncMobileBearer,
  readValidCompanyLocationBackgroundAuthorization,
  sameCompanyLocationSessionScope,
} from "@/lib/company-location-session-authorization";

const PUBLISH_INTERVAL_MS = 2 * 60 * 1000;
let foregroundPermissionRequested = false;

if (Platform.OS !== "web") {
  try {
    TaskManager.defineTask(COMPANY_LOCATION_TASK, async ({ data, error }) => {
      if (error || !data) return;
      const locations = (data as { locations?: { coords: { latitude: number; longitude: number; accuracy?: number | null } }[] }).locations;
      const latest = locations?.[locations.length - 1];
      if (!latest) return;
      const authorization = await readValidCompanyLocationBackgroundAuthorization();
      const scope = authorization && createCompanyLocationSessionScope({
        token: authorization.token,
        userId: authorization.userId,
        companyId: authorization.companyId,
        role: authorization.role,
      });
      const storedToken = await readStoredJobSyncMobileBearer();
      if (!authorization || !scope || !storedToken || storedToken !== authorization.token) {
        await invalidateCompanyLocationBackgroundAuthorization(scope ?? undefined);
        return;
      }

      try {
        // Revalidate the durable authorization against the current server session and clock state
        // before every native update. A stale role, account, clock-out, or failed validation is fail-closed.
        const [session, time] = await Promise.all([
          getJobSyncMobileSession(storedToken),
          getHomeServiceConnectedTimeState(storedToken),
        ]);
        const currentScope = session.portal === "company"
          ? createCompanyLocationSessionScope({
            token: session.token,
            userId: session.user.id,
            companyId: session.company?.id,
            role: session.user.role,
          })
          : null;
        if (!currentScope || !sameCompanyLocationSessionScope(scope, currentScope) || !time.isClockedIn) {
          await invalidateCompanyLocationBackgroundAuthorization(scope);
          return;
        }
        if (!await authorizeCompanyLocationBackgroundTracking(currentScope)) {
          await invalidateCompanyLocationBackgroundAuthorization(scope);
          return;
        }
        // The logout/account-switch path can run while the remote checks above are in
        // flight. Read storage again so this task cannot publish after it is revoked.
        const [currentAuthorization, currentBearer] = await Promise.all([
          readValidCompanyLocationBackgroundAuthorization(),
          readStoredJobSyncMobileBearer(),
        ]);
        if (!currentAuthorization || currentBearer !== storedToken
          || !sameCompanyLocationSessionScope(currentAuthorization, currentScope)) {
          await invalidateCompanyLocationBackgroundAuthorization(scope);
          return;
        }
        await publishJobSyncCompanyLocation(storedToken, {
          latitude: latest.coords.latitude,
          longitude: latest.coords.longitude,
          ...(typeof latest.coords.accuracy === "number" ? { accuracyMeters: latest.coords.accuracy } : {}),
        });
      } catch {
        // Background verification must fail closed rather than publish under an uncertain session.
        await invalidateCompanyLocationBackgroundAuthorization(scope);
      }
    });
  } catch {
    // Native task registration is unavailable in this runtime.
  }
}

export function CompanyLocationPublisher({ token, role }: { token: string; role?: string }) {
  const { session } = useJobSyncAuth();
  const [disclosureVisibleScopeKey, setDisclosureVisibleScopeKey] = useState<string | null>(null);
  const [acceptedDisclosureScopeKey, setAcceptedDisclosureScopeKey] = useState<string | null>(null);
  const scope = useMemo(() => {
    if (!session || session.portal !== "company" || session.token !== token || session.user.role !== role) return null;
    return createCompanyLocationSessionScope({
      token: session.token,
      userId: session.user.id,
      companyId: session.company?.id,
      role: session.user.role,
    });
  }, [role, session, token]);
  const scopeKey = scope ? `${scope.userId}:${scope.companyId}:${scope.token}:${scope.role}` : null;
  const disclosureVisible = scopeKey !== null && disclosureVisibleScopeKey === scopeKey;
  const disclosureAccepted = scopeKey !== null && acceptedDisclosureScopeKey === scopeKey;

  useEffect(() => {
    let cancelled = false;
    if (!scope || scope.role !== "technician") {
      return () => { cancelled = true; };
    }
    void hasScopedCompanyLocationDisclosure(scope).then((accepted) => {
      if (!cancelled) setAcceptedDisclosureScopeKey(accepted ? scopeKey : null);
    });
    return () => { cancelled = true; };
  }, [scope, scopeKey]);

  useEffect(() => {
    if (!scope || scope.role !== "technician") return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const publishForeground = async (clockedIn: boolean) => {
      const foreground = await Location.getForegroundPermissionsAsync();
      const appActive = AppState.currentState === "active";
      if (!shouldPublishCompanyLocation({
        role,
        clockedIn,
        disclosureAccepted,
        foregroundGranted: foreground.status === "granted",
        appActive,
      })) return;
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (cancelled) return;
      await publishJobSyncCompanyLocation(token, {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        ...(typeof position.coords.accuracy === "number" ? { accuracyMeters: position.coords.accuracy } : {}),
      });
    };

    const syncTracking = async () => {
      if (AppState.currentState !== "active") return;
      let clockedIn = false;
      try {
        const time = await getHomeServiceConnectedTimeState(token);
        clockedIn = time.isClockedIn;
      } catch (error) {
        if (isRequestCancellation(error)) return;
        clockedIn = false;
      }
      if (cancelled) return;
      if (clockedIn && !disclosureAccepted) {
        const accepted = await hasScopedCompanyLocationDisclosure(scope);
        if (!accepted) {
          setDisclosureVisibleScopeKey(scopeKey);
          await invalidateCompanyLocationBackgroundAuthorization(scope);
          return;
        }
        setAcceptedDisclosureScopeKey(scopeKey);
      }
      if (!clockedIn || !disclosureAccepted) {
        await invalidateCompanyLocationBackgroundAuthorization(scope);
        return;
      }
      const foreground = await Location.getForegroundPermissionsAsync();
      if (foreground.status !== "granted") {
        if (foregroundPermissionRequested) {
          await invalidateCompanyLocationBackgroundAuthorization(scope);
          return;
        }
        foregroundPermissionRequested = true;
        const requested = await Location.requestForegroundPermissionsAsync();
        if (requested.status !== "granted") {
          await invalidateCompanyLocationBackgroundAuthorization(scope);
          return;
        }
      }
      const background = Platform.OS === "web" ? { status: "denied" as const } : await Location.getBackgroundPermissionsAsync();
      if (shouldUseBackgroundCompanyLocation({
        role,
        clockedIn,
        disclosureAccepted,
        backgroundAlreadyGranted: background.status === "granted",
      })) {
        const authorized = await authorizeCompanyLocationBackgroundTracking(scope);
        if (!authorized || cancelled) {
          await invalidateCompanyLocationBackgroundAuthorization(scope);
          return;
        }
        const started = await Location.hasStartedLocationUpdatesAsync(COMPANY_LOCATION_TASK).catch(() => false);
        if (!started) {
          await Location.startLocationUpdatesAsync(COMPANY_LOCATION_TASK, {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: PUBLISH_INTERVAL_MS,
            distanceInterval: 50,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: "On shift",
              notificationBody: "Sharing your location with dispatch while you are clocked in.",
            },
          }).catch(() => undefined);
        }
      } else {
        await invalidateCompanyLocationBackgroundAuthorization(scope);
      }
      await publishForeground(clockedIn).catch(() => undefined);
    };

    void syncTracking();
    timer = setInterval(() => { void syncTracking(); }, PUBLISH_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", () => { void syncTracking(); });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      subscription.remove();
      // Unmount, role change, token change, and account change all revoke native tracking.
      void invalidateCompanyLocationBackgroundAuthorization(scope);
    };
  }, [disclosureAccepted, role, scope, scopeKey, token]);

  if (!scope || scope.role !== "technician") return null;
  return (
    <LocationDisclosureModal
      visible={disclosureVisible}
      onAccept={() => {
        void acceptScopedCompanyLocationDisclosure(scope).then((disclosure) => {
          if (disclosure) {
            setAcceptedDisclosureScopeKey(scopeKey);
            setDisclosureVisibleScopeKey(null);
          }
        });
      }}
      onDecline={() => setDisclosureVisibleScopeKey(null)}
    />
  );
}
