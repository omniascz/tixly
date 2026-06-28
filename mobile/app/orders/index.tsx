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

interface OrderSummary {
  id:          string;
  status:      'pending' | 'paid' | 'refunded' | 'cancelled';
  totalAmount: number;
  currency:    string;
  createdAt:   string;
  eventTitle:  string | null;
  eventDate:   string | null;
  itemCount:   number;
}

function statusLabel(s: OrderSummary['status']): string {
  return { pending: 'Čeká na platbu', paid: 'Zaplaceno', refunded: 'Refundováno', cancelled: 'Zrušeno' }[s] ?? s;
}

function statusColor(s: OrderSummary['status']): string {
  return { pending: colors.warning, paid: colors.success, refunded: colors.textMuted, cancelled: colors.textMuted }[s] ?? colors.textMuted;
}

function formatPrice(halire: number, currency: string): string {
  const v = halire / 100;
  return `${v.toLocaleString('cs-CZ')} ${currency === 'EUR' ? '€' : 'Kč'}`;
}

export default function OrderHistoryScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ orders: OrderSummary[] }>('/api/v1/buyer/orders');
      setOrders(data.orders);
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

  if (!orders && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retry} onPress={load}>
          <Text style={styles.retryText}>Zkusit znovu</Text>
        </Pressable>
      </View>
    );
  }

  if (!orders || orders.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Žádné objednávky.</Text>
        <Pressable style={styles.browseBtn} onPress={() => router.push('/events')}>
          <Text style={styles.browseBtnText}>Prozkoumat akce</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      data={orders}
      keyExtractor={(o) => o.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      renderItem={({ item }) => (
        <Pressable style={styles.card} onPress={() => router.push('/tickets')}>
          <View style={styles.cardHeader}>
            <Text style={styles.eventTitle} numberOfLines={1}>
              {item.eventTitle ?? 'Objednávka'}
            </Text>
            <View style={[styles.badge, { backgroundColor: statusColor(item.status) + '22' }]}>
              <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>
                {statusLabel(item.status)}
              </Text>
            </View>
          </View>

          {item.eventDate && (
            <Text style={styles.meta}>
              {new Date(item.eventDate).toLocaleDateString('cs-CZ', {
                day: 'numeric', month: 'long', year: 'numeric',
              })}
            </Text>
          )}

          <View style={styles.cardFooter}>
            <Text style={styles.items}>{item.itemCount} vstupenek</Text>
            <Text style={styles.price}>{formatPrice(item.totalAmount, item.currency)}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  list:         { padding: space.md, gap: space.sm },
  card:         { backgroundColor: colors.white, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: colors.border },
  cardHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  eventTitle:   { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text, marginRight: space.sm },
  badge:        { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText:    { fontSize: 11, fontWeight: '600' },
  meta:         { fontSize: 13, color: colors.textMuted, marginBottom: 8 },
  cardFooter:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  items:        { fontSize: 13, color: colors.textMuted },
  price:        { fontSize: 15, fontWeight: '700', color: colors.brand },
  errorText:    { color: colors.danger, textAlign: 'center', marginBottom: space.md },
  retry:        { backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  retryText:    { color: '#fff', fontWeight: '700' },
  emptyText:    { color: colors.textMuted, fontSize: 15, marginBottom: space.lg },
  browseBtn:    { backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  browseBtnText:{ color: '#fff', fontWeight: '700' },
});
