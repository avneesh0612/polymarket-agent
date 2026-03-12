/**
 * Dynamic Labs client setup for React Native.
 *
 * Docs: https://www.dynamic.xyz/docs/react-native/reference
 *
 * The SDK uses a client + WebView architecture:
 *   - `dynamicClient.reactNative.WebView` must be rendered at the app root
 *   - `useReactiveClient(dynamicClient)` gives reactive access to auth state
 *   - `dynamicClient.auth.token` — the user's JWT (null when logged out)
 *   - `dynamicClient.wallets.delegation.*` — delegation management
 *   - `dynamicClient.ui.auth.show()` — open the auth modal
 *
 * Not compatible with Expo Go — requires a dev build:
 *   npm run prebuild && expo run:ios
 */

import { createClient } from "@dynamic-labs/sdk-react-native";

const ENV_ID = process.env.EXPO_PUBLIC_DYNAMIC_ENVIRONMENT_ID;

if (!ENV_ID) {
  console.warn(
    "[dynamic] EXPO_PUBLIC_DYNAMIC_ENVIRONMENT_ID is not set. " +
      "Auth will not work. Add it to your .env file."
  );
}

export const dynamicClient = createClient({
  environmentId: ENV_ID ?? "",
  appName: "Web3 AI Agent",
});
