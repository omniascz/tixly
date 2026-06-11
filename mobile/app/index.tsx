import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { getToken, biometricGate } from '@/lib/session';
import { colors } from '@/lib/theme';

/** Boot screen: ověř session (+ biometrie) a přesměruj na vstupenky nebo login. */
export default function BootScreen() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    (async () => {
      const token = await getToken();
      if (!token) {
        if (active) router.replace('/login');
        return;
      }
      const ok = await biometricGate('Odemkni své vstupenky');
      if (!active) return;
      router.replace(ok ? '/tickets' : '/login');
    })();
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Tixly</Text>
      <ActivityIndicator color={colors.white} style={{ marginTop: 24 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand },
  title: { fontSize: 52, fontWeight: '900', color: colors.white, letterSpacing: -1 },
});
