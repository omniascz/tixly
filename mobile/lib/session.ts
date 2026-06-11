import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Session = JWT access token uložený v zařízení přes SecureStore (Keychain /
 * Keystore — šifrované úložiště, ne plaintext). Volitelně gate přes Face ID /
 * otisk při otevření appky.
 *
 * Pozn.: backend dnes vrací refreshToken jen jako httpOnly cookie (web). Pro
 * nativní appku zatím držíme access token (15 min) a po vypršení (401) vedeme
 * uživatele na login. Plný refresh-token-in-body je samostatný backend krok.
 */
const TOKEN_KEY = 'tixly.accessToken';
const USER_KEY = 'tixly.user';

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

/**
 * Biometrický gate (Face ID / Touch ID / otisk). Vrací true, pokud ověření
 * uspělo NEBO zařízení biometrii nemá (pak appku nezamykáme). False jen při
 * aktivním zamítnutí.
 */
export async function biometricGate(prompt = 'Odemkni Tixly'): Promise<boolean> {
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
    return true; // biometrie selhala technicky → neblokuj přístup
  }
}
