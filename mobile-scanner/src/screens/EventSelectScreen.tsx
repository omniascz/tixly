// ---------------------------------------------------------------------------
// EventSelectScreen — choose which event to scan for
// ---------------------------------------------------------------------------
import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/RootNavigator";
import { useScannerStore } from "../stores/scanner.store";
import { useAuthStore } from "../stores/auth.store";
import { syncEvent } from "../services/sync.service";

type Props = NativeStackScreenProps<RootStackParamList, "EventSelect">;

interface EventItem {
  id: string;
  name: string;
  date: string;
  venue: string;
}

export function EventSelectScreen({ navigation }: Props) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const { selectEvent, setSyncStatus, updateCacheStats } = useScannerStore();
  const { deviceToken } = useAuthStore();

  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";

  const filteredEvents = events.filter(
    (e) =>
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.venue.toLowerCase().includes(search.toLowerCase())
  );

  async function handleSelectEvent(event: EventItem) {
    selectEvent(event.id);
    setSyncStatus("syncing");
    try {
      const result = await syncEvent(event.id, {
        apiBaseUrl,
        apiKey: deviceToken ?? "",
      });
      updateCacheStats(result.totalCached, result.syncedAt);
      setSyncStatus("idle");
      navigation.navigate("Scanner");
    } catch (err) {
      setSyncStatus("error");
      Alert.alert(
        "Sync failed",
        "Could not download tickets. You may scan in offline mode with previously cached data.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Scan Offline",
            onPress: () => navigation.navigate("Scanner"),
          },
        ]
      );
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Select Event</Text>
      <TextInput
        style={styles.search}
        placeholder="Search events..."
        placeholderTextColor="#9ca3af"
        value={search}
        onChangeText={setSearch}
      />
      {loading ? (
        <ActivityIndicator size="large" color="#6366f1" style={styles.loader} />
      ) : (
        <FlatList
          data={filteredEvents}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>No events available</Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => handleSelectEvent(item)}
              activeOpacity={0.7}
            >
              <Text style={styles.eventName}>{item.name}</Text>
              <Text style={styles.eventMeta}>
                {item.date} · {item.venue}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111827", padding: 16 },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#f9fafb",
    marginBottom: 16,
  },
  search: {
    backgroundColor: "#1f2937",
    color: "#f9fafb",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 12,
  },
  list: { gap: 10 },
  card: {
    backgroundColor: "#1f2937",
    borderRadius: 12,
    padding: 16,
  },
  eventName: { fontSize: 16, fontWeight: "600", color: "#f9fafb" },
  eventMeta: { fontSize: 13, color: "#9ca3af", marginTop: 4 },
  loader: { marginTop: 40 },
  empty: { color: "#6b7280", textAlign: "center", marginTop: 40 },
});
