import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Session obsluhy = JWT access token v SecureStore (Keychain/Keystore).
 * Volitelný biometrický gate při otevření appky.
 */
const TOKEN_KEY = 'tixly.promoter.accessToken';
const USER_KEY = 'tixly.promoter.user';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export async function saveSession(token: string, user: SessionUser): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function getUser(): Promise<SessionUser | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}

export async function biometricGate(prompt = 'Odemkni Tixly Promotér'): Promise<boolean> {
  try {
    const hasHw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hasHw || !enrolled) return true;
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: prompt,
      fallbackLabel: 'Zadat kód',
    });
    return res.success;
  } catch {
    return true;
  }
}
