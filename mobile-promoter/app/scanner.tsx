import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { apiFetch, ApiError } from '@/lib/api';
import { clearSession, getUser } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';

interface ScanResult {
  result: string;
  message?: string;
  ticket?: { eventTitle: string; ticketTypeName: string; holderName: string | null; holderEmail: string };
}

const OK = new Set(['admitted']);
const WARN = new Set(['already_used', 'already_redeemed_today', 'already_inside']);

const LABEL: Record<string, string> = {
  admitted: 'VSTUP POVOLEN',
  already_used: 'UŽ POUŽITO',
  already_redeemed_today: 'PRO DNES UŽ POUŽITO',
  revoked: 'LÍSTEK ZRUŠEN',
  not_found: 'LÍSTEK NENALEZEN',
  invalid_token: 'NEPLATNÝ KÓD',
  wrong_promoter: 'CIZÍ POŘADATEL',
  totp_mismatch: 'QR NESEDÍ',
  totp_required: 'VYŽADUJE MOBILNÍ QR',
  wrong_zone_or_day: 'ŠPATNÁ ZÓNA / DEN',
};

/** Rozparsuje naskenovaný payload na tělo pro /api/admin/scanner/validate. */
function parsePayload(raw: string): { ticketId?: string; printToken?: string; totpCode?: string } | null {
  const s = raw.trim();
  const m = s.match(/^tixly:([0-9a-f-]{36}):(\d{6})$/i);
  if (m) return { ticketId: m[1], totpCode: m[2] };
  if (s.startsWith('TXP1.')) return { printToken: s };
  if (/^[0-9a-f-]{36}$/i.test(s)) return { ticketId: s };
  return null;
}

export default function ScannerScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const lastScan = useRef<string>('');

  const onScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (busy || result) return; // čekej, dokud obsluha nepotvrdí předchozí
      if (data === lastScan.current) return;
      lastScan.current = data;
      const body = parsePayload(data);
      if (!body) {
        setResult({ result: 'invalid_token', message: 'Nerozpoznaný QR kód.' });
        return;
      }
      setBusy(true);
      try {
        const r = await apiFetch<ScanResult>('/api/admin/scanner/validate', { method: 'POST', body });
        setResult(r);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.replace('/login');
          return;
        }
        // validate vrací i 403/404/409 s tělem {result,...} → ApiError nese code
        if (e instanceof ApiError) {
          setResult({ result: e.code !== 'ERROR' ? e.code : 'error', message: e.message });
        } else {
          setResult({ result: 'error', message: 'Chyba sítě.' });
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, result, router],
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

  return (
    <View style={styles.flex}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={result ? undefined : onScanned}
      />

      <View style={styles.topBar}>
        <Text style={styles.topTitle}>Skener vstupenek</Text>
        <Pressable hitSlop={12} onPress={() => void clearSession().then(() => router.replace('/login'))}>
          <Text style={styles.logout}>Odhlásit</Text>
        </Pressable>
      </View>

      {!result ? (
        <View style={styles.frameWrap} pointerEvents="none">
          <View style={styles.frame} />
          <Text style={styles.hint}>{busy ? 'Ověřuji…' : 'Namiř na QR vstupenky'}</Text>
        </View>
      ) : (
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
          {result.message ? <Text style={styles.resultMsg}>{result.message}</Text> : null}
          <Pressable style={styles.nextBtn} onPress={next}>
            <Text style={styles.nextText}>Skenovat další</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md, backgroundColor: colors.bg },
  permTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  permText: { fontSize: 15, color: colors.textMuted, textAlign: 'center' },
  button: { backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: space.xl, paddingVertical: 14, marginTop: space.sm },
  buttonText: { color: colors.white, fontWeight: '700', fontSize: 16 },
  topBar: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topTitle: { color: colors.white, fontSize: 18, fontWeight: '700' },
  logout: { color: '#fff', opacity: 0.85, fontWeight: '600' },
  frameWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  frame: { width: 240, height: 240, borderWidth: 3, borderColor: colors.white, borderRadius: radius.lg, opacity: 0.9 },
  hint: { color: colors.white, fontSize: 16, fontWeight: '600' },
  resultSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.xl, paddingBottom: 48, gap: space.sm },
  resultLabel: { color: colors.white, fontSize: 30, fontWeight: '900' },
  resultEvent: { color: colors.white, fontSize: 18, fontWeight: '700' },
  resultMeta: { color: colors.white, fontSize: 14, opacity: 0.95 },
  resultMsg: { color: colors.white, fontSize: 15, opacity: 0.95 },
  nextBtn: { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: radius.md, paddingVertical: 16, alignItems: 'center', marginTop: space.md },
  nextText: { color: colors.white, fontWeight: '800', fontSize: 16 },
});
