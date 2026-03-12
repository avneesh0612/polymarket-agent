import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { dynamicClient } from "../lib/dynamic";

function ProfileButton() {
  return (
    <TouchableOpacity
      onPress={() => dynamicClient.ui.userProfile.show()}
      style={{ marginRight: 16 }}
    >
      <Ionicons name="person-circle-outline" size={28} color="#000" />
    </TouchableOpacity>
  );
}

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
            headerRight: () => <ProfileButton />,
          }}
        >
          <Stack.Screen
            name="(tabs)"
            options={{
              title: "Agent",
            }}
          />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
