export function getMobileConnectionErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();

  if (
    /network connection was lost|network request failed|fetch failed|failed to fetch|network is unavailable|internet connection appears to be offline/.test(
      normalized,
    )
  ) {
    return "Connection lost. Your Schedule is still available; check your internet connection and retry.";
  }

  if (/aborterror|timed out|timeout/.test(normalized)) {
    return "Home Service Connected is taking too long to respond. Your Schedule is still available; please retry.";
  }

  return message.trim() || fallback;
}
