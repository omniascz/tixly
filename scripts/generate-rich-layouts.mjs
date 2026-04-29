// Generuje 3 seating layouty (Velky sal 1500, Arena 17000, Stadion 50000)
// Format: stejny jako existujici Stara Strelnice — { viewBox, stage, sectors:[{ name, rows:[{ label, seats:[{ num, x, y }] }] }] }
// Output: 3 JSON soubory + 1 SQL skript pro INSERT do catalog.venue_seating_charts

import { writeFileSync, mkdirSync } from 'node:fs';

const OUT_DIR = './scripts/layouts';
mkdirSync(OUT_DIR, { recursive: true });

// ----- helpers -----
function row(label, count, startNum, x0, y, dx) {
  const seats = [];
  for (let i = 0; i < count; i++) {
    seats.push({ num: String(startNum - i), x: x0 + i * dx, y });
  }
  return { label, seats };
}

// ----- 1) Velky koncertni sal (1500) -----
function buildVelkySal() {
  const sectors = [];
  // Parter (25 rad x 28 mist = 700)
  const parterRows = [];
  for (let r = 0; r < 25; r++) {
    parterRows.push(row(String(r + 1), 28, 28, 200, 250 + r * 24, 36));
  }
  sectors.push({ name: 'PARTER', rows: parterRows });
  // Balkon Stredni (12 rad x 25 = 300)
  const balkonStr = [];
  for (let r = 0; r < 12; r++) {
    balkonStr.push(row(`B-${r + 1}`, 25, 25, 240, 880 + r * 24, 40));
  }
  sectors.push({ name: 'BALKON STREDNI', rows: balkonStr });
  // Balkon Levy (10 rad x 20 = 200)
  const balkonLevy = [];
  for (let r = 0; r < 10; r++) {
    balkonLevy.push(row(`L-${r + 1}`, 20, 20, 60, 320 + r * 26, 30));
  }
  sectors.push({ name: 'BALKON LEVY', rows: balkonLevy });
  // Balkon Pravy (10 x 20 = 200)
  const balkonPravy = [];
  for (let r = 0; r < 10; r++) {
    balkonPravy.push(row(`P-${r + 1}`, 20, 20, 1280, 320 + r * 26, 30));
  }
  sectors.push({ name: 'BALKON PRAVY', rows: balkonPravy });
  // Loze (20 lozi x 5 mist = 100)
  const loze = [];
  for (let r = 0; r < 20; r++) {
    loze.push(row(`L${r + 1}`, 5, 5, 60 + (r % 10) * 130, 80 + Math.floor(r / 10) * 50, 22));
  }
  sectors.push({ name: 'LOZE', rows: loze });
  return {
    viewBox: '0 0 1600 1200',
    stage: { label: 'JEVISTE', position: 'top' },
    sectors,
  };
}

// ----- 2) Arena Praha (17000) — multifunkcni -----
function buildArena() {
  const sectors = [];
  // Parter (60 rad x 50 = 3000) — pro koncert config (parter ne ledova plocha)
  const parter = [];
  for (let r = 0; r < 60; r++) {
    parter.push(row(`PA-${r + 1}`, 50, 50, 600, 1200 + r * 14, 32));
  }
  sectors.push({ name: 'PARTER', rows: parter });
  // Lower bowl 100s (24 sektoru x ~250 = 6000, kazdy sektor 12 rad x 21 mist)
  for (let s = 1; s <= 24; s++) {
    const sectorRows = [];
    const angle = ((s - 1) / 24) * Math.PI * 2;
    const cx = 1500 + Math.cos(angle) * 1100;
    const cy = 1200 + Math.sin(angle) * 800;
    for (let r = 0; r < 12; r++) {
      const seats = [];
      for (let i = 0; i < 21; i++) {
        seats.push({ num: String(21 - i), x: Math.round(cx + (i - 10) * 20 + r * Math.cos(angle) * 8), y: Math.round(cy + r * 18) });
      }
      sectorRows.push({ label: `R${r + 1}`, seats });
    }
    sectors.push({ name: `LB-${100 + s}`, rows: sectorRows });
  }
  // Upper bowl 200s (24 sektoru x ~290 = 6960, 15 rad x 19)
  for (let s = 1; s <= 24; s++) {
    const sectorRows = [];
    const angle = ((s - 1) / 24) * Math.PI * 2;
    const cx = 1500 + Math.cos(angle) * 1500;
    const cy = 1200 + Math.sin(angle) * 1100;
    for (let r = 0; r < 15; r++) {
      const seats = [];
      for (let i = 0; i < 19; i++) {
        seats.push({ num: String(19 - i), x: Math.round(cx + (i - 9) * 22 + r * Math.cos(angle) * 9), y: Math.round(cy + r * 18) });
      }
      sectorRows.push({ label: `R${r + 1}`, seats });
    }
    sectors.push({ name: `UB-${200 + s}`, rows: sectorRows });
  }
  // VIP Boxes (80 boxu x 12 mist = 960, sklada se z 6 rad x 2 mist v jedne lozi)
  for (let b = 1; b <= 80; b++) {
    const boxRows = [];
    const angle = ((b - 1) / 80) * Math.PI * 2;
    const cx = 1500 + Math.cos(angle) * 1300;
    const cy = 1200 + Math.sin(angle) * 950;
    for (let r = 0; r < 6; r++) {
      boxRows.push({
        label: `${r + 1}`,
        seats: [
          { num: '1', x: Math.round(cx - 8), y: Math.round(cy + r * 14) },
          { num: '2', x: Math.round(cx + 8), y: Math.round(cy + r * 14) },
        ],
      });
    }
    sectors.push({ name: `BOX-${b}`, rows: boxRows });
  }
  return {
    viewBox: '0 0 3000 2400',
    stage: { label: 'STAGE', position: 'top' },
    sectors,
  };
}

