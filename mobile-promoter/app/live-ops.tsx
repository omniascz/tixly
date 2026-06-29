import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { apiFetch, ApiError } from '@/lib/api';
import { colors, radius, space } from '@/lib/theme';

interface GateEvent {
  id: string;
  title: string;
  dateStart: string;
}
interface GateStat {
  gateId: string | null;
  gateLabel: string;
  admitted: number;
  denied: number;
}
interface LiveOps {
  event: { title: string; currency: string };
  sales: { ticketsSold: number; revenueHalire: number; refundedCount: number };
  scanRate: { last5min: number; last15min: number; last60min: number; usedTotal: number; redemptionTotal: number };
  inventory: { id: string; name: string; remainingQty: number | null; soldQty: number | null }[];
  gates: GateStat[];
  timestamp: string;
}

const POLL_MS = 5000;

function money(halire: number, currency: string): string {
  return `${(halire / 100).toLocaleString('cs-CZ')} ${currency === 'EUR' ? '€' : 'Kč'}`;
}

export default function LiveOpsScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<GateEvent[] | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [data, setData] = useState<LiveOps | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch<{ events: GateEvent[] }>('/api/admin/scanner/gates');
        setEvents(r.events);
        if (r.events.length > 0) setEventId(r.events[0].id);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) router.replace('/login');
        else setError('Nepodařilo se načíst akce.');
      }
    })();
  }, [router]);

  const poll = useCallback(async (id: string) => {
    try {
      const r = await apiFetch<LiveOps>(`/api/admin/events/${id}/live-ops`);
      setData(r);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.replace('/login');
      else setError(e instanceof ApiError ? e.message : 'Chyba načítání.');
    }
  }, [router]);

  useEffect(() => {
    if (!eventId) return;
    setData(null);
    void poll(eventId);
    timer.current = setInterval(() => void poll(eventId), POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [eventId, poll]);

  const scanned = data ? data.scanRate.usedTotal + data.scanRate.redemptionTotal : 0;
  const occupancy = data && data.sales.ticketsSold > 0 ? Math.round((scanned / data.sales.ticketsSold) * 100) : 0;
  const ccy = data?.event.currency ?? 'CZK';

  return (
    <>
      <Stack.Screen options={{ title: 'Live Ops', headerShown: true }} />
      <ScrollView contentContainerStyle={styles.container}>
        {events && events.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {events.map((e) => (
              <Pressable
                key={e.id}
                onPress={() => setEventId(e.id)}
                style={[styles.tab, eventId === e.id && styles.tabActive]}
              >
                <Text style={[styles.tabText, eventId === e.id && styles.tabTextActive]} numberOfLines={1}>
                  {e.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!data && !error ? <ActivityIndicator color={colors.brand} style={{ marginTop: space.xl }} /> : null}

        {data ? (
          <>
            <View style={styles.grid}>
              <Stat label="Prodáno" value={data.sales.ticketsSold.toLocaleString('cs-CZ')} />
              <Stat label="Tržby" value={money(data.sales.revenueHalire, ccy)} />
              <Stat label="Naskenováno" value={String(scanned)} sub={`${occupancy}% obsazenost`} />
              <Stat label="Refundace" value={String(data.sales.refundedCount)} />
            </View>

            <Text style={styles.section}>Tempo skenů</Text>
            <View style={styles.grid}>
              <Stat label="5 min" value={String(data.scanRate.last5min)} />
              <Stat label="15 min" value={String(data.scanRate.last15min)} />
              <Stat label="60 min" value={String(data.scanRate.last60min)} />
            </View>

            {data.gates && data.gates.length > 0 ? (
              <>
                <Text style={styles.section}>Brány — vstup / odmítnutí</Text>
                {data.gates.map((g, i) => {
                  const total = g.admitted + g.denied;
                  const pct = total > 0 ? Math.round((g.admitted / total) * 100) : 100;
                  return (
                    <View key={g.gateId ?? String(i)} style={styles.gateRow}>
                      <View style={styles.gateHeader}>
                        <Text style={styles.gateName}>{g.gateLabel}</Text>
                        <Text style={styles.gateNumbers}>
                          <Text style={{ color: '#22c55e' }}>{g.admitted} ✓</Text>
                          {g.denied > 0 ? <Text style={{ color: '#ef4444' }}>  {g.denied} ✗</Text> : null}
                        </Text>
                      </View>
                      <View style={styles.progressBar}>
                        <View style={[styles.progressFill, { width: `${pct}%` as `${number}%` }]} />
                      </View>
                    </View>
                  );
                })}
              </>
            ) : null}

            <Text style={styles.section}>Inventář</Text>
            {data.inventory.map((i) => (
              <View key={i.id} style={styles.invRow}>
                <Text style={styles.invName}>{i.name}</Text>
                <Text style={styles.invMeta}>
                  prodáno {i.soldQty ?? '—'} · zbývá {i.remainingQty ?? '∞'}
                </Text>
              </View>
            ))}
            <Text style={styles.ts}>Aktualizováno {new Date(data.timestamp).toLocaleTimeString('cs-CZ')}</Text>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.md, gap: space.sm },
  tabs: { gap: space.sm, paddingBottom: space.sm },
  tab: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: colors.bgMuted },
  tabActive: { backgroundColor: colors.brand },
  tabText: { color: colors.text, fontWeight: '600', maxWidth: 160 },
  tabTextActive: { color: colors.white },
  error: { color: colors.danger, marginTop: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stat: { flexGrow: 1, minWidth: '46%', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md },
  statLabel: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase' },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 2 },
  statSub: { fontSize: 12, color: colors.textMuted },
  section: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginTop: space.lg },
  invRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  invName: { fontSize: 15, color: colors.text, fontWeight: '600' },
  invMeta: { fontSize: 13, color: colors.textMuted },
  gateRow: { marginBottom: space.sm },
  gateHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  gateName: { fontSize: 14, color: colors.text, fontWeight: '600', flex: 1 },
  gateNumbers: { fontSize: 14, fontWeight: '700' },
  progressBar: { height: 6, borderRadius: 3, backgroundColor: colors.bgMuted, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  ts: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: space.md },
});
