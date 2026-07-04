/**
 * prebuild: zkopíruje pdfjs-dist worker do public/ (same-origin runtime).
 *
 * Proč prebuild (ne postinstall): Vercel může při cachovaném node_modules postinstall
 * přeskočit → worker by v /public chyběl → build projde, ale runtime pdf import spadne
 * na 404. `prebuild` běží VŽDY před `next build` (npm lifecycle), lokálně i na Vercelu.
 *
 * Idempotentní (přepíše cíl), fail-loud (když zdroj chybí, skončí != 0 — radši ať build
 * spadne teď, než aby produkce servírovala 404 worker).
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(pkgRoot, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs');
const destDir = join(pkgRoot, 'public');
const dest = join(destDir, 'pdf.worker.min.mjs');

if (!existsSync(src)) {
  console.error(`[copy-pdf-worker] CHYBA: zdroj neexistuje: ${src}\n  Je pdfjs-dist nainstalován? (npm ci)`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);

const bytes = statSync(dest).size;
if (bytes < 500_000) {
  console.error(`[copy-pdf-worker] CHYBA: cíl podezřele malý (${bytes} B) — kopie selhala?`);
  process.exit(1);
}
console.log(`[copy-pdf-worker] OK: ${(bytes / 1024 / 1024).toFixed(2)} MB → public/pdf.worker.min.mjs`);
