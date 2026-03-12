import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#1a73e8",
        headerShown: false,
        tabBarStyle: { backgroundColor: "#fff" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Agent",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubble-ellipses" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
