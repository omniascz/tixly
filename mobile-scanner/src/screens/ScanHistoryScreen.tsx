// ---------------------------------------------------------------------------
// ScanHistoryScreen — log of recently scanned tickets
// ---------------------------------------------------------------------------
import React from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { useScannerStore } from "../stores/scanner.store";
import type { ScanRecord } from "../types/scanner.types";

type Props = NativeStackScreenProps<RootStackParamList, "ScanHistory">;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function HistoryItem({ item }: { item: ScanRecord }) {
  return (
    <View style={[styles.card, item.success ? styles.cardSuccess : styles.cardFail]}>
      <View style={styles.cardLeft}>
        <Text style={styles.icon}>{item.success ? "✓" : "✗"}</Text>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.ticketId} numberOfLines={1}>
          {item.ticketId || "—"}
        </Text>
        {item.success ? (
          <>
            <Text style={styles.holderName}>{item.holderName}</Text>
            <Text style={styles.seatInfo}>{item.seatInfo}</Text>
          </>
        ) : (
          <Text style={styles.errorText}>{item.error}</Text>
        )}
      </View>
      <Text style={styles.time}>{formatTime(item.scannedAt)}</Text>
    </View>
  );
}

export function ScanHistoryScreen({ navigation }: Props) {
  const { scanHistory, clearHistory } = useScannerStore();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Scan History</Text>
        <TouchableOpacity onPress={clearHistory}>
          <Text style={styles.clear}>Clear</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={scanHistory}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>No scans yet</Text>
        }
        renderItem={({ item }) => <HistoryItem item={item} />}
      />
    </SafeAreaView>
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
  clear: { color: "#ef4444", fontSize: 14 },
  list: { padding: 12, gap: 8 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  cardSuccess: { backgroundColor: "#14532d" },
  cardFail: { backgroundColor: "#450a0a" },
  cardLeft: { width: 28, alignItems: "center" },
  icon: { fontSize: 20, color: "#fff", fontWeight: "700" },
  cardBody: { flex: 1 },
  ticketId: {
    fontSize: 11,
    color: "rgba(255,255,255,0.6)",
    fontFamily: "monospace",
    marginBottom: 2,
  },
  holderName: { fontSize: 14, fontWeight: "600", color: "#f9fafb" },
  seatInfo: { fontSize: 12, color: "#86efac" },
  errorText: { fontSize: 13, color: "#fca5a5", fontWeight: "500" },
  time: { fontSize: 11, color: "rgba(255,255,255,0.5)" },
  empty: { color: "#6b7280", textAlign: "center", marginTop: 60, fontSize: 16 },
});
