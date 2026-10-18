export type CompanyClockIntent = "clock-in" | "clock-out" | "break-start" | "break-end";

export type CompanyClockServerState = {
  isClockedIn: boolean;
  clockInAt: string | null;
  activeBreak: { isActive: boolean; startedAt: string | null } | null;
};

export type CompanyClockReconcileResult =
  | { status: "confirmed"; state: CompanyClockServerState }
  | { status: "rejected"; message: string }
  | { status: "unknown"; message: string };

const UNCONFIRMED = "Could not confirm this time action with Home Service Connected. Check your connection, then look at the shift status before trying again.";

export function clockActionMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to update your time status.";
}

export function reconcileClockAction(
  intent: CompanyClockIntent,
  server: CompanyClockServerState | null,
  actionError: unknown,
): CompanyClockReconcileResult {
  if (!server) {
    return { status: "unknown", message: actionError ? `${clockActionMessage(actionError)} ${UNCONFIRMED}` : UNCONFIRMED };
  }
  if (intent === "clock-in") {
    if (server.isClockedIn && server.clockInAt) return { status: "confirmed", state: server };
    return { status: "rejected", message: "Clock in did not start. You are not on a shift." };
  }
  if (intent === "clock-out") {
    if (!server.isClockedIn) return { status: "confirmed", state: server };
    return { status: "rejected", message: "Clock out was not confirmed. You are still on a shift." };
  }
  if (intent === "break-start") {
    if (server.isClockedIn && server.activeBreak?.isActive) return { status: "confirmed", state: server };
    return { status: "rejected", message: "The break was not confirmed. Refresh your shift status before trying again." };
  }
  if (server.isClockedIn && !server.activeBreak?.isActive) return { status: "confirmed", state: server };
  return { status: "rejected", message: "Ending the break was not confirmed. Refresh your shift status before trying again." };
}
