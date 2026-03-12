import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { TouchableOpacity } from "react-native";
import { dynamicClient } from "../../lib/dynamic";

function ProfileButton() {
  return (
    <TouchableOpacity
      onPress={() => dynamicClient.ui.userProfile.show()}
      style={{ marginRight: 16 }}
    >
      <Ionicons name="person-circle-outline" size={28} color="#fff" />
    </TouchableOpacity>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#7c3aed",
        headerStyle: { backgroundColor: "#7c3aed" },
        headerTintColor: "#fff",
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
          headerRight: () => <ProfileButton />,
        }}
      />
    </Tabs>
  );
}
