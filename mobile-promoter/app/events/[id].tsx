/**
 * Promoter event live dashboard screen.
 * Pulls from GET /api/admin/events/{id}/live (same endpoint as web).
 * Auto-refreshes every 30 seconds while screen is visible.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { apiFetch, ApiError } from '@/lib/api';
import { colors, radius, space } from '@/lib/theme';

interface LiveDashboard {
  eventId:        string;
  eventTitle:     string;
  dateStart:      string;
  capacityTotal:  number;
  ticketsSold:    number;
  ticketsRemaining: number;
  sellThroughPct: number;
  revenueTotal:   number;
  refundsTotal:   number;
  netRevenue:     number;
  velocity1h:     number;
  velocity24hAvg: number;
  forecastSelloutAt: string | null;
  topTicketTypes: { name: string; sold: number }[];
  partySplit:     { activeSessions: number; pendingSlots: number };
}

function formatKc(halire: number): string {
  return (halire / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 0 }) + ' Kč';
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={metric.card}>
      <Text style={metric.label}>{label}</Text>
      <Text style={metric.value}>{value}</Text>
      {sub && <Text style={metric.sub}>{sub}</Text>}
    </View>
  );
}

const metric = StyleSheet.create({
  card:  { flex: 1, backgroundColor: colors.white, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: colors.border, minWidth: 140 },
  label: { fontSize: 11, color: colors.textMuted, fontWeight: '600', marginBottom: 4 },
  value: { fontSize: 22, fontWeight: '900', color: colors.text },
  sub:   { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});

export default function EventLiveDashboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData]         = useState<LiveDashboard | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setError(null);
    try {
      const d = await apiFetch<LiveDashboard>(`/api/admin/events/${id}/live`);
      setData(d);
      setError(null);
    } catch (e) {
      if (!silent) setError(e instanceof ApiError ? e.message : 'Chyba načítání');
    }
  }, [id]);

  useEffect(() => {
    void load();
    timerRef.current = setInterval(() => { void load(true); }, 30_000);

    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') { void load(true); }
    });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      sub.remove();
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!data && !error) {
    return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>;
  }

  if (error && !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.btn} onPress={() => void load()}><Text style={styles.btnText}>Zkusit znovu</Text></Pressable>
      </View>
    );
  }

  const d = data!;
  const pct = Math.round(d.sellThroughPct);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
    >
      {/* Header */}
      <Text style={styles.eventTitle}>{d.eventTitle}</Text>
      <Text style={styles.eventDate}>
        {new Date(d.dateStart).toLocaleString('cs-CZ', {
          weekday: 'short', day: 'numeric', month: 'long',
          hour: '2-digit', minute: '2-digit',
        })}
      </Text>

      {/* Progress */}
      <View style={styles.section}>
        <View style={styles.progressRow}>
          <Text style={styles.progressLabel}>{d.ticketsSold} / {d.capacityTotal} vstupenek</Text>
          <Text style={styles.progressPct}>{pct} %</Text>
        </View>
        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: `${Math.min(100, pct)}%` as `${number}%` }]} />
        </View>
        {d.forecastSelloutAt && (
          <Text style={styles.forecast}>
            Předpokládané vyprodání: {new Date(d.forecastSelloutAt).toLocaleString('cs-CZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </Text>
        )}
      </View>

      {/* Key metrics grid */}
      <View style={styles.grid}>
        <MetricCard label="Tržby celkem" value={formatKc(d.revenueTotal)} sub={`čistě ${formatKc(d.netRevenue)}`} />
        <MetricCard label="Rychlost (1h)" value={`${d.velocity1h}`} sub="vstupenek za hodinu" />
      </View>
      <View style={styles.grid}>
        <MetricCard label="Zbývá vstupenek" value={`${d.ticketsRemaining}`} />
        <MetricCard label="Průměr (24h)" value={`${d.velocity24hAvg}`} sub="vs/hod" />
      </View>

      {/* Top ticket types */}
      {d.topTicketTypes.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Nejprodávanější typy</Text>
          {d.topTicketTypes.map((tt, i) => (
            <View key={i} style={styles.ttRow}>
              <Text style={styles.ttName}>{tt.name}</Text>
              <Text style={styles.ttCount}>{tt.sold} ks</Text>
            </View>
          ))}
        </View>
      )}

      {/* Party Pay */}
      {(d.partySplit.activeSessions > 0 || d.partySplit.pendingSlots > 0) && (
        <View style={[styles.section, styles.partyCard]}>
          <Text style={styles.sectionTitle}>Party Pay</Text>
          <Text style={styles.partyText}>
            {d.partySplit.activeSessions} aktivních skupin · {d.partySplit.pendingSlots} čekajících míst
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  container:     { padding: space.md, gap: space.md, paddingBottom: space.xl },
  eventTitle:    { fontSize: 20, fontWeight: '900', color: colors.text },
  eventDate:     { fontSize: 13, color: colors.textMuted },
  section:       { backgroundColor: colors.white, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: colors.border },
  progressRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { fontSize: 13, color: colors.text, fontWeight: '600' },
  progressPct:   { fontSize: 13, color: colors.brand, fontWeight: '700' },
  progressBg:    { height: 8, backgroundColor: colors.bgMuted, borderRadius: radius.pill, overflow: 'hidden' },
  progressFill:  { height: 8, backgroundColor: colors.brand, borderRadius: radius.pill },
  forecast:      { fontSize: 12, color: colors.warning, marginTop: 6 },
  grid:          { flexDirection: 'row', gap: space.sm },
  sectionTitle:  { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginBottom: 8 },
  ttRow:         { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  ttName:        { fontSize: 14, color: colors.text },
  ttCount:       { fontSize: 14, fontWeight: '700', color: colors.brand },
  partyCard:     { borderColor: colors.brand + '44', backgroundColor: colors.brand + '08' },
  partyText:     { fontSize: 14, color: colors.text },
  errorText:     { color: colors.danger, textAlign: 'center', marginBottom: space.md },
  btn:           { backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  btnText:       { color: colors.white, fontWeight: '700' },
});
