import { describe, it, expect } from 'vitest';
import { hashIdentity } from '../src/lib/identity-crypto.js';

describe('hashIdentity', () => {
  const salt = 'unit-test-salt-0123456789abcdef';

  it('is deterministic for the same input and salt', () => {
    const a = hashIdentity('9912311234', salt);
    const b = hashIdentity('9912311234', salt);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalizes formatting (slash vs no slash)', () => {
    expect(hashIdentity('991231/1234', salt)).toBe(hashIdentity('9912311234', salt));
  });

  it('produces different hashes for different birth numbers', () => {
    expect(hashIdentity('9912311234', salt)).not.toBe(hashIdentity('9912311235', salt));
  });

  it('produces different hashes for different salts', () => {
    const s2 = 'another-test-salt-abcdef0123456789';
    expect(hashIdentity('9912311234', salt)).not.toBe(hashIdentity('9912311234', s2));
  });

  it('rejects empty birth number', () => {
    expect(() => hashIdentity('', salt)).toThrow();
  });

  it('rejects short salt', () => {
    expect(() => hashIdentity('9912311234', 'short')).toThrow();
  });
});
