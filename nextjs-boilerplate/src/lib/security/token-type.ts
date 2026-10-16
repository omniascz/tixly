/**
 * Typ JWT (FIX K4d, kolo 3). Access i refresh token podepisuje tentýž klíč — bez typu
 * šel refresh token (7 dní) použít jako access token (Bearer / accessToken cookie).
 * Každá strana proto vyžaduje SVŮJ typ: ověřování přihlášení jen `access`,
 * /api/auth/refresh jen `refresh`. Modul je čistý (bez Node API) — bere ho i middleware.
 */
export const TOKEN_TYPE_ACCESS = 'access';
export const TOKEN_TYPE_REFRESH = 'refresh';

/** true = payload je access token (ne refresh ani jiný JWT stejného klíče). */
export function isAccessTokenPayload(payload: object | null | undefined): boolean {
  return (payload as { type?: unknown } | null | undefined)?.type === TOKEN_TYPE_ACCESS;
}

export function isRefreshTokenPayload(payload: object | null | undefined): boolean {
  return (payload as { type?: unknown } | null | undefined)?.type === TOKEN_TYPE_REFRESH;
}
