import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { apiFetch, ApiError } from '@/lib/api';
import { colors, radius, space } from '@/lib/theme';

interface TotpRevealed {
  revealed: true;
  payload: string;
  code: string;
  expiresInSec: number;
  step: number;
  status: string;
}
interface TotpHidden {
  revealed: false;
  message: string;
  minutesUntilReveal?: number;
}
type TotpResponse = TotpRevealed | TotpHidden;

const QR_SIZE = Math.min(Dimensions.get('window').width - 96, 300);

export default function TicketQrScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<TotpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCode = useCallback(async () => {
    try {
      const r = await apiFetch<TotpResponse>(`/api/buyer/tickets/${id}/totp`);
      setData(r);
      setError(null);
      if (r.revealed) setSecondsLeft(r.expiresInSec);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Nepodařilo se načíst QR kód.');
    }
  }, [id]);

  // Initial + 1s countdown; po vypršení okna re-fetch nového kódu.
  useEffect(() => {
    void fetchCode();
    timer.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          void fetchCode();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [fetchCode]);

  return (
    <View style={styles.container}>
      <Pressable style={styles.close} onPress={() => router.back()} hitSlop={16}>
        <Text style={styles.closeText}>✕</Text>
      </Pressable>

      <View style={styles.center}>
        {error ? (
          <Text style={styles.message}>{error}</Text>
        ) : data === null ? (
          <ActivityIndicator color={colors.white} />
        ) : data.revealed ? (
          <>
            <View style={styles.qrWrap}>
              <QRCode value={data.payload} size={QR_SIZE} />
            </View>
            <Text style={styles.code}>{data.code}</Text>
            <Text style={styles.hint}>
              Kód se obnoví za {secondsLeft}s · ukaž obsluze u vstupu
            </Text>
            {data.status !== 'valid' ? (
              <Text style={styles.warn}>Stav lístku: {data.status}</Text>
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.lockEmoji}>🔒</Text>
            <Text style={styles.message}>{data.message}</Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.brandDark },
  close: { position: 'absolute', top: 56, right: 24, zIndex: 2, padding: space.sm },
  closeText: { color: colors.white, fontSize: 28, fontWeight: '300' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  qrWrap: { backgroundColor: colors.white, padding: space.lg, borderRadius: radius.lg },
  code: { color: colors.white, fontSize: 34, fontWeight: '800', letterSpacing: 6, marginTop: space.md },
  hint: { color: '#D9D2FF', fontSize: 14, textAlign: 'center' },
  warn: { color: colors.warning, fontSize: 14, fontWeight: '600' },
  lockEmoji: { fontSize: 48 },
  message: { color: colors.white, fontSize: 16, textAlign: 'center', lineHeight: 24 },
});
