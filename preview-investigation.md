# Preview Investigation Notes

## 2026-08-12

- The stale copied static export was archived and the preview now returns a responsive single-page web shell.
- The current web bundle reaches `app/_layout.tsx` but stops before login because `expo-notifications` does not implement `getLastNotificationResponseAsync()` on web.
- The next repair is to guard notification-response initialization by platform so native behavior is preserved while the web preview proceeds to the Home Service Connection login screen.
