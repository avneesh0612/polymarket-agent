# Dynamic Mobile SDK Integration Guide

## Overview

The Dynamic React Native SDK provides wallet authentication and delegation for the mobile app. The app uses it for three core flows:

1. **User login / wallet connect** — Dynamic handles authentication via an embedded WebView that presents login, MFA, and wallet creation UI.
2. **Wallet delegation** — After login the user can grant the agent permission to sign transactions on their behalf. Dynamic fires a `wallet.delegation.created` webhook to the backend when the user approves.
3. **Revoking delegation** — The user can revoke the agent's signing permission at any time. Dynamic fires a `wallet.delegation.revoked` webhook to the backend, which deletes the delegation record.

---

## Installation

Install the three Dynamic packages:

```bash
bun add @dynamic-labs/client @dynamic-labs/react-native-extension @dynamic-labs/react-hooks
```

> **Note:** The Dynamic SDK is **not** compatible with Expo Go because it requires native modules. You must use a dev build:
>
> ```bash
> npx expo prebuild
> npx expo run:ios   # or run:android
> ```

---

## Client Setup

**`mobile/lib/dynamic.ts`**

```typescript
import { createClient } from "@dynamic-labs/client";
import { ReactNativeExtension } from "@dynamic-labs/react-native-extension";

const ENV_ID = process.env.EXPO_PUBLIC_DYNAMIC_ENVIRONMENT_ID;

if (!ENV_ID) {
  console.warn(
    "[dynamic] EXPO_PUBLIC_DYNAMIC_ENVIRONMENT_ID is not set. " +
      "Auth will not work. Add it to your .env file.",
  );
}

export const dynamicClient = createClient({
  environmentId: ENV_ID ?? "",
  appName: "Web3 AI Agent",
}).extend(ReactNativeExtension());
```

The `ReactNativeExtension` enables the embedded WebView and the WaaS (Wallet-as-a-Service) delegation APIs.

**Environment variable:** `EXPO_PUBLIC_DYNAMIC_ENVIRONMENT_ID`

The `EXPO_PUBLIC_` prefix is required by Expo so the value is inlined at build time and available in the JavaScript bundle. Add it to `mobile/.env`:

```
EXPO_PUBLIC_DYNAMIC_ENVIRONMENT_ID=your-environment-id-here
```

