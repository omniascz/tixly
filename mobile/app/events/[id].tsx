import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { apiFetch, ApiError } from '@/lib/api';
import { getUser } from '@/lib/session';
import { API_BASE_URL } from '@/lib/config';
import { colors, radius, space } from '@/lib/theme';

interface TicketType {
  id: string;
  name: string;
  basePrice: number;
  remainingQty: number;
}

export default function EventDetailScreen() {
  const params = useLocalSearchParams<{
    id: string;
    title?: string;
    dateStart?: string;
    venue?: string;
    city?: string;
    currency?: string;
  }>();
  const currency = params.currency ?? 'CZK';
  const sym = currency === 'EUR' ? '€' : 'Kč';

  const [types, setTypes] = useState<TicketType[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [buying, setBuying] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ ticketTypes: TicketType[] }>(
        `/api/events/${params.id}/ticket-types`,
        { auth: false },
      );
      setTypes(r.ticketTypes);
      if (r.ticketTypes.length > 0) setSelected(r.ticketTypes[0].id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Nepodařilo se načíst vstupenky.');
      setTypes([]);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function buy() {
    if (!selected) return;
    const user = await getUser();
    if (!user?.email) {
      Alert.alert('Přihlášení vypršelo', 'Pro dokončení nákupu se prosím znovu přihlas.', [
        { text: 'Přihlásit se', onPress: () => router.replace('/login') },
      ]);
      return;
    }
    setBuying(true);
    try {
      const r = await apiFetch<{ gatewayUrl: string; orderId: string }>('/api/checkout', {
        method: 'POST',
        body: {
          eventId: params.id,
          ticketTypeId: selected,
          quantity: qty,
          buyerEmail: user.email,
          buyerName: user.name,
        },
      });
      const url = r.gatewayUrl.startsWith('http') ? r.gatewayUrl : `${API_BASE_URL}${r.gatewayUrl}`;
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Platba', 'Otevři platební bránu v prohlížeči:\n' + url);
      }
    } catch (e) {
      Alert.alert('Nákup selhal', e instanceof ApiError ? e.message : 'Zkus to znovu.');
    } finally {
      setBuying(false);
    }
  }

  const sel = types?.find((t) => t.id === selected);
  const total = sel ? (sel.basePrice * qty) / 100 : 0;

  return (
    <>
      <Stack.Screen options={{ title: params.title ?? 'Akce' }} />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>{params.title}</Text>
        {params.dateStart ? (
          <Text style={styles.meta}>
            {new Date(params.dateStart).toLocaleString('cs-CZ', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        ) : null}
        {params.venue ? (
          <Text style={styles.meta}>
            {params.venue}
            {params.city ? `, ${params.city}` : ''}
          </Text>
        ) : null}

        <Text style={styles.section}>Vstupenky</Text>
        {types === null ? (
          <ActivityIndicator color={colors.brand} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : types.length === 0 ? (
          <Text style={styles.meta}>Pro tuto akci nejsou v prodeji žádné vstupenky.</Text>
        ) : (
          types.map((t) => {
            const soldOut = t.remainingQty <= 0;
            const active = selected === t.id;
            return (
              <Pressable
                key={t.id}
                disabled={soldOut}
                onPress={() => setSelected(t.id)}
                style={[styles.type, active && styles.typeActive, soldOut && styles.typeDisabled]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.typeName}>{t.name}</Text>
                  <Text style={styles.typeMeta}>
                    {soldOut ? 'Vyprodáno' : `${t.remainingQty} k dispozici`}
                  </Text>
                </View>
                <Text style={styles.typePrice}>
                  {(t.basePrice / 100).toLocaleString('cs-CZ')} {sym}
                </Text>
              </Pressable>
            );
          })
        )}

        {sel && sel.remainingQty > 0 ? (
          <>
            <View style={styles.qtyRow}>
              <Text style={styles.section}>Počet</Text>
              <View style={styles.stepper}>
                <Pressable style={styles.step} onPress={() => setQty((q) => Math.max(1, q - 1))}>
                  <Text style={styles.stepText}>−</Text>
                </Pressable>
                <Text style={styles.qty}>{qty}</Text>
                <Pressable
                  style={styles.step}
                  onPress={() => setQty((q) => Math.min(sel.remainingQty, 10, q + 1))}
                >
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
              </View>
            </View>

            <Pressable style={[styles.buy, buying && styles.typeDisabled]} onPress={buy} disabled={buying}>
              {buying ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.buyText}>
                  Koupit · {total.toLocaleString('cs-CZ')} {sym}
                </Text>
              )}
            </Pressable>
            <Text style={styles.payNote}>Platbu dokončíš v prohlížeči (platební brána).</Text>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, gap: space.sm, paddingBottom: space.xl },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  meta: { fontSize: 15, color: colors.textMuted },
  section: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginTop: space.lg },
  error: { color: colors.danger },
  type: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.md,
  },
  typeActive: { borderColor: colors.brand, backgroundColor: colors.bgMuted },
  typeDisabled: { opacity: 0.5 },
  typeName: { fontSize: 16, fontWeight: '600', color: colors.text },
  typeMeta: { fontSize: 13, color: colors.textMuted },
  typePrice: { fontSize: 16, fontWeight: '700', color: colors.text },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg },
  step: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.bgMuted, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 24, fontWeight: '700', color: colors.brand },
  qty: { fontSize: 18, fontWeight: '700', minWidth: 28, textAlign: 'center', color: colors.text },
  buy: { backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center', marginTop: space.lg },
  buyText: { color: colors.white, fontWeight: '800', fontSize: 17 },
  payNote: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: space.sm },
});
