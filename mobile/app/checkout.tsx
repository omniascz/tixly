/**
 * Checkout screen — Stripe native PaymentSheet (Apple Pay, Google Pay, karta).
 * Automaticky přepne na WebView pokud Stripe není nakonfigurován (server vrátí 503).
 *
 * Parametry (expo-router): eventId, ticketTypeId, qty, title
 * Starý WebView-only fallback: eventSlug (zachována zpětná kompatibilita)
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { apiFetch, ApiError } from '@/lib/api';
import { getToken } from '@/lib/session';
import { API_BASE_URL, STRIPE_PUBLISHABLE_KEY } from '@/lib/config';
import { colors, radius, space } from '@/lib/theme';

const WEB_BASE = API_BASE_URL.replace('/api', '');

type Phase = 'init' | 'ready' | 'paying' | 'webview' | 'error';

interface PaymentIntentResp {
  clientSecret: string;
  paymentIntentId: string;
  orderId: string;
  amount: number;
  currency: string;
}

export default function CheckoutScreen() {
  const params = useLocalSearchParams<{
    eventId?: string;
    ticketTypeId?: string;
    qty?: string;
    title?: string;
    // legacy WebView params
    eventSlug?: string;
  }>();
  const { eventId, ticketTypeId, qty = '1', title, eventSlug } = params;

  const router = useRouter();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [phase, setPhase] = useState<Phase>('init');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [piId, setPiId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [webviewUri, setWebviewUri] = useState<string | null>(null);
  const [webLoading, setWebLoading] = useState(true);

  useEffect(() => {
    void getToken().then((t) => { setToken(t); });
  }, []);

  useEffect(() => {
    if (token === null) return;
    if (eventId && ticketTypeId && STRIPE_PUBLISHABLE_KEY) {
      void initNative();
    } else if (eventSlug || eventId) {
      // Fallback: otevřeme WebView na webový checkout
      void buildWebviewUrl(token).then((uri) => {
        setWebviewUri(uri);
        setPhase('webview');
      });
    } else {
      setErrorMsg('Chybí parametry akce.');
      setPhase('error');
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function initNative() {
    try {
      const resp = await apiFetch<PaymentIntentResp>('/api/mobile/payment-intent', {
        method: 'POST',
        body: { eventId, ticketTypeId, qty: parseInt(qty, 10) },
      });

      const { error } = await initPaymentSheet({
        paymentIntentClientSecret: resp.clientSecret,
        merchantDisplayName: 'Tixly',
        applePay: { merchantCountryCode: 'CZ' },
        googlePay: {
          merchantCountryCode: 'CZ',
          testEnv: __DEV__,
          currencyCode: resp.currency,
        },
        style: 'automatic',
      });

      if (error) throw new Error(error.message);

      setPiId(resp.paymentIntentId);
      setPhase('ready');
    } catch (e) {
      // Stripe není nakonfigurován na serveru → přepni na WebView
      if (e instanceof ApiError && (e.code === 'STRIPE_NOT_CONFIGURED' || e.status === 503)) {
        void buildWebviewUrl(token).then((uri) => {
          setWebviewUri(uri);
          setPhase('webview');
        });
        return;
      }
      setErrorMsg(e instanceof Error ? e.message : 'Nepodařilo se inicializovat platbu.');
      setPhase('error');
    }
  }

  async function buildWebviewUrl(tok: string | null): Promise<string> {
    // Zkus získat checkout URL z API (pro GoPay/ComGate)
    if (eventId && ticketTypeId) {
      try {
        const r = await apiFetch<{ gatewayUrl: string; orderId: string }>('/api/checkout', {
          method: 'POST',
          body: { eventId, ticketTypeId, quantity: parseInt(qty, 10) },
        });
        return r.gatewayUrl.startsWith('http') ? r.gatewayUrl : `${API_BASE_URL}${r.gatewayUrl}`;
      } catch { /* fallthrough */ }
    }
    // Fallback: webový checkout stránka
    const slugOrId = eventSlug ?? eventId ?? '';
    return [
      `${WEB_BASE}/cs/akce/${slugOrId}/checkout`,
      `?source=mobile`,
      ticketTypeId ? `&ticketTypeId=${ticketTypeId}` : '',
      `&qty=${qty}`,
      tok ? `&mobileToken=${encodeURIComponent(tok)}` : '',
    ].join('');
  }

  async function handlePay() {
    setPhase('paying');
    const { error } = await presentPaymentSheet();
    if (error) {
      if (error.code === 'Canceled') {
        setPhase('ready');
        return;
      }
      setErrorMsg(error.message ?? 'Platba se nezdařila.');
      setPhase('error');
      return;
    }
    // Potvrdit objednávku a vydat vstupenky
    try {
      await apiFetch('/api/mobile/order-confirm', {
        method: 'POST',
        body: { paymentIntentId: piId },
      });
    } catch {
      // Vstupenky budou vydány webhookem na pozadí — pokračuj
    }
    router.replace('/tickets');
  }

  function onWebNavChange(navState: WebViewNavigation) {
    const { url } = navState;
    if (url.includes('/potvrzeni') || url.includes('/confirmation')) {
      router.replace('/tickets');
    } else if (url.includes('/cancel') || url.includes('/zruseno')) {
      router.back();
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (phase === 'webview') {
    return (
      <View style={s.fill}>
        {webLoading && (
          <View style={s.overlay}>
            <ActivityIndicator color={colors.brand} size="large" />
          </View>
        )}
        {webviewUri ? (
          <WebView
            source={{ uri: webviewUri }}
            style={s.fill}
            onLoadStart={() => setWebLoading(true)}
            onLoadEnd={() => setWebLoading(false)}
            onNavigationStateChange={onWebNavChange}
            sharedCookiesEnabled={Platform.OS === 'ios'}
            thirdPartyCookiesEnabled
            javaScriptEnabled
            domStorageEnabled
            onShouldStartLoadWithRequest={(req) =>
              [WEB_BASE, API_BASE_URL, 'gw.sandbox.gopay.com', 'gw.gopay.com', 'pay.comgate.cz', 'pay.pay.eu'].some(
                (h) => req.url.includes(h),
              )
            }
          />
        ) : (
          <View style={s.overlay}>
            <ActivityIndicator color={colors.brand} size="large" />
          </View>
        )}
      </View>
    );
  }

  if (phase === 'init' || phase === 'paying') {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.brand} size="large" />
        <Text style={s.loadingText}>
          {phase === 'paying' ? 'Zpracovávám platbu…' : 'Připravuji platbu…'}
        </Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={s.center}>
        <Text style={s.error}>{errorMsg ?? 'Nastala chyba.'}</Text>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backBtnText}>Zpět</Text>
        </Pressable>
      </View>
    );
  }

  // phase === 'ready' — nativní Stripe PaymentSheet
  return (
    <View style={s.container}>
      <View style={s.card}>
        <Text style={s.heading}>{title ?? 'Nákup vstupenek'}</Text>
        <Text style={s.sub}>Pokračuj výběrem způsobu platby</Text>

        <Pressable style={s.payBtn} onPress={handlePay}>
          <Text style={s.payBtnText}>
            {Platform.OS === 'ios' ? '🍎  Vybrat způsob platby' : '🟢  Vybrat způsob platby'}
          </Text>
        </Pressable>

        <Text style={s.hint}>
          {Platform.OS === 'ios'
            ? 'Apple Pay, karta a další platební metody'
            : 'Google Pay, karta a další platební metody'}
        </Text>

        <Pressable style={s.cancelBtn} onPress={() => router.back()}>
          <Text style={s.cancelText}>Zrušit</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  fill:        { flex: 1, backgroundColor: colors.bg },
  container:   { flex: 1, backgroundColor: colors.bg, justifyContent: 'flex-end', padding: space.lg },
  overlay:     { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, zIndex: 10 },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg, gap: space.md },
  card:        { backgroundColor: colors.bgMuted, borderRadius: radius.lg, padding: space.lg, gap: space.md, marginBottom: space.xl },
  heading:     { fontSize: 20, fontWeight: '800', color: colors.text, textAlign: 'center' },
  sub:         { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  loadingText: { fontSize: 15, color: colors.textMuted, marginTop: space.sm },
  error:       { color: colors.danger, textAlign: 'center', fontSize: 15 },
  backBtn:     { marginTop: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: colors.bgMuted, borderRadius: radius.md },
  backBtnText: { color: colors.text, fontWeight: '600' },
  payBtn:      { backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: 18, alignItems: 'center', marginTop: space.sm },
  payBtnText:  { color: '#fff', fontWeight: '800', fontSize: 17 },
  hint:        { fontSize: 11, color: colors.textMuted, textAlign: 'center' },
  cancelBtn:   { alignItems: 'center', paddingVertical: space.sm },
  cancelText:  { color: colors.textMuted, fontSize: 14 },
});
