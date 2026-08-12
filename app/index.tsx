import { Redirect } from "expo-router";

/**
 * Home Service Connection starts at sign-in. The copied public sales landing
 * page is intentionally not part of this independent CRM experience.
 */
export default function IndexRoute() {
  return <Redirect href="/login" />;
}
