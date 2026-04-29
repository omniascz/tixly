// ---------------------------------------------------------------------------
// SyncIndicator — badge showing number of unsynced local scans
// ---------------------------------------------------------------------------
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useScannerStore } from "../stores/scanner.store";

interface Props {
  onPress?: () => void;
}

export function SyncIndicator({ onPress }: Props) {
  const { syncStatus, cachedTicketCount, lastSyncAt } = useScannerStore();

  const statusColor =
    syncStatus === "idle"
      ? "#16a34a"
      : syncStatus === "syncing"
      ? "#ca8a04"
      : syncStatus === "error"
      ? "#dc2626"
      : "#6b7280"; // offline

  const statusLabel =
    syncStatus === "syncing"
      ? "Syncing..."
      : syncStatus === "error"
      ? "Sync error"
      : syncStatus === "offline"
      ? "Offline"
      : "Synced";

  return (
    <TouchableOpacity onPress={onPress} style={styles.container} activeOpacity={0.7}>
      <View style={[styles.dot, { backgroundColor: statusColor }]} />
      <Text style={styles.label}>{statusLabel}</Text>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{cachedTicketCount}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#1f2937",
    borderRadius: 20,
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    color: "#f9fafb",
    fontSize: 12,
    fontWeight: "500",
  },
  badge: {
    backgroundColor: "#374151",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: "center",
  },
  badgeText: {
    color: "#f9fafb",
    fontSize: 11,
    fontWeight: "700",
  },
});
