// ---------------------------------------------------------------------------
// SettingsScreen — server URL, API key, operator info
// ---------------------------------------------------------------------------
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ScrollView,
  Switch,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { useAuthStore } from "../stores/auth.store";
import { logout } from "../services/auth.service";

type Props = NativeStackScreenProps<RootStackParamList, "Settings">;

const API_URL_KEY = "tixly_api_url";

export function SettingsScreen({ navigation }: Props) {
  const { operatorName, deviceToken, clearCredentials } = useAuthStore();
  const [apiUrl, setApiUrl] = useState("");
  const [editingUrl, setEditingUrl] = useState(false);
  const [tempUrl, setTempUrl] = useState("");

  useEffect(() => {
    SecureStore.getItemAsync(API_URL_KEY).then((val) => {
      if (val) setApiUrl(val);
    });
  }, []);

  async function saveApiUrl() {
    await SecureStore.setItemAsync(API_URL_KEY, tempUrl.trim());
    setApiUrl(tempUrl.trim());
    setEditingUrl(false);
  }

  async function handleLogout() {
    Alert.alert("Log out", "Remove device credentials from this device?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: async () => {
          await logout();
          clearCredentials();
          navigation.navigate("EventSelect");
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Operator info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Operator</Text>
          <SettingRow label="Name" value={operatorName ?? "—"} />
          <SettingRow
            label="Device Token"
            value={deviceToken ? `${deviceToken.slice(0, 12)}...` : "—"}
            mono
          />
        </View>

        {/* Server */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Server</Text>
          {editingUrl ? (
            <View style={styles.editRow}>
              <TextInput
                style={styles.input}
                value={tempUrl}
                onChangeText={setTempUrl}
                placeholder="https://api.tixly.io"
                placeholderTextColor="#6b7280"
                autoCapitalize="none"
                keyboardType="url"
              />
              <TouchableOpacity style={styles.saveBtn} onPress={saveApiUrl}>
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => {
                setTempUrl(apiUrl);
                setEditingUrl(true);
              }}
            >
              <SettingRow label="API URL" value={apiUrl || "Not set"} />
            </TouchableOpacity>
          )}
        </View>

        {/* Danger zone */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutBtnText}>Log Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text
        style={[styles.settingValue, mono && { fontFamily: "monospace", fontSize: 12 }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111827" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  back: { color: "#6366f1", fontSize: 15, fontWeight: "600" },
  title: { color: "#f9fafb", fontSize: 18, fontWeight: "700" },
  body: { padding: 16, gap: 20 },
  section: {
    backgroundColor: "#1f2937",
    borderRadius: 14,
    overflow: "hidden",
  },
  sectionTitle: {
    color: "#6b7280",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#374151",
  },
  settingLabel: { color: "#9ca3af", fontSize: 14 },
  settingValue: { color: "#f9fafb", fontSize: 14, maxWidth: "60%", textAlign: "right" },
  editRow: { flexDirection: "row", alignItems: "center", padding: 12, gap: 8 },
  input: {
    flex: 1,
    backgroundColor: "#111827",
    color: "#f9fafb",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  saveBtn: {
    backgroundColor: "#6366f1",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  saveBtnText: { color: "#fff", fontWeight: "700" },
  logoutBtn: {
    margin: 12,
    backgroundColor: "#7f1d1d",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  logoutBtnText: { color: "#fca5a5", fontWeight: "700", fontSize: 15 },
});
