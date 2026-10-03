import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { apiFetch, ApiError } from '@/lib/api';
import { clearSession } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';

interface ScanResult {
  result: string;
  message?: string;
  scanCount?: number;
  remaining?: number;
  ticket?: { eventTitle: string; ticketTypeName: string; holderName: string | null; holderEmail: string };
}
interface GateEvent {
  id: string;
  title: string;
  dateStart: string;
  days: { id: string; label: string | null; dayIndex: number; startsAt: string }[];
  zones: { id: string; name: string }[];
}
type Mode = 'standard' | 'entry' | 'exit';

const OK = new Set(['admitted', 'exited']);
const WARN = new Set(['already_used', 'already_redeemed_today', 'already_inside', 'not_inside']);
const LABEL: Record<string, string> = {
  admitted: 'VSTUP POVOLEN',
  exited: 'VÝSTUP ZAZNAMENÁN',
  already_used: 'UŽ POUŽITO',
  already_redeemed_today: 'PRO DNES UŽ POUŽITO',
  already_inside: 'UŽ JE UVNITŘ',
  not_inside: 'NENÍ UVNITŘ',
  reentry_limit_exceeded: 'PŘEKROČEN LIMIT VSTUPŮ',
  reentry_disabled: 'AKCE NEPOVOLUJE RE-ENTRY',
  revoked: 'LÍSTEK ZRUŠEN',
  not_found: 'LÍSTEK NENALEZEN',
  invalid_token: 'NEPLATNÝ KÓD',
  wrong_promoter: 'CIZÍ POŘADATEL',
  wrong_event: 'JINÁ AKCE',
  totp_mismatch: 'QR NESEDÍ',
  totp_required: 'VYŽADUJE MOBILNÍ QR',
  wrong_zone_or_day: 'ŠPATNÁ ZÓNA / DEN',
  day_not_picked: 'DEN NEVYBRÁN',
  flex_limit_exhausted: 'VYČERPÁN LIMIT DNŮ',
  invalid_status: 'NEPLATNÝ STAV LÍSTKU',
};

function parsePayload(raw: string): { ticketId?: string; printToken?: string; totpCode?: string } | null {
  const s = raw.trim();
  const m = s.match(/^tixly:([0-9a-f-]{36}):(\d{6})$/i);
  if (m) return { ticketId: m[1], totpCode: m[2] };
  if (/^TXP[12]\./.test(s)) return { printToken: s };
  if (/^[0-9a-f-]{36}$/i.test(s)) return { ticketId: s };
  return null;
}

