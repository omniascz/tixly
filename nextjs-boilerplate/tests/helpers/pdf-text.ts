/**
 * Text z PDF pro testy — pdfjs běží v samostatném procesu. Na Windows + Node 24 pdfjs občas shodí proces při ukončení
 * (segfault po doběhnutí testů → exit 139), proto ho izolujeme; výsledek se pozná podle značky konce výstupu.
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const SCRIPT = `
const { readFileSync } = require('fs');
(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(process.argv[1])), useSystemFonts: false, disableFontFace: true, isEvalSupported: false }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    text += c.items.map((i) => i.str || '').join(' ') + '\\n';
  }
  process.stdout.write(JSON.stringify({ text }) + '\\n@@END@@\\n');
  process.exit(0);
})().catch((e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });
`;

export function pdfText(pdf: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'pdftext-'));
  try {
    const file = join(dir, 'doc.pdf');
    writeFileSync(file, pdf);
    const r = spawnSync(process.execPath, ['-e', SCRIPT, file], { cwd: process.cwd(), encoding: 'utf8', timeout: 60_000 });
    const out = r.stdout ?? '';
    const end = out.indexOf('\n@@END@@');
    if (end < 0) throw new Error(`pdf-text: extrakce selhala (exit ${String(r.status)}): ${r.stderr}`);
    return (JSON.parse(out.slice(0, end)) as { text: string }).text;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
