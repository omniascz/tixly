import { useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { apiFetch, ApiError } from '@/lib/api';
import { saveSession, type SessionUser } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';

interface LoginResponse {
  accessToken: string;
  user: SessionUser;
}

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch<LoginResponse>('/api/auth/login', {
        method: 'POST',
        auth: false,
        body: { email: email.trim().toLowerCase(), password },
      });
      if (!r.accessToken || !r.user) throw new ApiError(401, 'NO_TOKEN', 'Přihlášení selhalo.');
      await saveSession(r.accessToken, r.user);
      router.replace('/tickets');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Přihlášení selhalo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
    >
      <View style={styles.container}>
        <Text style={styles.brand}>Tixly</Text>
        <Text style={styles.subtitle}>Tvoje vstupenky na dosah ruky.</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="E-mail"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Heslo"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            style={[styles.button, (loading || !email || !password) && styles.buttonDisabled]}
            onPress={submit}
            disabled={loading || !email || !password}
          >
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.buttonText}>Přihlásit se</Text>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, justifyContent: 'center', padding: space.lg },
  brand: { fontSize: 48, fontWeight: '900', color: colors.brand, letterSpacing: -1 },
  subtitle: { fontSize: 16, color: colors.textMuted, marginTop: space.xs, marginBottom: space.xl },
  form: { gap: space.md },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.bgMuted,
  },
  error: { color: colors.danger, fontSize: 14 },
  button: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: space.sm,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.white, fontWeight: '700', fontSize: 16 },
});
