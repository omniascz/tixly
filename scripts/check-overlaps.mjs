#!/usr/bin/env node
/**
 * check-overlaps.mjs — detekce překrývajících se sedadel v Tixly layoutu.
 *
 * Použití:
 *   node scripts/check-overlaps.mjs <layout.json>                  # auto-radius mode
 *   node scripts/check-overlaps.mjs <layout.json> visual           # detekuje vizuální překryv
 *   node scripts/check-overlaps.mjs <layout.json> 18               # custom tolerance
 *   node scripts/check-overlaps.mjs <layout.json> --tight 0.85     # tightness rate
 *
 * Módy:
 *   auto (default)   — spočítá průměrný seatPitch + render radius (pitch × 0.42)
 *                      kolize = distance < diameter (= reálný vizuální překryv)
 *                      varování = distance < pitch × 0.85 (sedadla "se dotýkají")
 *   visual           = stejné jako auto, jen explicitně
 *   number (např 18) = static tolerance — backward compat
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

function computeAvgPitch(seats) {
  // Pro každé sedadlo najdi nejbližšího souseda. Vrať medián těchto vzdáleností.
  // Robustnější než průměr (extreme outliers neovlivní).
  if (seats.length < 2) return 22; // default
  const distances = [];
  // Sample max 500 seats pro rychlost — medián je stabilní i z subsetu
  const sample = seats.length > 500 ? seats.filter((_, i) => i % Math.ceil(seats.length / 500) === 0) : seats;
  for (const s of sample) {
    let nearest = Infinity;
    for (const other of seats) {
      if (other === s) continue;
      const d = Math.hypot(s.x - other.x, s.y - other.y);
      if (d > 0 && d < nearest) nearest = d;
      if (nearest < 1) break; // duplicate, ignore in pitch calc
    }
    if (nearest < Infinity) distances.push(nearest);
  }
  distances.sort((a, b) => a - b);
  return distances[Math.floor(distances.length / 2)] ?? 22;
}

function main() {
  const [, , filePath, modeArg] = process.argv;
  if (!filePath) {
    console.error('Usage: node scripts/check-overlaps.mjs <layout.json> [auto|visual|number]');
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

  // Mode detection
  let tolerance;
  let warnTolerance;
  let mode = 'auto';
  if (!modeArg || modeArg === 'auto' || modeArg === 'visual') {
    const pitch = computeAvgPitch(seats);
    const radius = Math.max(2, Math.min(12, pitch * 0.42)); // matches SeatPicker.tsx:556
    tolerance = radius * 2 - 1; // collision = circles touch or overlap
    warnTolerance = pitch * 0.85; // sedadla "se dotýkají" — vizuálně blízko
    mode = `auto (pitch=${pitch.toFixed(2)}, radius=${radius.toFixed(2)})`;
  } else if (!Number.isNaN(Number(modeArg))) {
    tolerance = Number(modeArg);
    warnTolerance = tolerance;
    mode = `static (${tolerance})`;
  } else {
    console.error(`Unknown mode: ${modeArg}`);
    process.exit(2);
  }

  // Detekce kolizí — spatial bucket pro O(n) místo O(n²)
  const checkRadius = Math.max(tolerance, warnTolerance);
  const bucketSize = checkRadius * 2;
  const buckets = new Map();
  const overlaps = [];
  const warnings = [];

  for (const seat of seats) {
    if (!Number.isFinite(seat.x) || !Number.isFinite(seat.y)) {
      overlaps.push({ a: seat, b: null, reason: 'invalid coords' });
      continue;
    }
    const bx = Math.floor(seat.x / bucketSize);
    const by = Math.floor(seat.y / bucketSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${bx + dx},${by + dy}`;
        const neighbors = buckets.get(key);
        if (!neighbors) continue;
        for (const other of neighbors) {
          const dist = Math.hypot(seat.x - other.x, seat.y - other.y);
          if (dist < tolerance) {
            overlaps.push({ a: other, b: seat, distance: dist });
          } else if (dist < warnTolerance) {
            warnings.push({ a: other, b: seat, distance: dist });
          }
        }
      }
    }
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
  console.log(`Mode:      ${mode}`);
  console.log(`Collision: distance < ${tolerance.toFixed(2)} (circles overlap)`);
  if (warnTolerance !== tolerance) {
    console.log(`Warn:      distance < ${warnTolerance.toFixed(2)} (sedadla "se dotýkají")`);
  }
  console.log(`viewBox:   ${layout.viewBox ?? '(missing)'}`);
  console.log('');

  if (overlaps.length === 0 && warnings.length === 0) {
    console.log('✅  No overlaps detected.');
    process.exit(0);
  }
  if (overlaps.length === 0) {
    console.log(`⚠️   No hard overlaps, but ${warnings.length} pairs are visually tight (< ${warnTolerance.toFixed(2)}px).`);
    console.log('     Renderer kreslí kruhy které vizuálně vypadají dotýkat se — zvaž zvětšit seatPitch.');
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
