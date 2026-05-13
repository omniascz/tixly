import { describe, it, expect, vi } from 'vitest';
import { resolveTenantFromHost } from '../lib/domain-resolver';

function makeRedis(store: Record<string, string> = {}) {
  return {
    get: vi.fn().mockImplementation(async (key: string) => store[key] ?? null),
  };
}

describe('domain-resolver', () => {
  it('1. Rozpozná subdoménu slavia.tixly.cz → promoterId ze Redis', async () => {
    const redis = makeRedis({ 'slug:slavia': 'promoter-slavia-id' });
    const result = await resolveTenantFromHost('slavia.tixly.cz', { redis });
    expect(result).toEqual({ promoterId: 'promoter-slavia-id', type: 'subdomain', slug: 'slavia' });
  });

  it('2. Reserved slug "admin.tixly.cz" → null', async () => {
    const redis = makeRedis({ 'slug:admin': 'should-not-resolve' });
    const result = await resolveTenantFromHost('admin.tixly.cz', { redis });
    expect(result).toBeNull();
  });

  it('3. Neznámá subdoména (Redis miss) → null', async () => {
    const redis = makeRedis({});
    const result = await resolveTenantFromHost('unknown.tixly.cz', { redis });
    expect(result).toBeNull();
  });

  it('4. Custom doména s Redis cache → promoterId', async () => {
    const redis = makeRedis({ 'domain:vstupenky.slaviapraha.cz': 'promoter-abc' });
    const result = await resolveTenantFromHost('vstupenky.slaviapraha.cz', { redis });
    expect(result).toEqual({ promoterId: 'promoter-abc', type: 'custom' });
  });

  it('5. tixly.cz (root) → null', async () => {
    const redis = makeRedis();
    const result = await resolveTenantFromHost('tixly.cz', { redis });
    expect(result).toBeNull();
  });

  it('6. www.tixly.cz → null', async () => {
    const redis = makeRedis();
    const result = await resolveTenantFromHost('www.tixly.cz', { redis });
    expect(result).toBeNull();
  });

  it('7. localhost → null', async () => {
    const redis = makeRedis();
    const result = await resolveTenantFromHost('localhost', { redis });
    expect(result).toBeNull();
  });

  it('8. Host s portem (slavia.tixly.cz:3000) → správně rozpozná slug', async () => {
    const redis = makeRedis({ 'slug:slavia': 'promoter-slavia-id' });
    const result = await resolveTenantFromHost('slavia.tixly.cz:3000', { redis });
    expect(result).toEqual({ promoterId: 'promoter-slavia-id', type: 'subdomain', slug: 'slavia' });
  });

  it('9. Velká písmena v hostu → normalizuje na lowercase', async () => {
    const redis = makeRedis({ 'slug:slavia': 'promoter-slavia-id' });
    const result = await resolveTenantFromHost('SLAVIA.TIXLY.CZ', { redis });
    expect(result).toEqual({ promoterId: 'promoter-slavia-id', type: 'subdomain', slug: 'slavia' });
  });

  it('10. Neplatný host (custom doména bez Redis záznamu) → null', async () => {
    const redis = makeRedis({});
    const result = await resolveTenantFromHost('nonexistent.example.com', { redis });
    expect(result).toBeNull();
  });
});
