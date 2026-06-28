/**
 * Checkout screen — WebView wrapper around the web checkout page.
 *
 * Native SDKs for payment gateways would add significant build complexity.
 * WebView delegates to the fully-tested web checkout (GoPay, Comgate, etc.)
 * while keeping the native frame (header, biometric lock, back navigation).
 *
 * Route: /checkout?eventSlug=xxx&ticketTypeId=yyy&qty=1
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { getToken } from '@/lib/session';
import { API_BASE_URL } from '@/lib/config';
import { colors, space } from '@/lib/theme';

const WEB_BASE = API_BASE_URL.replace('/api', '');

export default function CheckoutScreen() {
  const { eventSlug, ticketTypeId, qty = '1' } = useLocalSearchParams<{
    eventSlug: string;
    ticketTypeId?: string;
    qty?: string;
  }>();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const webRef = useRef<WebView>(null);

  useEffect(() => {
    void getToken().then(setToken);
  }, []);

  if (!eventSlug) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Chybí parametr akce.</Text>
      </View>
    );
  }

  const checkoutUrl = [
    `${WEB_BASE}/cs/akce/${eventSlug}/checkout`,
    `?source=mobile`,
    ticketTypeId ? `&ticketTypeId=${ticketTypeId}` : '',
    `&qty=${qty}`,
    token ? `&mobileToken=${encodeURIComponent(token)}` : '',
  ].join('');

  function onNavChange(navState: WebViewNavigation) {
    const url = navState.url;
    if (url.includes('/potvrzeni') || url.includes('/confirmation')) {
      router.replace('/tickets');
    } else if (url.includes('/cancel') || url.includes('/zruseno')) {
      router.back();
    }
  }

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      )}
      <WebView
        ref={webRef}
        source={{ uri: checkoutUrl }}
        style={styles.webview}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onNavigationStateChange={onNavChange}
        sharedCookiesEnabled={Platform.OS === 'ios'}
        thirdPartyCookiesEnabled
        javaScriptEnabled
        domStorageEnabled
        onShouldStartLoadWithRequest={(req) => {
          const allowed = [
            WEB_BASE,
            'gw.sandbox.gopay.com',
            'gw.gopay.com',
            'pay.comgate.cz',
            'pay.pay.eu',
          ];
          return allowed.some((h) => req.url.includes(h));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: colors.bg },
  webview:        { flex: 1 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, zIndex: 10 },
  center:         { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  error:          { color: colors.danger, textAlign: 'center' },
});
