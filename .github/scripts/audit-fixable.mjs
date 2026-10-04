#!/usr/bin/env node
/**
 * Gate pro `npm audit` (kolo 7): job padá jen na OPRAVITELNÉ zranitelnosti high/critical.
 *
 * Opravitelná = zmizí po `npm audit fix` BEZ --force (tj. oprava v rámci povolených rozsahů, bez nové
 * hlavní verze). Rozhoduje skutečný běh, ne pole `fixAvailable`: npm u řady balíčků hlásí „fix: true",
 * i když opravu brání rodič (např. turbo-stream <3 pod @remix-run/server-runtime 2.x, image-size 1.x
 * pod metro 0.80) a `npm audit fix` je nezmění — gate by pak padal napořád.
 *
 * Postup (v dočasné kopii package.json + package-lock.json + .npmrc modulu, nic se neinstaluje):
 *   1. npm audit --json --package-lock-only            → stav A
 *   2. npm audit fix --package-lock-only (bez --force)
 *   3. npm audit --json --package-lock-only            → stav B
 *   opravitelné = high/critical v A, které v B nejsou.
 *
 * Použití: node .github/scripts/audit-fixable.mjs <adresář-modulu>
 * Výstup: tabulka všech high/critical (stav | závažnost | balíček | potřebná verze); exit 1 při opravitelných.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const GATED = new Set(['high', 'critical']);

const gated = (audit) =>
  Object.entries(audit?.vulnerabilities ?? {}).filter(([, v]) => GATED.has(v.severity));

const needsOf = (fa) =>
  fa === false ? 'bez opravy'
    : fa === true ? 'oprava v rozsahu (npm audit fix ji neprovede)'
    : `${fa.name}@${fa.version}${fa.isSemVerMajor ? ' (nová hlavní verze)' : ''}`;

/**
 * @param before výstup `npm audit --json` před `npm audit fix`
 * @param after  výstup `npm audit --json` po `npm audit fix` (bez --force)
 * @returns {{ name: string, severity: string, fixable: boolean, needs: string }[]}
 */
export function classify(before, after) {
  const remaining = new Set(gated(after).map(([n]) => n));
  return gated(before)
    .map(([name, v]) => {
      const fixable = !remaining.has(name);
      return { name, severity: v.severity, fixable, needs: fixable ? 'npm audit fix (bez --force)' : needsOf(v.fixAvailable) };
    })
    .sort((a, b) => Number(b.fixable) - Number(a.fixable) || a.name.localeCompare(b.name));
}

function npmJson(args, cwd) {
  let out;
  try {
    out = execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  } catch (e) {
    out = e.stdout; // npm audit vrací nenulový kód, když něco najde
  }
  const j = JSON.parse(out);
  if (j.error) throw new Error(`npm ${args.join(' ')}: ${JSON.stringify(j.error)}`);
  return j;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = path.resolve(process.argv[2] ?? '.');
  const tmp = mkdtempSync(path.join(tmpdir(), 'audit-gate-'));
  try {
    copyFileSync(path.join(dir, 'package.json'), path.join(tmp, 'package.json'));
    copyFileSync(path.join(dir, 'package-lock.json'), path.join(tmp, 'package-lock.json'));
    // .npmrc modulu (např. legacy-peer-deps) — bez něj npm audit fix padá na ERESOLVE a gate by nic nezjistil.
    if (existsSync(path.join(dir, '.npmrc'))) copyFileSync(path.join(dir, '.npmrc'), path.join(tmp, '.npmrc'));
    const before = npmJson(['audit', '--json', '--package-lock-only'], tmp);
    const lockA = JSON.parse(readFileSync(path.join(tmp, 'package-lock.json'), 'utf8')).packages ?? {};
    try {
      execFileSync('npm', ['audit', 'fix', '--package-lock-only', '--no-fund'], { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    } catch (e) {
      // Nenulový kód je běžný (po opravě něco zbylo — ukáže stav B). Selhání řešení závislostí
      // ale znamená, že oprava vůbec neproběhla → gate nesmí tiše projít.
      const err = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      if (/npm (error|ERR!) code E[A-Z0-9]+/.test(err)) {
        console.error(`npm audit fix selhal: ${err.slice(0, 2000)}`);
        process.exit(2);
      }
    }
    const after = npmJson(['audit', '--json', '--package-lock-only'], tmp);
    const lockB = JSON.parse(readFileSync(path.join(tmp, 'package-lock.json'), 'utf8')).packages ?? {};
    const rows = classify(before, after);
    // U opravitelných ukaž, co npm audit fix v lockfilu změnil (verze A → B) — podklad pro opravu.
    const versions = (lock, name) => Object.entries(lock)
      .filter(([k]) => k === `node_modules/${name}` || k.endsWith(`/node_modules/${name}`))
      .map(([k, v]) => `${k.replace(/node_modules\//g, '')}@${v.version}`).join(', ') || '—';
    for (const r of rows) if (r.fixable) r.needs = `npm audit fix: ${versions(lockA, r.name)} → ${versions(lockB, r.name)}`;
    for (const r of rows) {
      console.log(`${(r.fixable ? 'OPRAVITELNÉ' : 'neopravitelné').padEnd(13)} ${r.severity.padEnd(8)} ${r.name.padEnd(40)} ${r.needs}`);
    }
    const bad = rows.filter((r) => r.fixable);
    console.log(`\nhigh/critical: ${rows.length}, opravitelných přes npm audit fix (bez --force): ${bad.length}`);
    if (bad.length > 0) {
      console.error('Spusťte `npm audit fix` (bez --force) a commitněte package-lock.json.');
      process.exitCode = 1;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
