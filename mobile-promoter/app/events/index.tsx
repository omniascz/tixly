import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { apiFetch, ApiError } from '@/lib/api';
import { colors, radius, space } from '@/lib/theme';

interface EventItem {
  id:               string;
  title:            string;
  dateStart:        string;
  venueName:        string | null;
  status:           string;
  ticketsSold:      number;
  capacityTotal:    number;
  sellThroughPct:   number;
}

function statusBadge(s: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    published: { label: 'Živá', color: colors.success },
    draft:     { label: 'Koncept', color: colors.textMuted },
    cancelled: { label: 'Zrušená', color: colors.danger },
    ended:     { label: 'Proběhlá', color: colors.textMuted },
  };
  return map[s] ?? { label: s, color: colors.textMuted };
}

export default function PromoterEventsScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ events: EventItem[] }>('/api/admin/events?mobile=1&limit=50');
      setEvents(data.events);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chyba načítání');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!events && !error) {
    return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>;
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.btn} onPress={load}><Text style={styles.btnText}>Zkusit znovu</Text></Pressable>
      </View>
    );
  }

  if (!events || events.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Zatím nemáte žádné akce.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={events}
      keyExtractor={(e) => e.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      renderItem={({ item }) => {
        const badge = statusBadge(item.status);
        const pct   = Math.round(item.sellThroughPct);
        return (
          <Pressable
            style={styles.card}
            onPress={() => router.push(`/events/${item.id}`)}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
              <View style={[styles.badge, { backgroundColor: badge.color + '22' }]}>
                <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
              </View>
            </View>

            <Text style={styles.meta}>
              {new Date(item.dateStart).toLocaleString('cs-CZ', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
              {item.venueName ? ` · ${item.venueName}` : ''}
            </Text>

            {/* Sell-through progress bar */}
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${Math.min(100, pct)}%` as `${number}%` }]} />
            </View>
            <Text style={styles.progressLabel}>
              {item.ticketsSold} / {item.capacityTotal} vstupenek ({pct} %)
            </Text>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  list:          { padding: space.md, gap: space.sm },
  card:          { backgroundColor: colors.white, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: colors.border },
  cardHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title:         { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text, marginRight: space.sm },
  badge:         { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText:     { fontSize: 11, fontWeight: '600' },
  meta:          { fontSize: 13, color: colors.textMuted, marginBottom: 8 },
  progressBg:    { height: 6, backgroundColor: colors.bgMuted, borderRadius: radius.pill, overflow: 'hidden', marginBottom: 4 },
  progressFill:  { height: 6, backgroundColor: colors.brand, borderRadius: radius.pill },
  progressLabel: { fontSize: 12, color: colors.textMuted },
  errorText:     { color: colors.danger, textAlign: 'center', marginBottom: space.md },
  emptyText:     { color: colors.textMuted, fontSize: 15 },
  btn:           { backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  btnText:       { color: colors.white, fontWeight: '700' },
});