// ----- 3) Stadion FC Praha (50000) — 4 tribuny -----
function buildStadium() {
  const sectors = [];
  const tribuny = [
    { name: 'SEVER',  baseX: 1000, baseY: 100,  vipMark: false, hostFans: true },
    { name: 'JIH',    baseX: 1000, baseY: 2200, vipMark: false, hostFans: false },
    { name: 'VYCHOD', baseX: 2300, baseY: 600,  vipMark: true,  hostFans: false }, // hlavni VIP tribuna
    { name: 'ZAPAD',  baseX: 100,  baseY: 600,  vipMark: false, hostFans: false },
  ];
  for (const t of tribuny) {
    // Kazda tribuna: 50 rad x 250 mist = 12500
    const horizontalRows = t.name === 'SEVER' || t.name === 'JIH';
    for (let r = 0; r < 50; r++) {
      const seats = [];
      for (let i = 0; i < 250; i++) {
        const x = horizontalRows ? t.baseX + i * 4 : t.baseX + r * 12;
        const y = horizontalRows ? t.baseY + r * 12 : t.baseY + i * 4;
        seats.push({ num: String(250 - i), x, y });
      }
      sectors.push({ name: `${t.name}-${r + 1}`, rows: [{ label: String(r + 1), seats }] });
    }
  }
  return {
    viewBox: '0 0 4000 3000',
    stage: { label: 'HRACI PLOCHA', position: 'center' },
    sectors,
  };
}

// ----- vyrob a uloz -----
const layouts = {
  'velky-sal': buildVelkySal(),
  'arena': buildArena(),
  'stadion': buildStadium(),
};

let report = '';
for (const [name, layout] of Object.entries(layouts)) {
  const totalSeats = layout.sectors.reduce(
    (sum, s) => sum + s.rows.reduce((a, r) => a + r.seats.length, 0),
    0,
  );
  writeFileSync(`${OUT_DIR}/${name}.json`, JSON.stringify(layout));
  report += `${name}: ${layout.sectors.length} sektorů, ${totalSeats} sedadel\n`;
}
console.log(report);

// ----- vygeneruj SQL inserty -----
// (psql jsonb literal escapes single quotes by doubling them)
function jsonbLit(obj) {
  return JSON.stringify(obj).replace(/'/g, "''");
}

const sql = `
BEGIN;
INSERT INTO catalog.venue_seating_charts (id, venue_id, name, layout, total_seats, active, source, notes)
VALUES
  ('00000000-0000-4000-a000-000000000301', '00000000-0000-4000-a000-000000000201', 'Velky koncertni sal — full layout',
    pg_read_file('/tmp/layouts/velky-sal.json')::jsonb,
    ${layouts['velky-sal'].sectors.reduce((sum, s) => sum + s.rows.reduce((a, r) => a + r.seats.length, 0), 0)},
    true, 'seed', 'Generated by seed-rich-demo phase 2'),
  ('00000000-0000-4000-a000-000000000302', '00000000-0000-4000-a000-000000000203', 'Arena Praha — koncert config',
    pg_read_file('/tmp/layouts/arena.json')::jsonb,
    ${layouts['arena'].sectors.reduce((sum, s) => sum + s.rows.reduce((a, r) => a + r.seats.length, 0), 0)},
    true, 'seed', 'Generated by seed-rich-demo phase 2'),
  ('00000000-0000-4000-a000-000000000303', '00000000-0000-4000-a000-000000000204', 'Stadion FC Praha — 4 tribuny',
    pg_read_file('/tmp/layouts/stadion.json')::jsonb,
    ${layouts['stadion'].sectors.reduce((sum, s) => sum + s.rows.reduce((a, r) => a + r.seats.length, 0), 0)},
    true, 'seed', 'Generated by seed-rich-demo phase 2')
ON CONFLICT (id) DO NOTHING;
COMMIT;

SELECT v.name, vsc.name as chart_name, vsc.total_seats, jsonb_array_length(vsc.layout->'sectors') as sektoru
FROM catalog.venue_seating_charts vsc
JOIN catalog.venues v ON v.id = vsc.venue_id
WHERE vsc.id IN (
  '00000000-0000-4000-a000-000000000301',
  '00000000-0000-4000-a000-000000000302',
  '00000000-0000-4000-a000-000000000303'
)
ORDER BY vsc.total_seats;
`;
writeFileSync('./scripts/seed-rich-demo-phase2.sql', sql);
console.log('SQL written to scripts/seed-rich-demo-phase2.sql');
