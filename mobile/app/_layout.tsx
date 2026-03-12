import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context"; 
import { GestureHandlerRootView } from "react-native-gesture-handler";
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
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: "#fff" },
            headerTintColor: "#000",
            headerTitleStyle: { fontWeight: "600" },
          }}
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
