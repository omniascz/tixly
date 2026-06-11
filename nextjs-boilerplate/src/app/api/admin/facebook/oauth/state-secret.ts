import { resolveSecret } from '@/lib/security/secrets';

/**
 * Secret pro podpis FB OAuth `state` (CSRF). Dedikovaný env, s fallbackem na
 * INTERNAL_SERVICE_TOKEN kvůli kompatibilitě. V produkci fail-closed (nesmí to
 * být literal z repa — jinak lze forgnout state a dokončit OAuth proti cizímu
 * user_id).
 */
export function fbStateSecret(): string {
  return resolveSecret(
    process.env.FACEBOOK_STATE_SECRET ?? process.env.INTERNAL_SERVICE_TOKEN,
    'FACEBOOK_STATE_SECRET (or INTERNAL_SERVICE_TOKEN)',
    'tixly-fb-default-secret',
  );
}