export default function ScannerScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const lastScan = useRef<string>('');

  const [gates, setGates] = useState<GateEvent[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [dayId, setDayId] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('standard');
  const [showConfig, setShowConfig] = useState(false);
  // Lokální session počítadlo — resets on gate/event change
  const [sessionAdmitted, setSessionAdmitted] = useState(0);
  const [sessionDenied, setSessionDenied] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch<{ events: GateEvent[] }>('/api/admin/scanner/gates');
        setGates(r.events);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) router.replace('/login');
      }
    })();
  }, [router]);

  // Reset session counters when gate config changes
  useEffect(() => { setSessionAdmitted(0); setSessionDenied(0); }, [eventId, zoneId, dayId]);

  const ev = gates.find((g) => g.id === eventId) ?? null;
  const day = ev?.days.find((d) => d.id === dayId) ?? null;
  const zone = ev?.zones.find((z) => z.id === zoneId) ?? null;
  const gateLabel = ev
    ? `${ev.title}${day ? ' · ' + (day.label ?? `Den ${day.dayIndex + 1}`) : ''}${zone ? ' · ' + zone.name : ''}`
    : 'Brána nezvolena';

  const onScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (busy || result || showConfig) return;
      if (data === lastScan.current) return;
      lastScan.current = data;
      const parsed = parsePayload(data);
      if (!parsed) {
        setResult({ result: 'invalid_token', message: 'Nerozpoznaný QR kód.' });
        return;
      }
      const body: Record<string, unknown> = { ...parsed };
      // Kolo 3 (V9b): akce brány → API odmítne lístek jiné akce (wrong_event).
      if (eventId) body.eventId = eventId;
      if (dayId) body.eventDayId = dayId;
      if (zoneId) body.zoneId = zoneId;
      const endpoint = mode === 'standard' ? '/api/admin/scanner/validate' : '/api/admin/scanner/reentry';
      if (mode !== 'standard') body.mode = mode;

      setBusy(true);
      try {
        const r = await apiFetch<ScanResult>(endpoint, { method: 'POST', body });
        setResult(r);
        if (OK.has(r.result)) setSessionAdmitted((n) => n + 1);
        else setSessionDenied((n) => n + 1);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.replace('/login');
          return;
        }
        if (e instanceof ApiError) setResult({ result: e.code !== 'ERROR' ? e.code : 'error', message: e.message });
        else setResult({ result: 'error', message: 'Chyba sítě.' });
      } finally {
        setBusy(false);
      }
    },
    [busy, result, showConfig, eventId, dayId, zoneId, mode, router],
  );

  function next() {
    lastScan.current = '';
    setResult(null);
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permTitle}>Potřebuju fotoaparát</Text>
        <Text style={styles.permText}>Pro skenování vstupenek u vstupu povol přístup ke kameře.</Text>
        <Pressable style={styles.button} onPress={() => void requestPermission()}>
          <Text style={styles.buttonText}>Povolit kameru</Text>
        </Pressable>
      </View>
    );
  }

  const tone = result
    ? OK.has(result.result)
      ? colors.success
      : WARN.has(result.result)
        ? colors.warning
        : colors.danger
    : colors.brand;
  const modeLabel = mode === 'standard' ? 'Standard' : mode === 'entry' ? '↪ Vstup' : '↩ Výstup';

  return (
    <View style={styles.flex}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={result || showConfig ? undefined : onScanned}
      />

      <View style={styles.topBar}>
        <Pressable hitSlop={10} onPress={() => router.push('/live-ops')}>
          <Text style={styles.topLink}>Live Ops</Text>
        </Pressable>
        <Pressable hitSlop={10} onPress={() => setShowConfig(true)} style={styles.gatePill}>
          <Text style={styles.gatePillText} numberOfLines={1}>
            ⚙ {gateLabel} · {modeLabel}
          </Text>
        </Pressable>
        <Pressable hitSlop={10} onPress={() => void clearSession().then(() => router.replace('/login'))}>
          <Text style={styles.topLink}>Odhlásit</Text>
        </Pressable>
      </View>

      {!result && !showConfig ? (
        <View style={styles.frameWrap} pointerEvents="none">
          <View style={styles.frame} />
          <Text style={styles.hint}>{busy ? 'Ověřuji…' : 'Namiř na QR vstupenky'}</Text>
          {(sessionAdmitted + sessionDenied) > 0 ? (
            <View style={styles.sessionStats}>
              <Text style={styles.sessionStatsText}>
                ✓ {sessionAdmitted}{'  '}✗ {sessionDenied}{'  '}Session
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {result ? (
        <View style={[styles.resultSheet, { backgroundColor: tone }]}>
          <Text style={styles.resultLabel}>{LABEL[result.result] ?? result.result.toUpperCase()}</Text>
          {result.ticket ? (
            <>
              <Text style={styles.resultEvent}>{result.ticket.eventTitle}</Text>
              <Text style={styles.resultMeta}>{result.ticket.ticketTypeName}</Text>
              <Text style={styles.resultMeta}>
                {result.ticket.holderName ? `${result.ticket.holderName} · ` : ''}
                {result.ticket.holderEmail}
              </Text>
            </>
          ) : null}
          {result.remaining != null ? (
            <Text style={styles.resultMeta}>Zbývá vstupů: {result.remaining}</Text>
          ) : null}
          {result.message ? <Text style={styles.resultMsg}>{result.message}</Text> : null}
          <Pressable style={styles.nextBtn} onPress={next}>
            <Text style={styles.nextText}>Skenovat další</Text>
          </Pressable>
        </View>
      ) : null}

      {showConfig ? (
        <ScrollView style={styles.configSheet} contentContainerStyle={styles.configContent}>
          <Text style={styles.configTitle}>Brána & režim</Text>

          <Text style={styles.configLabel}>Akce</Text>
          {gates.length === 0 ? <Text style={styles.configMuted}>Žádné nadcházející akce.</Text> : null}
          {gates.map((g) => (
            <Pressable
              key={g.id}
              style={[styles.row, eventId === g.id && styles.rowActive]}
              onPress={() => {
                setEventId(g.id);
                setDayId(null);
                setZoneId(null);
              }}
            >
              <Text style={styles.rowText}>{g.title}</Text>
            </Pressable>
          ))}

          {ev && ev.days.length > 0 ? (
            <>
              <Text style={styles.configLabel}>Den</Text>
              <View style={styles.chips}>
                <Chip label="Vše" active={dayId === null} onPress={() => setDayId(null)} />
                {ev.days.map((d) => (
                  <Chip
                    key={d.id}
                    label={d.label ?? `Den ${d.dayIndex + 1}`}
                    active={dayId === d.id}
                    onPress={() => setDayId(d.id)}
                  />
                ))}
              </View>
            </>
          ) : null}

          {ev && ev.zones.length > 0 ? (
            <>
              <Text style={styles.configLabel}>Zóna / scéna</Text>
              <View style={styles.chips}>
                <Chip label="Vše" active={zoneId === null} onPress={() => setZoneId(null)} />
                {ev.zones.map((z) => (
                  <Chip key={z.id} label={z.name} active={zoneId === z.id} onPress={() => setZoneId(z.id)} />
                ))}
              </View>
            </>
          ) : null}

          <Text style={styles.configLabel}>Režim</Text>
          <View style={styles.chips}>
            <Chip label="Standard" active={mode === 'standard'} onPress={() => setMode('standard')} />
            <Chip label="↪ Vstup" active={mode === 'entry'} onPress={() => setMode('entry')} />
            <Chip label="↩ Výstup" active={mode === 'exit'} onPress={() => setMode('exit')} />
          </View>

          <Pressable style={styles.doneBtn} onPress={() => setShowConfig(false)}>
            <Text style={styles.doneText}>Hotovo</Text>
          </Pressable>
        </ScrollView>
      ) : null}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md, backgroundColor: colors.bg },
  permTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  permText: { fontSize: 15, color: colors.textMuted, textAlign: 'center' },
  button: { backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: space.xl, paddingVertical: 14, marginTop: space.sm },
  buttonText: { color: colors.white, fontWeight: '700', fontSize: 16 },
  topBar: { position: 'absolute', top: 52, left: 0, right: 0, paddingHorizontal: space.md, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  topLink: { color: '#fff', fontWeight: '600', opacity: 0.9 },
  gatePill: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm },
  gatePillText: { color: '#fff', fontWeight: '600', textAlign: 'center', fontSize: 12 },
  frameWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  frame: { width: 240, height: 240, borderWidth: 3, borderColor: colors.white, borderRadius: radius.lg, opacity: 0.9 },
  hint: { color: colors.white, fontSize: 16, fontWeight: '600' },
  sessionStats: { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: 6 },
  sessionStatsText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  resultSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.xl, paddingBottom: 48, gap: space.sm },
  resultLabel: { color: colors.white, fontSize: 28, fontWeight: '900' },
  resultEvent: { color: colors.white, fontSize: 18, fontWeight: '700' },
  resultMeta: { color: colors.white, fontSize: 14, opacity: 0.95 },
  resultMsg: { color: colors.white, fontSize: 15, opacity: 0.95 },
  nextBtn: { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: radius.md, paddingVertical: 16, alignItems: 'center', marginTop: space.md },
  nextText: { color: colors.white, fontWeight: '800', fontSize: 16 },
  configSheet: { position: 'absolute', top: 96, left: 0, right: 0, bottom: 0, backgroundColor: colors.bg },
  configContent: { padding: space.lg, gap: space.sm, paddingBottom: space.xl },
  configTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  configLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginTop: space.md },
  configMuted: { color: colors.textMuted },
  row: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md },
  rowActive: { borderColor: colors.brand, backgroundColor: colors.bgMuted },
  rowText: { fontSize: 15, color: colors.text, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md, paddingVertical: space.sm },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  chipTextActive: { color: colors.white },
  doneBtn: { backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center', marginTop: space.lg },
  doneText: { color: colors.white, fontWeight: '800', fontSize: 16 },
});
