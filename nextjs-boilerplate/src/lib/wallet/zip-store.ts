/**
 * Minimal ZIP encoder — STORE method (no compression).
 *
 * Postačuje pro malé `.pkpass` bundly (pass.json + manifest.json + signature
 * + icon.png ≈ 5 KB). Bez external deps.
 *
 * Reference: PKWARE APPNOTE.TXT 6.3.10 sections 4.3.7, 4.4.5.
 */

import { Buffer } from 'node:buffer';

export interface ZipFile {
  name: string;
  data: Buffer;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZip(files: ZipFile[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = Buffer.from(f.name, 'utf-8');
    const crc = crc32(f.data);
    const size = f.data.length;

    // Local file header
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0, 6); // flags
    lh.writeUInt16LE(0, 8); // method: STORE
    lh.writeUInt16LE(0, 10); // mtime
    lh.writeUInt16LE(0x21, 12); // mdate (1980-01-01)
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(nameBytes.length, 26);
    lh.writeUInt16LE(0, 28); // extra length
    localParts.push(lh, nameBytes, f.data);

    // Central directory entry
    const ce = Buffer.alloc(46);
    ce.writeUInt32LE(0x02014b50, 0);
    ce.writeUInt16LE(20, 4); // version made by
    ce.writeUInt16LE(20, 6); // version needed
    ce.writeUInt16LE(0, 8); // flags
    ce.writeUInt16LE(0, 10); // method
    ce.writeUInt16LE(0, 12); // mtime
    ce.writeUInt16LE(0x21, 14); // mdate
    ce.writeUInt32LE(crc, 16);
    ce.writeUInt32LE(size, 20);
    ce.writeUInt32LE(size, 24);
    ce.writeUInt16LE(nameBytes.length, 28);
    ce.writeUInt16LE(0, 30); // extra
    ce.writeUInt16LE(0, 32); // comment
    ce.writeUInt16LE(0, 34); // disk
    ce.writeUInt16LE(0, 36); // internal attrs
    ce.writeUInt32LE(0, 38); // external attrs
    ce.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(ce, nameBytes);

    offset += 30 + nameBytes.length + size;
  }

  const localData = Buffer.concat(localParts);
  const central = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // disk with CD
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(localData.length, 16);
  eocd.writeUInt16LE(0, 20); // comment

  return Buffer.concat([localData, central, eocd]);
}
