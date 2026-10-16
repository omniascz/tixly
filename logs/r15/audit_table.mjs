// Kolo 15 — tabulka zbývajících zranitelností z npm audit: balíček | závažnost | přímá/tranzitivní | potřebná verze | dopad
import { readFileSync } from 'node:fs';
const a = JSON.parse(readFileSync(new URL('./3_npm_audit.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../../nextjs-boilerplate/package.json', import.meta.url), 'utf8'));
const direct = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
const dev = new Set(Object.keys(pkg.devDependencies ?? {}));
const DEV_ONLY = /^(?:@vitest\/.*|@typescript-eslint\/.*|vitest|vite|vite-node|esbuild|tinypool|eslint-config-next|@next\/eslint-plugin-next|fast-glob|globby|minimatch|braces|micromatch|chokidar|tailwindcss|postcss-nested|postcss-selector-parser|postcss)$/;
const BUILD = /^(@sentry\/webpack-plugin|@sentry\/bundler-plugin-core|unplugin|rollup)$/;
const impact = (n) => {
  if (n === 'next') return 'build: zabudovaný postcss 8.4.31 zpracovává jen vlastní CSS aplikace při buildu; za běhu nepoužit';
  if (DEV_ONLY.test(n)) return 'jen vývoj / testy / build CSS — nejde do produkčního běhu';
  if (BUILD.test(n)) return 'jen build (nahrávání source map do Sentry)';
  if (/^@opentelemetry\/|^@prisma\/instrumentation$|^@sentry\/(node|nextjs)$|^uuid$/.test(n)) return 'runtime Sentry SDK (instrumentace); bez SENTRY_DSN neaktivní';
  if (/^(@vercel\/blob|undici|@fastify\/busboy)$/.test(n)) return 'runtime: klient @vercel/blob (nahrávání souborů)';
  if (n === 'nodemailer') return 'runtime: odesílání e-mailů (SMTP)';
  if (n === 'node-forge') return 'runtime: kryptografie (oprava zatím neexistuje)';
  if (n === '@simplewebauthn/server') return 'runtime: přihlášení passkey';
  return dev.has(n) ? 'vývoj' : 'runtime';
};
const order = ['critical', 'high', 'moderate', 'low', 'info'];
console.log(`npm audit po upgradu: ${JSON.stringify(a.metadata.vulnerabilities)}\n`);
console.log('| balíček | závažnost | přímá/tranzitivní | potřebná verze (oprava podle npm) | dopad |');
console.log('|---|---|---|---|---|');
for (const [n, v] of Object.entries(a.vulnerabilities).sort((x, y) => order.indexOf(x[1].severity) - order.indexOf(y[1].severity) || x[0].localeCompare(y[0]))) {
  const fix = v.fixAvailable === false ? 'oprava neexistuje' : v.fixAvailable === true ? 'npm audit fix (bez major)' : `${v.fixAvailable.name}@${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? ' (major)' : ''}`;
  console.log(`| ${n} | ${v.severity} | ${direct.has(n) ? 'přímá' : 'tranzitivní'} | ${fix} | ${impact(n)} |`);
}
