// ---------------------------------------------------------------------------
// Auth service — device token login for scanner operators
// ---------------------------------------------------------------------------
import * as SecureStore from "expo-secure-store";

const DEVICE_TOKEN_KEY = "tixly_device_token";
const OPERATOR_NAME_KEY = "tixly_operator_name";

export interface LoginResult {
  success: boolean;
  deviceToken?: string;
  operatorName?: string;
  error?: string;
}

export interface AuthDeps {
  apiBaseUrl: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Exchanges an activation code for a device token.
 * The server returns a long-lived device token and the operator name
 * associated with the activation code.
 */
export async function loginWithCode(
  activationCode: string,
  deps: AuthDeps
): Promise<LoginResult> {
  try {
    const f = deps.fetch ?? globalThis.fetch;
    const res = await f(`${deps.apiBaseUrl}/api/scanner/auth/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activationCode }),
    });

    if (!res.ok) {
      return { success: false, error: `Server returned ${res.status}` };
    }

    const body = (await res.json()) as {
      deviceToken: string;
      operatorName: string;
    };

    await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, body.deviceToken);
    await SecureStore.setItemAsync(OPERATOR_NAME_KEY, body.operatorName);

    return {
      success: true,
      deviceToken: body.deviceToken,
      operatorName: body.operatorName,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

/**
 * Loads the stored device token and operator name from SecureStore.
 * Returns nulls if not yet logged in.
 */
export async function loadStoredCredentials(): Promise<{
  deviceToken: string | null;
  operatorName: string | null;
}> {
  const [deviceToken, operatorName] = await Promise.all([
    SecureStore.getItemAsync(DEVICE_TOKEN_KEY),
    SecureStore.getItemAsync(OPERATOR_NAME_KEY),
  ]);
  return { deviceToken, operatorName };
}

/**
 * Clears the stored device token and operator name.
 */
export async function logout(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(DEVICE_TOKEN_KEY),
    SecureStore.deleteItemAsync(OPERATOR_NAME_KEY),
  ]);
}
