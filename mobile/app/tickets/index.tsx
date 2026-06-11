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
import { clearSession } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';

interface Ticket {
  id: string;
  status: string;
  event_title: string;
  event_date: string;
  ticket_type_name: string;
}

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  valid: { text: 'Platná', color: colors.success },
  used: { text: 'Použitá', color: colors.textMuted },
  revoked: { text: 'Zrušená', color: colors.danger },
};

export default function TicketsScreen() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ tickets: Ticket[] }>('/api/buyer/my-tickets');
      setTickets(r.tickets);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace('/login');
        return;
      }
      setError(e instanceof ApiError ? e.message : 'Nepodařilo se načíst vstupenky.');
      setTickets((t) => t ?? []);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (tickets === null && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={tickets ?? []}
      keyExtractor={(t) => t.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.empty}>{error ?? 'Zatím nemáš žádné vstupenky.'}</Text>
          <Pressable onPress={() => void clearSession().then(() => router.replace('/login'))}>
            <Text style={styles.logout}>Odhlásit se</Text>
          </Pressable>
        </View>
      }
      renderItem={({ item }) => {
        const st = STATUS_LABEL[item.status] ?? { text: item.status, color: colors.textMuted };
        return (
          <Pressable style={styles.card} onPress={() => router.push(`/tickets/${item.id}`)}>
            <View style={styles.cardRow}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.event_title}
              </Text>
              <View style={[styles.badge, { backgroundColor: st.color }]}>
                <Text style={styles.badgeText}>{st.text}</Text>
              </View>
            </View>
            <Text style={styles.cardMeta}>{item.ticket_type_name}</Text>
            <Text style={styles.cardMeta}>
              {new Date(item.event_date).toLocaleString('cs-CZ', {
                weekday: 'short',
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  list: { padding: space.md, gap: space.md, flexGrow: 1 },
  empty: { color: colors.textMuted, fontSize: 16, textAlign: 'center' },
  logout: { color: colors.brand, fontWeight: '600' },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.md,
    backgroundColor: colors.white,
    gap: space.xs,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  cardTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
  cardMeta: { fontSize: 14, color: colors.textMuted },
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  badgeText: { color: colors.white, fontSize: 12, fontWeight: '700' },
});
