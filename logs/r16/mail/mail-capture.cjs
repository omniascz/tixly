// Kolo 16 / krok 3 — zachycení skutečných SendMailOptions z kódu aplikace (bez zásahu do aplikace).
// node --require mail-capture.cjs …  (MAIL_CAPTURE_DIR = cílový adresář)
// Patchuje Mailer.prototype.sendMail nainstalovaného nodemaileru (CJS cache sdílí require i import) a před odesláním
// uloží volby do JSON (Buffer → base64). Odeslání pak proběhne normálně.
const fs = require('node:fs');
const path = require('node:path');
const dir = process.env.MAIL_CAPTURE_DIR;
if (dir) {
  fs.mkdirSync(dir, { recursive: true });
  const mailerPath = require.resolve('nodemailer/lib/mailer/index.js', { paths: [process.cwd()] });
  const Mailer = require(mailerPath);
  const orig = Mailer.prototype.sendMail;
  let n = 0;
  const ser = (v) => {
    if (Buffer.isBuffer(v)) return { __buffer: v.toString('base64') };
    if (v instanceof Uint8Array) return { __buffer: Buffer.from(v).toString('base64') };
    if (Array.isArray(v)) return v.map(ser);
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) if (typeof x !== 'function') o[k] = ser(x); return o; }
    return v;
  };
  Mailer.prototype.sendMail = function (data, cb) {
    try {
      const file = path.join(dir, `${process.pid}-t${require('node:worker_threads').threadId}-${String(++n).padStart(3, '0')}.json`);
      fs.writeFileSync(file, JSON.stringify({ capturedAt: new Date().toISOString(), data: ser(data) }, null, 1));
    } catch (e) { console.error('[mail-capture]', e); }
    return orig.call(this, data, cb);
  };
  // bez výpisu na stdout/stderr (npx a nástroje čtou výstup pomocných procesů) — jen značka do souboru
  fs.appendFileSync(path.join(dir, '_aktivni.txt'), `${process.pid} nodemailer ${require(require.resolve('nodemailer/package.json', { paths: [process.cwd()] })).version}
`);
}
