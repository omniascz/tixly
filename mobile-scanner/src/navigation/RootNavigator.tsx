// ---------------------------------------------------------------------------
// RootNavigator — Stack navigation for the scanner app
// ---------------------------------------------------------------------------
import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { EventSelectScreen } from "../screens/EventSelectScreen";
import { ScannerScreen } from "../screens/ScannerScreen";
import { ScanHistoryScreen } from "../screens/ScanHistoryScreen";
import { SyncStatusScreen } from "../screens/SyncStatusScreen";
import { SettingsScreen } from "../screens/SettingsScreen";

export type RootStackParamList = {
  EventSelect: undefined;
  Scanner: undefined;
  ScanHistory: undefined;
  SyncStatus: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="EventSelect"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#111827" },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="EventSelect" component={EventSelectScreen} />
        <Stack.Screen name="Scanner" component={ScannerScreen} />
        <Stack.Screen name="ScanHistory" component={ScanHistoryScreen} />
        <Stack.Screen name="SyncStatus" component={SyncStatusScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
