// @vitest-environment node
/**
 * Kolo 3 / krok 1 — kolize čísla migrace.
 * Migrace kola 1 `472_refund_gateway_state.sql` kolidovala s necommitnutou
 * `472_royalty_agreements_currency.sql` v pracovním stromu tixly/ (472–478 tam obsazeno).
 * Přečíslováno na 479. Test hlídá: číselné prefixy migrací jsou unikátní a refund migrace je 479.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync } from 'fs';
import path from 'path';
import { hasLocalDb } from './helpers/local-fixture';

const run = describe.skipIf(!hasLocalDb);
const DIR = path.resolve(__dirname, '../../migrations');

run('Krok 1 (kolo 3) — čísla migrací', () => {
  it('číselné prefixy migrací 4xx jsou unikátní', () => {
    const nums = readdirSync(DIR).filter((f) => /^4\d\d_.*\.sql$/.test(f)).map((f) => f.slice(0, 3));
    const dup = nums.filter((n, i) => nums.indexOf(n) !== i);
    expect(dup).toEqual([]);
  });
  it('refund migrace kola 1 má číslo 479 (472 je obsazeno necommitnutou prací v tixly/)', () => {
    const files = readdirSync(DIR);
    expect(files).toContain('479_refund_gateway_state.sql');
    expect(files).not.toContain('472_refund_gateway_state.sql');
  });
});
