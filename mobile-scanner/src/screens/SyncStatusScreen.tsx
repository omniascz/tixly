// ---------------------------------------------------------------------------
// SyncStatusScreen — sync status, cache stats, manual sync trigger
// ---------------------------------------------------------------------------
import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { useScannerStore } from "../stores/scanner.store";
import { useAuthStore } from "../stores/auth.store";
import { forcSync } from "../services/sync.service";

type Props = NativeStackScreenProps<RootStackParamList, "SyncStatus">;

export function SyncStatusScreen({ navigation }: Props) {
  const {
    selectedEventId,
    syncStatus,
    lastSyncAt,
    cachedTicketCount,
    setSyncStatus,
    updateCacheStats,
  } = useScannerStore();
  const { deviceToken } = useAuthStore();

  const [manualSyncing, setManualSyncing] = useState(false);
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";

  async function handleForceSync() {
    if (!selectedEventId) {
      Alert.alert("No event selected", "Please select an event first.");
      return;
    }
    setManualSyncing(true);
    setSyncStatus("syncing");
    try {
      const result = await forcSync(selectedEventId, {
        apiBaseUrl,
        apiKey: deviceToken ?? "",
      });
      updateCacheStats(result.totalCached, result.syncedAt);
      setSyncStatus("idle");
      Alert.alert(
        "Sync complete",
        `Added: ${result.added} · Updated: ${result.updated} · Deleted: ${result.deleted}\nTotal cached: ${result.totalCached}`
      );
    } catch (err) {
      setSyncStatus("error");
      Alert.alert("Sync failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setManualSyncing(false);
    }
  }

  const statusColour =
    syncStatus === "idle"
      ? "#16a34a"
      : syncStatus === "syncing"
      ? "#ca8a04"
      : syncStatus === "error"
      ? "#dc2626"
      : "#6b7280";

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Sync Status</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.body}>
        <StatCard label="Status" value={syncStatus.toUpperCase()} valueColor={statusColour} />
        <StatCard label="Cached Tickets" value={String(cachedTicketCount)} />
        <StatCard
          label="Last Synced"
          value={lastSyncAt ? new Date(lastSyncAt).toLocaleString() : "Never"}
        />
        <StatCard label="Selected Event" value={selectedEventId ?? "—"} mono />

        <TouchableOpacity
          style={[styles.syncBtn, manualSyncing && styles.syncBtnDisabled]}
          onPress={handleForceSync}
          disabled={manualSyncing}
        >
          {manualSyncing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.syncBtnText}>Force Full Sync</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function StatCard({
  label,
  value,
  valueColor,
  mono,
}: {
  label: string;
  value: string;
  valueColor?: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text
        style={[
          styles.statValue,
          valueColor ? { color: valueColor } : undefined,
          mono ? { fontFamily: "monospace", fontSize: 12 } : undefined,
        ]}
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
  body: { padding: 16, gap: 12 },
  statCard: {
    backgroundColor: "#1f2937",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statLabel: { color: "#9ca3af", fontSize: 14 },
  statValue: { color: "#f9fafb", fontSize: 16, fontWeight: "600" },
  syncBtn: {
    backgroundColor: "#6366f1",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  syncBtnDisabled: { opacity: 0.6 },
  syncBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
