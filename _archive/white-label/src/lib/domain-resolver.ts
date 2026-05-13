export interface TenantResolution {
  promoterId: string;
  type: 'subdomain' | 'custom';
  slug?: string;
}

const RESERVED_SLUGS = new Set([
  'api', 'admin', 'cdn', 'mail', 'www', 'app', 'static',
  'assets', 'media', 'platform', 'dashboard', 'auth',
]);

export async function resolveTenantFromHost(
  host: string,
  deps: { redis: { get(key: string): Promise<string | null> } },
): Promise<TenantResolution | null> {
  const normalizedHost = host.toLowerCase().replace(/:\d+$/, ''); // strip port

  // 1. Subdoména tixly.cz
  const subMatch = normalizedHost.match(
    /^([a-z0-9][a-z0-9-]{0,61}[a-z0-9])\.tixly\.cz$/,
  );
  if (subMatch) {
    const slug = subMatch[1];
    if (RESERVED_SLUGS.has(slug)) return null;
    const promoterId = await deps.redis.get(`slug:${slug}`);
    if (!promoterId) return null;
    return { promoterId, type: 'subdomain', slug };
  }

  // 2. Platform root — ne tenant
  if (
    normalizedHost === 'tixly.cz' ||
    normalizedHost === 'www.tixly.cz' ||
    normalizedHost === 'localhost' ||
    normalizedHost.startsWith('localhost:')
  ) {
    return null;
  }

  // 3. Custom doména — pouze active + ssl
  const promoterId = await deps.redis.get(`domain:${normalizedHost}`);
  if (promoterId) return { promoterId, type: 'custom' };

  return null;
}

export { RESERVED_SLUGS };
