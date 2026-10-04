/**
 * Kolo 7 / krok 4 — gate security workflow (.github/scripts/audit-fixable.mjs):
 * padá jen na high/critical, které zmizí po `npm audit fix` bez --force.
 */
import { describe, expect, it } from 'vitest';
import { classify } from '../../.github/scripts/audit-fixable.mjs';

type Row = { name: string; severity: string; fixable: boolean; needs: string };
const v = (severity: string, fixAvailable: unknown) => ({ severity, via: [{ title: 't' }], fixAvailable });

describe('audit-fixable gate', () => {
  it('opravitelné = high/critical, které po npm audit fix zmizí; moderate se ignoruje', () => {
    const before = {
      vulnerabilities: {
        axios: v('high', true),
        next: v('critical', { name: 'next', version: '16.3.8', isSemVerMajor: true }),
        'node-forge': v('high', false),
        lodash: v('moderate', true),
      },
    };
    const after = { vulnerabilities: { next: before.vulnerabilities.next, 'node-forge': before.vulnerabilities['node-forge'] } };
    const rows: Row[] = classify(before, after);
    expect(Object.fromEntries(rows.map((r) => [r.name, r.fixable]))).toEqual({ axios: true, next: false, 'node-forge': false });
    expect(rows.find((r) => r.name === 'next')?.needs).toBe('next@16.3.8 (nová hlavní verze)');
    expect(rows.find((r) => r.name === 'node-forge')?.needs).toBe('bez opravy');
  });

  it('„fix: true", které npm audit fix neprovede (rodič drží starou hlavní verzi) → neopravitelné', () => {
    const before = { vulnerabilities: { 'turbo-stream': v('high', true), 'image-size': v('high', true) } };
    const rows: Row[] = classify(before, before);
    expect(rows.every((r) => !r.fixable)).toBe(true);
    expect(rows[0].needs).toMatch(/npm audit fix ji neprovede/);
  });

  it('po opravě nic nezbylo → žádná řádka není neopravitelná', () => {
    const before = { vulnerabilities: { ws: v('high', { name: 'ws', version: '8.20.2', isSemVerMajor: false }) } };
    const rows: Row[] = classify(before, { vulnerabilities: {} });
    expect(rows).toEqual([{ name: 'ws', severity: 'high', fixable: true, needs: 'npm audit fix (bez --force)' }]);
  });

  it('npm balíček z lockfilu jen odstraní, ale závislý balíček zůstal → neopravitelné (rozbitý lockfile)', () => {
    const before = { vulnerabilities: { 'turbo-stream': v('high', true), ws: v('high', true) } };
    const after = { vulnerabilities: {} };
    const lockAfter = {
      '': { name: 'app' },
      'node_modules/@remix-run/server-runtime': { version: '2.17.5', dependencies: { 'turbo-stream': '2.4.1' } },
      'node_modules/ws': { version: '8.20.2' },
    };
    const rows: Row[] = classify(before, after, lockAfter);
    const m = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(m['turbo-stream'].fixable).toBe(false);
    expect(m['turbo-stream'].needs).toMatch(/potřebuje ho @remix-run\/server-runtime/);
    expect(m.ws.fixable).toBe(true);
    // odstraněný a nikdo ho nepotřebuje → skutečná oprava
    expect(classify({ vulnerabilities: { old: v('high', true) } }, after, { '': {} })[0].fixable).toBe(true);
  });
});
