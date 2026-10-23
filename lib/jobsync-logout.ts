export async function completeJobSyncLogout(steps: {
  revokeRemote: () => Promise<void>;
  revokeBackground: () => Promise<void>;
  clearQueries: () => Promise<void>;
  clearStoredSession: () => Promise<void>;
}) {
  try {
    await steps.revokeBackground();
    await steps.clearQueries();
    await steps.revokeRemote();
  } finally {
    // Offline logout must still remove this device's persisted credential. The
    // rejected remote request stays visible to the caller, never a success claim.
    await steps.clearStoredSession();
  }
}