Obtain your environment ID from the [Dynamic dashboard](https://app.dynamic.xyz) under **Environments**.

---

## WebView Setup

The Dynamic SDK uses a client + WebView architecture. The `dynamicClient.reactNative.WebView` component **must be rendered at the root of the app** so the auth and delegation UI can overlay any screen.

**`mobile/app/_layout.tsx`**

```tsx
import { dynamicClient } from "../lib/dynamic";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {/*
          Dynamic's React Native SDK requires its WebView to be rendered at
          the root of the app so the auth UI can overlay any screen.
          This WebView handles login, MFA, and wallet delegation flows.
        */}
        <dynamicClient.reactNative.WebView />
        <Stack ...>
          ...
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

The WebView is invisible until Dynamic needs to display UI (login modal, MFA, delegation approval). Rendering it at the root ensures it is always mounted and can overlay any screen in the navigation stack.

---

## Reactive Auth State

Use the `useReactiveClient` hook from `@dynamic-labs/react-hooks` to subscribe to auth state changes:

```typescript
import { useReactiveClient } from "@dynamic-labs/react-hooks";
import { dynamicClient } from "../lib/dynamic";

const { auth } = useReactiveClient(dynamicClient);
const authToken = auth.token;
```

`auth.token` is:
- `null` when the user is not authenticated
- A JWT string when the user is logged in

The hook re-renders the component whenever the auth state changes (login, logout, token refresh), so downstream UI always reflects the current state.

---

## Opening the Auth Modal

To prompt the user to connect their wallet, call:

```typescript
dynamicClient.ui.auth.show();
```

This opens the Dynamic auth modal (rendered in the WebView), which handles wallet creation, existing wallet import, and social/email login depending on your Dynamic environment configuration.

In the app this is called when the user taps the "Connect wallet" banner or attempts to send a message while unauthenticated:

```typescript
// In ChatInterface.tsx — send button press handler
if (!authToken) {
  dynamicClient.ui.auth.show();
  return;
}
```

---

## Initiating Wallet Delegation

Delegation lets the agent sign transactions on behalf of the user. Before prompting, check whether the user still needs to delegate:

```typescript
const promptDelegation = async () => {
  try {
    const shouldPrompt =
      await dynamicClient.wallets.waas.delegation.shouldPromptWalletDelegation();
    if (shouldPrompt) {
      await dynamicClient.wallets.waas.delegation.initDelegationProcess({});
    }
  } catch (err) {
    console.warn("[delegation] prompt error:", err);
  }
};
```

- `shouldPromptWalletDelegation()` returns `true` if the user has not yet delegated (or if a previous delegation was revoked).
- `initDelegationProcess({})` opens the delegation approval UI inside the Dynamic WebView. The user reviews and approves the delegation grant.
- When the user approves, Dynamic fires the **`wallet.delegation.created`** webhook to the configured backend URL. The backend stores the delegation credentials so the agent can sign transactions later.

---

## Revoking Delegation

The user can revoke the agent's signing access at any time:

```typescript
const revokeDelegation = async () => {
  try {
    const walletsStatus =
      await dynamicClient.wallets.waas.delegation.getWalletsDelegatedStatus();
    const delegatedWallets = walletsStatus
      .filter((w: { isDelegated: boolean }) => w.isDelegated)
      .map((w: { chainName: string; accountAddress: string }) => ({
        chainName: w.chainName,
        accountAddress: w.accountAddress,
      }));
    if (delegatedWallets.length === 0) return;
    await dynamicClient.wallets.waas.delegation.revokeDelegation({
      wallets: delegatedWallets,
    });
    setIsDelegated(false);
  } catch (err) {
    console.warn("[delegation] revoke error:", err);
  }
};
```

- `getWalletsDelegatedStatus()` returns the delegation state for every wallet in the user's account.
- The code filters to only wallets where `isDelegated === true` and passes them to `revokeDelegation`.
- Dynamic fires the **`wallet.delegation.revoked`** webhook → the backend deletes the stored delegation record and the agent loses signing access immediately.

---

## Checking Delegation Status from the Backend

After login the app calls `GET /api/delegation/status` with the user's JWT to determine whether the agent currently has an active delegation. This populates the `isDelegated` state used by the banner:

```typescript
// In ChatInterface.tsx — runs on authToken change
getDelegationStatus(authToken)
  .then((s) => setIsDelegated(s.delegated))
  .catch(() => setIsDelegated(false));
```

The `getDelegationStatus` API client function (from `mobile/lib/api.ts`) returns:

```typescript
// { delegated: boolean, address?: string, chain?: string }
const status = await getDelegationStatus(authToken);
```

The backend looks up the delegation record by the user's wallet address (extracted from the JWT) and returns `{ delegated: true }` if a valid delegation exists, `{ delegated: false }` otherwise.

---

## The Status Banner UX Pattern

`ChatInterface.tsx` renders a persistent banner at the top of the screen that reflects the user's current auth and delegation state. There are three states:

| State | Banner color | Text | Action |
|-------|-------------|------|--------|
| Not authenticated (`authToken === null`) | Blue | "Connect wallet to start chatting" | `dynamicClient.ui.auth.show()` |
| Authenticated, not delegated (`isDelegated === false`) | Amber | "Grant wallet access for trading" | `promptDelegation()` |
| Authenticated and delegated (`isDelegated === true`) | Green | "Agent active · Tap to revoke" | `revokeDelegation()` |

The banner is implemented as a `StatusBanner` component in `ChatInterface.tsx`:

```tsx
<StatusBanner
  authToken={authToken}
  isDelegated={isDelegated}
  onAuthPress={() => dynamicClient.ui.auth.show()}
  onDelegatePress={promptDelegation}
  onRevokePress={revokeDelegation}
/>
```

`isDelegated` is initialized to `null` (banner hidden) and is set to `true` or `false` once the backend status check completes after login. Logging out resets `isDelegated` back to `null`.

The same guard is applied when the user tries to send a message: unauthenticated users are redirected to the auth modal, authenticated-but-undelegated users are shown the delegation prompt, and fully set-up users proceed to send the message to the agent.

---

## Required Environment Variable

| Variable | Location | Description |
|----------|----------|-------------|
| `EXPO_PUBLIC_DYNAMIC_ENVIRONMENT_ID` | `mobile/.env` | Dynamic environment ID from the Dynamic dashboard. The `EXPO_PUBLIC_` prefix is required for Expo to inline the value at build time. |
