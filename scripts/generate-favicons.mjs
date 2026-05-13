// scripts/generate-favicons.mjs
// Vygeneruje favicon.png a apple-icon.png přímo do src/app/ (Next.js metadata
// convention — Next auto-přidá link rel="icon" / "apple-touch-icon" v <head>).
//
// Bílé "T" na fialovém #6C47FF pozadí, stejný jako PWA ikony.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'nextjs-boilerplate', 'src', 'app');

const BG = [108, 71, 255];
const FG = [255, 255, 255];

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size) {
  const stride = size * 3;
  const rows = [];
  const top = Math.floor(size * 0.25);
  const bottomTop = Math.floor(size * 0.35);
  const stemX0 = Math.floor(size * 0.45);
  const stemX1 = Math.floor(size * 0.55);
  const stemY1 = Math.floor(size * 0.75);
  const barX0 = Math.floor(size * 0.2);
  const barX1 = Math.floor(size * 0.8);

  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + stride);
    for (let x = 0; x < size; x++) {
      const inBar = y >= top && y < bottomTop && x >= barX0 && x < barX1;
      const inStem = y >= top && y < stemY1 && x >= stemX0 && x < stemX1;
      const fg = inBar || inStem;
      const off = 1 + x * 3;
      row[off] = fg ? FG[0] : BG[0];
      row[off + 1] = fg ? FG[1] : BG[1];
      row[off + 2] = fg ? FG[2] : BG[2];
    }
    rows.push(row);
  }
  const idat = deflateSync(Buffer.concat(rows));

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// Next.js metadata file convention:
//   src/app/icon.png        → <link rel="icon">
//   src/app/apple-icon.png  → <link rel="apple-touch-icon">
// Sizes: icon většinou 32-256, apple-icon přesně 180×180
for (const [name, size] of [['icon.png', 256], ['apple-icon.png', 180]]) {
  const png = makePng(size);
  const path = join(OUT_DIR, name);
  writeFileSync(path, png);
  console.log(`✓ ${path} (${png.length} B, ${size}×${size})`);
}
