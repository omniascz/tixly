/**
 * Generuje CSV s 372 sedadly pro Městské divadlo Bílina.
 *
 * Layout (z PDF md-sezení.pdf):
 *   - Balkón (144 míst, 8 řad):
 *     - Řady 8-5 (zadní 4): rozdělené prostředním vchodem, levá strana
 *       seats 16→9, pravá strana seats 8→1 — 16 čísel/řadu
 *     - Řady 4-1 (přední 4): bez vchodu, seats 20→11 vlevo + 10→1 vpravo
 *       — 20 čísel/řadu
 *   - Přízemí (228 míst, 13 řad):
 *     - Horseshoe shape, nepravidelný počet sedadel/řadu
 *     - Řada 13: 15, Řada 12: 16, Řada 11: 15, Řada 10: 16
 *     - Řady 9-3: 19 každá
 *     - Řada 2: 17, Řada 1: 16
 *
 * Coordinates v viewBox 0 0 1200 900:
 *   - Balkón nahoře (y 80-380)
 *   - Přízemí dole (y 480-830)
 *   - Pódium úplně dole (y 870)
 *
 * Outputs: docs/bilina-seating.csv
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT = join(ROOT, 'docs', 'bilina-seating.csv');

const SEAT_W = 32; // šířka mezi sedadly
const ROW_H = 30; // výška mezi řadami
const CENTER_X = 600;
const MIDDLE_GAP = 50; // mezera v středu balkónu (vchod)

const rows = [];

function header() {
  rows.push('sector,row,num,x,y,accessibility');
}

function addRow(sector, row, seats) {
  // seats: array of { num, x, y, accessibility }
  for (const s of seats) {
    rows.push(
      `"${sector}","${row}","${s.num}",${s.x},${s.y},${s.accessibility ? 'true' : ''}`,
    );
  }
}

// ── BALKÓN ──────────────────────────────────────────────────────────────────

function balconyBackRow(rowNum, y) {
  // 16 sedadel, číslování 16→9 vlevo, 8→1 vpravo, mezera uprostřed
  const seats = [];
  // Levá strana: seats 16,15,14,13,12,11,10,9 — leftmost first
  // X positions zleva doprava: 16 je nejvíc vlevo, 9 nejvíc vpravo (pak gap)
  const leftStartX = CENTER_X - MIDDLE_GAP / 2 - 8 * SEAT_W;
  for (let i = 0; i < 8; i++) {
    seats.push({
      num: String(16 - i),
      x: leftStartX + i * SEAT_W,
      y,
    });
  }
  // Pravá strana: seats 8,7,6,5,4,3,2,1 — leftmost first
  const rightStartX = CENTER_X + MIDDLE_GAP / 2;
  for (let i = 0; i < 8; i++) {
    seats.push({
      num: String(8 - i),
      x: rightStartX + i * SEAT_W,
      y,
    });
  }
  addRow('Balkón', String(rowNum), seats);
}

function balconyFrontRow(rowNum, y) {
  // 20 sedadel, číslování 20→11 vlevo, 10→1 vpravo, BEZ mezery
  const seats = [];
  const startX = CENTER_X - 10 * SEAT_W;
  // Vlevo: 20,19,18,17,16,15,14,13,12,11 — leftmost first
  for (let i = 0; i < 10; i++) {
    seats.push({
      num: String(20 - i),
      x: startX + i * SEAT_W,
      y,
    });
  }
  // Vpravo: 10,9,8,7,6,5,4,3,2,1 — leftmost first
  for (let i = 0; i < 10; i++) {
    seats.push({
      num: String(10 - i),
      x: startX + (10 + i) * SEAT_W,
      y,
    });
  }
  addRow('Balkón', String(rowNum), seats);
}

// ── PŘÍZEMÍ ─────────────────────────────────────────────────────────────────

function groundRow(rowNum, y, seatCount, accessibilityRows = []) {
  // Sedadla jsou číslována od pravé strany doleva (číslo 1 vpravo, n vlevo)
  // X positions: row je centered horizontálně okolo CENTER_X
  // seat 1 vpravo, seat n vlevo → leftmost má nejvyšší číslo
  const seats = [];
  const startX = CENTER_X - (seatCount * SEAT_W) / 2 + SEAT_W / 2;
  for (let i = 0; i < seatCount; i++) {
    const num = seatCount - i; // leftmost = highest number
    seats.push({
      num: String(num),
      x: startX + i * SEAT_W,
      y,
      accessibility: accessibilityRows.includes(num),
    });
  }
  addRow('Přízemí', String(rowNum), seats);
}

// ── Build CSV ───────────────────────────────────────────────────────────────
//
// NOVÝ LAYOUT (po user feedbacku): pódium NAHOŘE.
// Logika divadelního číslování: řada 1 = nejblíž pódiu = nahoře (malé y).
// Vyšší číslo řady = dál od pódia = níž (velké y).
//
// Vertikální stack shora dolů:
//   y 30:     stage label „Pódium"
//   y 80-416: Přízemí (řady 1-13, 28 unit per row)
//   y 500-720: Balkón (řady 1-8, 32 unit per row)
//
// Číslování v řadě zůstává: 1 vpravo → n vlevo (standardní divadelní logika
// pohled ze sedadla na pódium).

header();

// PŘÍZEMÍ — řady shora dolů: 1 nejblíž pódiu (y=80), 13 nejdál (y=416)

// Layout per řadu (počty sedadel z PDF):
const groundRows = [
  { r: 1, seats: 16 },
  { r: 2, seats: 17 },
  { r: 3, seats: 19 },
  { r: 4, seats: 19 },
  { r: 5, seats: 19 },
  { r: 6, seats: 19 },
  { r: 7, seats: 19 },
  { r: 8, seats: 19 },
  { r: 9, seats: 19 },
  { r: 10, seats: 16 },
  { r: 11, seats: 15 },
  { r: 12, seats: 16 },
  { r: 13, seats: 15 },
];

const GROUND_START_Y = 80;
const GROUND_ROW_H = 28;
groundRows.forEach((row, idx) => {
  const y = GROUND_START_Y + idx * GROUND_ROW_H;
  groundRow(row.r, y, row.seats);
});

// BALKÓN — pod přízemím. Řady 1 nejblíž pódiu (= nahoře v balkónu, y=500),
// řada 8 nejdál (y=500+7×ROW_H=710).

const BALCONY_START_Y = 500;
const BALCONY_ROW_H = ROW_H; // 30

// Řady 1-4 (20 sedadel bez mezery) — blíž pódiu (nahoře v balkón sekci)
for (let r = 1; r <= 4; r++) {
  const y = BALCONY_START_Y + (r - 1) * BALCONY_ROW_H;
  balconyFrontRow(r, y);
}

// Řady 5-8 (16 sedadel s prostředním vchodem) — dál od pódia (níž)
for (let r = 5; r <= 8; r++) {
  const y = BALCONY_START_Y + (r - 1) * BALCONY_ROW_H;
  balconyBackRow(r, y);
}

// Oddělím sekce vizuálně — old positions byly:
// PŘÍZEMÍ původně Y 500-860 (řady 13→1 shora dolů)
// BALKÓN původně Y 80-290 (řady 8→1 shora dolů)
// stage='bottom'
//
// Teď stage='top':
// Stage y 30
// PŘÍZEMÍ Y 80-416 (řady 1→13 shora dolů)
// BALKÓN Y 500-710 (řady 1→8 shora dolů)
// Mezera mezi sekcemi je 80 unit (vchod / patro)

// Write CSV
writeFileSync(OUTPUT, rows.join('\n') + '\n', 'utf8');
console.log(`✓ Generated ${OUTPUT}`);
console.log(`  Total seats: ${rows.length - 1}`);
console.log(`  Expected: 372 (228 přízemí + 144 balkón)`);
console.log(`  Layout: pódium NAHOŘE (stage='top')`);
console.log(`           ↓ pod ním přízemí (řady 1-13)`);
console.log(`           ↓ pod ním balkón (řady 1-8)`);
