# Expo SDK 57 Upgrade Source

The iOS Expo Go application supports the current Expo SDK only, so an SDK 54 project must be upgraded before it can open in an Expo Go installation that targets SDK 57. Expo recommends incremental SDK upgrades, matching native package versions with `expo install --fix`, and validating the result with Expo Doctor.[1]

The documented SDK 57 target uses React Native 0.86 and React 19.2. Expo also recommends a current SDK 57 patch release because it includes fixes for earlier memory and startup regressions affecting projects that use Reanimated or Worklets.[2]

In SDK 56 and later, application code must not import from external `@react-navigation/*` packages when using Expo Router. The runtime API remains the same, but imports must move to `expo-router/react-navigation`, `expo-router/js-tabs`, or the equivalent Expo Router entry point.[3]

This project has no generated `ios/` or `android/` folders, so it uses Expo’s managed workflow and does not require native project migration in this repository.

## References

[1]: https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/ "Expo: Upgrade SDK"
[2]: https://expo.dev/changelog/sdk-57 "Expo SDK 57 changelog"
[3]: https://docs.expo.dev/router/migrate/sdk-55-to-56/ "Expo Router SDK 55 to 56 migration"
