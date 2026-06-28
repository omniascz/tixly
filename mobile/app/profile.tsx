import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { getUser, clearSession, type SessionUser } from '@/lib/session';
import { apiFetch } from '@/lib/api';
import { colors, radius, space } from '@/lib/theme';

interface PushPrefs {
  push_enabled:        boolean;
  pre_event_reminders: boolean;
  abandoned_cart:      boolean;
  order_confirmations: boolean;
}

export default function ProfileScreen() {
  const router = useRouter();
  const [user, setUser]   = useState<SessionUser | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs | null>(null);

  useEffect(() => {
    void getUser().then(setUser);
    void apiFetch<{ prefs: PushPrefs }>('/api/buyer/notification-preferences')
      .then((r) => setPrefs(r.prefs))
      .catch(() => null);
  }, []);

  async function togglePref(key: keyof PushPrefs) {
    if (!prefs) return;
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);
    await apiFetch('/api/buyer/notification-preferences', {
      method: 'PATCH',
      body:   updated,
    }).catch(() => null);
  }

  async function logout() {
    await clearSession();
    router.replace('/login');
  }

  function confirmLogout() {
    Alert.alert('Odhlásit se', 'Opravdu se chcete odhlásit?', [
      { text: 'Zrušit', style: 'cancel' },
      { text: 'Odhlásit', style: 'destructive', onPress: logout },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* User info */}
      <View style={styles.section}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.name?.charAt(0).toUpperCase() ?? '?'}
          </Text>
        </View>
        <Text style={styles.name}>{user?.name ?? '—'}</Text>
        <Text style={styles.email}>{user?.email ?? '—'}</Text>
      </View>

      {/* Quick links */}
      <View style={styles.card}>
        <Pressable style={styles.row} onPress={() => router.push('/tickets')}>
          <Text style={styles.rowLabel}>Moje vstupenky</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <View style={styles.divider} />
        <Pressable style={styles.row} onPress={() => router.push('/orders')}>
          <Text style={styles.rowLabel}>Historie objednávek</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>

      {/* Notification preferences */}
      {prefs && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Oznámení</Text>
          {(
            [
              { key: 'push_enabled',        label: 'Push notifikace' },
              { key: 'pre_event_reminders', label: 'Připomenutí akce' },
              { key: 'abandoned_cart',      label: 'Nedokončená objednávka' },
              { key: 'order_confirmations', label: 'Potvrzení objednávek' },
            ] as { key: keyof PushPrefs; label: string }[]
          ).map(({ key, label }, i, arr) => (
            <View key={key}>
              <View style={styles.prefRow}>
                <Text style={styles.prefLabel}>{label}</Text>
                <Switch
                  value={prefs[key]}
                  onValueChange={() => { void togglePref(key); }}
                  thumbColor={prefs[key] ? colors.brand : colors.textMuted}
                  trackColor={{ false: colors.bgMuted, true: colors.brand + '55' }}
                />
              </View>
              {i < arr.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>
      )}

      {/* Logout */}
      <Pressable style={styles.logoutBtn} onPress={confirmLogout}>
        <Text style={styles.logoutText}>Odhlásit se</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:   { padding: space.md, gap: space.md },
  section:     { alignItems: 'center', paddingVertical: space.lg },
  avatar:      { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  avatarText:  { fontSize: 32, fontWeight: '900', color: colors.white },
  name:        { fontSize: 18, fontWeight: '700', color: colors.text },
  email:       { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  card:        { backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  sectionTitle:{ fontSize: 13, fontWeight: '700', color: colors.textMuted, padding: space.md, paddingBottom: space.sm },
  row:         { flexDirection: 'row', alignItems: 'center', padding: space.md },
  rowLabel:    { flex: 1, fontSize: 15, color: colors.text },
  chevron:     { fontSize: 20, color: colors.textMuted },
  divider:     { height: 1, backgroundColor: colors.border, marginHorizontal: space.md },
  prefRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingVertical: 10 },
  prefLabel:   { flex: 1, fontSize: 15, color: colors.text },
  logoutBtn:   { backgroundColor: colors.danger + '18', borderRadius: radius.md, padding: space.md, alignItems: 'center', borderWidth: 1, borderColor: colors.danger + '44' },
  logoutText:  { color: colors.danger, fontWeight: '700', fontSize: 15 },
});
