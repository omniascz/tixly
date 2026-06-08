/**
 * Generátor seating chartu — Docela velké divadlo Litvínov (velký sál).
 * Předloha: skutečný SMSticket seat-map screenshot (uživatel 2026-06-08).
 *   PODIUM (nahoře) · PŘÍZEMÍ 18 řad = 282 · BALKON 7 řad 2 bloky = 119 · celkem 401.
 *
 * Výstup: db/dvd-litvinov-layout.json (Tixly venue_seating_charts.layout formát)
 *         + state/dvd-litvinov-preview.html (vizuální náhled k porovnání se screenshotem).
 */
import { writeFileSync } from 'node:fs';

// ── Per-řada počty (čteno ze screenshotu; ladí se podle náhledu) ───────────────
// PŘÍZEMÍ (z mapy): řady 1–15 = 16 sedadel, řady 16–18 = 14 sedadel. Σ = 15×16+3×14 = 282.
const PARTER = [16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 14, 14, 14];
// BALKON (z mapy): [levý blok, pravý blok] per řada. Ulička průběžná uprostřed.
// Řady 1–6: 9+9=18 (mezera mezi 9 a 10). Řada 7: 4+7=11 (mezera mezi 4 a 5). Σ = 6×18+11 = 119.
const BALKON = [[9, 9], [9, 9], [9, 9], [9, 9], [9, 9], [9, 9], [4, 7]];

// Viewer (VenueLayoutPreview) kreslí sedadlo s poloměrem 14 (průměr 28).
// Rozteč MUSÍ být > 28, jinak se kroužky překrývají. 36 = 8px mezera.
const SEAT_DX = 36; // rozteč sedadel
const SEAT_DY = 36; // rozteč řad
const AISLE = 54; // středová ulička balkonu

function rowSeats(count, x0, y, startNum = 1) {
  return Array.from({ length: count }, (_, i) => ({
    x: x0 + i * SEAT_DX,
    y,
    num: String(startNum + i),
  }));
}

const CENTER = 600; // střed sálu (parter i balkon centrované, symetrické)

// PŘÍZEMÍ — centrované řady (jednotná šířka → rovný levý i pravý okraj; užší řady symetricky).
const parterRows = PARTER.map((n, r) => {
  const y = 120 + r * SEAT_DY;
  const x0 = CENTER - ((n - 1) * SEAT_DX) / 2;
  return { label: String(r + 1), seats: rowSeats(n, x0, y) };
});

// BALKON — dva bloky centrované kolem středové uličky.
const balkonY0 = 120 + PARTER.length * SEAT_DY + 80;
const balkonRows = BALKON.map(([left, right], r) => {
  const y = balkonY0 + r * SEAT_DY;
  const leftX0 = CENTER - AISLE / 2 - (left - 1) * SEAT_DX; // levý blok zarovnán zprava k uličce
  const rightX0 = CENTER + AISLE / 2; // pravý blok zarovnán zleva k uličce
  return {
    label: String(r + 1),
    seats: [...rowSeats(left, leftX0, y, 1), ...rowSeats(right, rightX0, y, left + 1)],
  };
});

const parterTotal = PARTER.reduce((a, b) => a + b, 0);
const balkonTotal = BALKON.reduce((a, [l, r]) => a + l + r, 0);

// viewBox z bounding boxu všech sedadel (+ místo na podium nahoře a padding)
const allSeats = [...parterRows, ...balkonRows].flatMap((r) => r.seats);
const minX = Math.min(...allSeats.map((s) => s.x)) - 60;
const maxX = Math.max(...allSeats.map((s) => s.x)) + 60;
const minY = 40; // nad podiem
const maxY = Math.max(...allSeats.map((s) => s.y)) + 60;
const viewBox = `${Math.round(minX)} ${minY} ${Math.round(maxX - minX)} ${Math.round(maxY - minY)}`;

const layout = {
  viewBox,
  stage: { label: 'PODIUM', position: 'top' },
  sectors: [
    { name: 'PŘÍZEMÍ', color: '#d83a2e', rows: parterRows },
    { name: 'BALKON', color: '#e8821e', rows: balkonRows },
  ],
};

writeFileSync(new URL('../db/dvd-litvinov-layout.json', import.meta.url), JSON.stringify(layout));

// ── Náhled HTML (barvy jako screenshot: parter červený, balkon oranžový) ───────
const seatSvg = (s, color) =>
  `<circle cx="${s.x}" cy="${s.y}" r="7" fill="none" stroke="${color}" stroke-width="2"/><circle cx="${s.x}" cy="${s.y}" r="2.5" fill="${color}"/>`;
const parterSvg = parterRows.flatMap((row) => row.seats.map((s) => seatSvg(s, '#d83a2e'))).join('');
const balkonSvg = balkonRows.flatMap((row) => row.seats.map((s) => seatSvg(s, '#e8821e'))).join('');
const rowLabels = (rows, side) =>
  rows
    .map((row) => {
      const xs = row.seats.map((s) => s.x);
      const x = side === 'L' ? Math.min(...xs) - 22 : Math.max(...xs) + 14;
      return `<text x="${x}" y="${row.seats[0].y + 4}" font-size="11" fill="#555">${row.label}</text>`;
    })
    .join('');

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;background:#f3f3f3;font-family:Arial}</style></head><body>
<svg width="1100" height="${balkonY0 + 8 * SEAT_DY}" xmlns="http://www.w3.org/2000/svg">
  <rect x="430" y="40" width="340" height="44" rx="8" fill="#d9d9d9"/><text x="600" y="68" text-anchor="middle" font-size="15" fill="#333">PODIUM</text>
  ${parterSvg}${rowLabels(parterRows, 'L')}${rowLabels(parterRows, 'R')}
  <text x="600" y="${120 + PARTER.length * SEAT_DY + 18}" text-anchor="middle" font-size="14" fill="#333">PŘÍZEMÍ (${parterTotal})</text>
  ${balkonSvg}${rowLabels(balkonRows, 'L')}${rowLabels(balkonRows, 'R')}
  <text x="600" y="${balkonY0 + 7 * SEAT_DY + 14}" text-anchor="middle" font-size="14" fill="#333">BALKON (${balkonTotal})</text>
</svg></body></html>`;
writeFileSync(new URL('../state/dvd-litvinov-preview.html', import.meta.url), html);

console.log(`PŘÍZEMÍ=${parterTotal} BALKON=${balkonTotal} CELKEM=${parterTotal + balkonTotal}`);
console.log('layout → db/dvd-litvinov-layout.json, náhled → state/dvd-litvinov-preview.html');
