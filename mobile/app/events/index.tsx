import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { apiFetch, ApiError } from '@/lib/api';
import { colors, radius, space } from '@/lib/theme';

export interface EventSummary {
  id: string;
  title: string;
  dateStart: string;
  city: string | null;
  venueName: string | null;
  coverImage: string | null;
  minPriceHalire: number | null;
  currency: string;
}

function formatPrice(halire: number | null, currency: string): string {
  if (halire == null) return '';
  const v = halire / 100;
  return `od ${v.toLocaleString('cs-CZ')} ${currency === 'EUR' ? '€' : 'Kč'}`;
}

export default function BrowseScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ events: EventSummary[] }>('/api/events/featured', { auth: false });
      setEvents(r.events);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Nepodařilo se načíst akce.');
      setEvents((x) => x ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (events === null && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={events ?? []}
      keyExtractor={(e) => e.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={<Text style={styles.empty}>{error ?? 'Žádné nadcházející akce.'}</Text>}
      renderItem={({ item }) => (
        <Pressable
          style={styles.card}
          onPress={() =>
            router.push({
              pathname: '/events/[id]',
              params: {
                id: item.id,
                title: item.title,
                dateStart: item.dateStart,
                venue: item.venueName ?? '',
                city: item.city ?? '',
                cover: item.coverImage ?? '',
                currency: item.currency,
              },
            })
          }
        >
          {item.coverImage ? (
            <Image source={{ uri: item.coverImage }} style={styles.cover} />
          ) : (
            <View style={[styles.cover, styles.coverFallback]}>
              <Text style={styles.coverFallbackText}>{item.title.slice(0, 1)}</Text>
            </View>
          )}
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={styles.cardMeta}>
              {new Date(item.dateStart).toLocaleDateString('cs-CZ', {
                day: 'numeric',
                month: 'long',
              })}
              {item.venueName ? ` · ${item.venueName}` : ''}
              {item.city ? `, ${item.city}` : ''}
            </Text>
            <Text style={styles.price}>{formatPrice(item.minPriceHalire, item.currency)}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: space.md, gap: space.md, flexGrow: 1 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: space.xl },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.white },
  cover: { width: '100%', height: 150, backgroundColor: colors.bgMuted },
  coverFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand },
  coverFallbackText: { color: colors.white, fontSize: 48, fontWeight: '900' },
  cardBody: { padding: space.md, gap: space.xs },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  cardMeta: { fontSize: 14, color: colors.textMuted },
  price: { fontSize: 15, fontWeight: '700', color: colors.brand, marginTop: space.xs },
});
