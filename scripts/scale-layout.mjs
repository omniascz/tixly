#!/usr/bin/env node
/**
 * scale-layout.mjs — vynásobí všechny x,y v layoutu konstantou.
 *
 * Použití:
 *   node scripts/scale-layout.mjs <input.json> <output.json> <factor>
 *
 * Příklad — zvětšit pitch 2×:
 *   node scripts/scale-layout.mjs scripts/layouts/stadion-12k.json \
 *        scripts/layouts/stadion-12k-x2.json 2
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath, factorArg] = process.argv;
if (!inPath || !outPath || !factorArg) {
  console.error('Usage: node scripts/scale-layout.mjs <input.json> <output.json> <factor>');
  process.exit(2);
}
const factor = Number(factorArg);
if (!Number.isFinite(factor) || factor <= 0) {
  console.error(`Invalid factor: ${factorArg}`);
  process.exit(2);
}

const layout = JSON.parse(readFileSync(inPath, 'utf8'));

// Scale viewBox
if (typeof layout.viewBox === 'string') {
  const parts = layout.viewBox.split(/\s+/).map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
    layout.viewBox = parts.map((n) => n * factor).join(' ');
  }
}

// Scale stage / field
for (const k of ['stage', 'field']) {
  if (layout[k] && typeof layout[k] === 'object') {
    for (const prop of ['x', 'y', 'width', 'height']) {
      if (typeof layout[k][prop] === 'number') {
        layout[k][prop] *= factor;
      }
    }
  }
}

// Scale every seat
let count = 0;
for (const sector of layout.sectors ?? []) {
  for (const row of sector.rows ?? []) {
    for (const seat of row.seats ?? []) {
      if (typeof seat.x === 'number') seat.x *= factor;
      if (typeof seat.y === 'number') seat.y *= factor;
      count++;
    }
  }
}

writeFileSync(outPath, JSON.stringify(layout, null, 2), 'utf8');
console.log(`Scaled ${count} seats by ${factor}×`);
console.log(`viewBox: ${layout.viewBox}`);
console.log(`Wrote → ${outPath}`);
