#!/usr/bin/env node
/**
 * check-overlaps.mjs — detekce překrývajících se sedadel v Tixly layoutu.
 *
 * Použití:
 *   node scripts/check-overlaps.mjs <layout.json> [tolerance]
 *   node scripts/check-overlaps.mjs scripts/layouts-from-db/stadion-fc-praha.json
 *   node scripts/check-overlaps.mjs scripts/layouts/stadion-12k.json 10
 *
 * Default tolerance je 5 SVG jednotek — dvě sedadla blíž než 5px je collision.
 *
 * Výstup:
 *   - Total seats, sectors, rows
 *   - Počet overlap dvojic
 *   - Top 20 nejhorších collisions (pair label)
 *   - Tip jak fixovat
 *
 * Exit code:
 *   0 = OK (žádné kolize)
 *   1 = overlaps found
 *   2 = parse error / nelze otevřít
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function main() {
  const [, , filePath, toleranceArg] = process.argv;
  if (!filePath) {
    console.error('Usage: node scripts/check-overlaps.mjs <layout.json> [tolerance=5]');
    process.exit(2);
  }
  const tolerance = Number(toleranceArg ?? 5);
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    console.error(`Invalid tolerance: ${toleranceArg}`);
    process.exit(2);
  }

  let layout;
  try {
    layout = JSON.parse(readFileSync(resolve(filePath), 'utf8'));
  } catch (err) {
    console.error(`Cannot read/parse ${filePath}: ${err.message}`);
    process.exit(2);
  }

  // Sběr všech sedadel s identifikátorem
  const seats = [];
  for (const sector of layout.sectors ?? []) {
    for (const row of sector.rows ?? []) {
      for (const seat of row.seats ?? []) {
        seats.push({
          id: `${sector.name}/${row.label}/${seat.num}`,
          x: Number(seat.x),
          y: Number(seat.y),
          sector: sector.name,
        });
      }
    }
  }

  // Detekce kolizí — spatial bucket pro O(n) místo O(n²)
  const bucketSize = tolerance * 2;
  const buckets = new Map(); // key "bx,by" → array of seats
  const overlaps = [];

  for (const seat of seats) {
    if (!Number.isFinite(seat.x) || !Number.isFinite(seat.y)) {
      overlaps.push({ a: seat, b: null, reason: 'invalid coords' });
      continue;
    }
    const bx = Math.floor(seat.x / bucketSize);
    const by = Math.floor(seat.y / bucketSize);
    // Zkontroluj 9 sousedních bucketů (sedadlo blízko hranice)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${bx + dx},${by + dy}`;
        const neighbors = buckets.get(key);
        if (!neighbors) continue;
        for (const other of neighbors) {
          const dist = Math.hypot(seat.x - other.x, seat.y - other.y);
          if (dist < tolerance) {
            overlaps.push({ a: other, b: seat, distance: dist });
          }
        }
      }
    }
    // Přidej do svého bucketu pro pozdější checky
    const myKey = `${bx},${by}`;
    let bucket = buckets.get(myKey);
    if (!bucket) {
      bucket = [];
      buckets.set(myKey, bucket);
    }
    bucket.push(seat);
  }

  // Statistika per sektor
  const collisionsBySector = new Map();
  for (const o of overlaps) {
    if (!o.a || !o.b) continue;
    const key = o.a.sector === o.b.sector ? o.a.sector : `${o.a.sector} ↔ ${o.b.sector}`;
    collisionsBySector.set(key, (collisionsBySector.get(key) ?? 0) + 1);
  }

  // Output
  const totalSectors = layout.sectors?.length ?? 0;
  const totalRows = layout.sectors?.reduce((s, sec) => s + (sec.rows?.length ?? 0), 0) ?? 0;
  console.log(`\n=== ${filePath} ===`);
  console.log(`Layout:    ${totalSectors} sectors, ${totalRows} rows, ${seats.length} seats`);
  console.log(`Tolerance: ${tolerance} units`);
  console.log(`viewBox:   ${layout.viewBox ?? '(missing)'}`);
  console.log('');

  if (overlaps.length === 0) {
    console.log('✅  No overlaps detected.');
    process.exit(0);
  }

  console.log(`❌  ${overlaps.length} collision pair(s) found.\n`);

  // Top sectors with collisions
  const sortedSectors = [...collisionsBySector.entries()].sort((a, b) => b[1] - a[1]);
  console.log('Top sektory s kolizemi:');
  for (const [name, count] of sortedSectors.slice(0, 10)) {
    console.log(`  ${count.toString().padStart(5)}× ${name}`);
  }

  // First 20 sample collisions
  console.log('\nUkázka kolizí (prvních 20):');
  for (const o of overlaps.slice(0, 20)) {
    if (!o.b) {
      console.log(`  invalid: ${o.a.id} (${o.a.x}, ${o.a.y})`);
    } else {
      console.log(
        `  ${o.distance.toFixed(2)}px  ${o.a.id}  ↔  ${o.b.id}`,
      );
    }
  }

  console.log('\nTip: pokud se kolize objevují v jednom sektoru:');
  console.log('  → seatPitch / rowPitch je moc malý, zvýš na 18-22');
  console.log('Pokud mezi sektory:');
  console.log('  → překrývají se origin pozice (startX, startY)');
  console.log('  → použij visual editor nebo přemapuj v generate-rich-layouts.mjs');

  process.exit(1);
}

main();
