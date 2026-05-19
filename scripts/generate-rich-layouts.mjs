// Generuje 3 realistické seating layouty:
//   - Velky koncertni sal (1500)  — Rudolfinum-style amfiteátr s lóžemi
//   - Arena Praha (16 848)        — O2 Arena-style s pódiem nahoře, parter, LB, UB, skyboxy
//   - Stadion FC Praha (50 000)   — Letná-style fotbalový stadion: 4 tribuny + 4 rohy
//
// Format: { viewBox, stage, field?, sectors:[{ name, rows:[{ label, seats:[{ num, x, y }] }] }] }
// Output: 3 JSON soubory + 1 SQL skript pro INSERT do catalog.venue_seating_charts.
//
// Klíčové principy proti předchozímu generátoru (audit 2026-04-30):
//   1. Sektor = blok rozumné hloubky × šířky, ne 1-řadový proužek.
//   2. Geometrie odráží reálný půdorys — tribuny ZNATELNĚ větší než pole.
//   3. Žádné cos/sin po každém sedadle (kruhový shluk z předchozí arény).
//   4. Stage / field je explicitně součást layoutu, ne implicit z position.
//   5. Lóže = samostatné sektory (LL01..LL06), ne řady jednoho sektoru.

import { writeFileSync, mkdirSync } from 'node:fs';

const OUT_DIR = './scripts/layouts';
mkdirSync(OUT_DIR, { recursive: true });

// ─── helpers ────────────────────────────────────────────────────────────────

// Vyrobí jeden řádek v pravoúhlém sektoru — sedadla po pravidelném pitchi
// ve směru určeném `axis` ('x' nebo 'y').
function rowAlongAxis(label, count, x0, y0, pitch, axis = 'x', reversed = false) {
  const seats = [];
  for (let i = 0; i < count; i++) {
    const offset = i * pitch;
    const num = String(reversed ? count - i : i + 1);
    if (axis === 'x') seats.push({ num, x: x0 + offset, y: y0 });
    else seats.push({ num, x: x0, y: y0 + offset });
  }
  return { label, seats };
}

// Vyrobí pravoúhlý sektor s `rows` řadami v dané `orientation`.
// orientation říká: kterým směrem jdou řady (od stage k zadní řadě).
//   'top':    řada A je dole (blízko poli), Y roste směrem nahoru
//   'bottom': řada A je nahoře (blízko poli), Y roste směrem dolů
//   'left':   řada A je vpravo (blízko poli), X roste směrem doleva
//   'right':  řada A je vlevo (blízko poli), X roste směrem doprava
function buildRectSector(name, originX, originY, rows, seatsPerRow, seatPitch, rowPitch, orientation) {
  const sectorRows = [];
  for (let r = 0; r < rows; r++) {
    const rowLabel = String.fromCharCode('A'.charCodeAt(0) + r);
    let rowX = originX, rowY = originY;
    let axis = 'x';
    let reversed = false;
    switch (orientation) {
      case 'top':
        rowY = originY - r * rowPitch;
        axis = 'x';
        break;
      case 'bottom':
        rowY = originY + r * rowPitch;
        axis = 'x';
        break;
      case 'left':
        rowX = originX - r * rowPitch;
        axis = 'y';
        break;
      case 'right':
        rowX = originX + r * rowPitch;
        axis = 'y';
        break;
    }
    sectorRows.push(rowAlongAxis(rowLabel, seatsPerRow, rowX, rowY, seatPitch, axis, reversed));
  }
  return { name, rows: sectorRows };
}

// autoFitViewBox — spočítá viewBox z bbox všech sedadel + případně field.
function autoFitViewBox(layout, margin = 80) {
  const xs = [];
  const ys = [];
  for (const sec of layout.sectors)
    for (const row of sec.rows)
      for (const s of row.seats) { xs.push(s.x); ys.push(s.y); }
  if (layout.field) {
    xs.push(layout.field.x, layout.field.x + layout.field.width);
    ys.push(layout.field.y, layout.field.y + layout.field.height);
  }
  const minX = Math.floor(Math.min(...xs) - margin);
  const minY = Math.floor(Math.min(...ys) - margin);
  const w = Math.ceil(Math.max(...xs) - Math.min(...xs) + 2 * margin);
  const h = Math.ceil(Math.max(...ys) - Math.min(...ys) + 2 * margin);
  return `${minX} ${minY} ${w} ${h}`;
}

function totalSeats(layout) {
  return layout.sectors.reduce(
    (sum, s) => sum + s.rows.reduce((a, r) => a + r.seats.length, 0),
    0,
  );
}

// ─── 1) Velký koncertní sál (1500) — Rudolfinum amfiteátr ───────────────────
// Layout (top-down, stage nahoře):
//                              JEVIŠTĚ
//                  ┌────────────────────────────┐
//   LL01 LL02 LL03 │     PARTER (lichoběžník)  │ LP01 LP02 LP03
//   LL04 LL05 LL06 │     22 řad, 24-32 míst    │ LP04 LP05 LP06
//                  └────────────────────────────┘
//                  ┌────────────────────────────┐
//                  │    BALKON I (15 řad × 30)  │
//                  └────────────────────────────┘
//                  ┌────────────────────────────┐
//                  │    BALKON II (10 řad × 30) │
//                  └────────────────────────────┘
function buildVelkySal() {
  const sectors = [];
  const STAGE_W = 700, STAGE_H = 80;
  const STAGE_X = 400, STAGE_Y = 80;

  // PARTER: lichoběžník, řada 1 vepředu (24 míst), řada 22 vzadu (32 míst).
  // Posun X tak aby parter zůstal centrovaný kolem stage.
  const parterRows = [];
  const PARTER_Y0 = STAGE_Y + STAGE_H + 60;
  const PARTER_PITCH = 22; // px mezi řadami
  for (let r = 0; r < 22; r++) {
    const seatsInRow = 24 + Math.floor(r * 8 / 21); // 24..32 lineárně
    const rowWidth = (seatsInRow - 1) * 24;
    const x0 = STAGE_X + STAGE_W / 2 - rowWidth / 2;
    const y = PARTER_Y0 + r * PARTER_PITCH;
    const seats = [];
    for (let i = 0; i < seatsInRow; i++) {
      seats.push({ num: String(i + 1), x: Math.round(x0 + i * 24), y });
    }
    parterRows.push({ label: String(r + 1), seats });
  }
  sectors.push({ name: 'PARTER', rows: parterRows });

  // 6 lóží levých (LL-1..LL-6) + 6 pravých (LP-1..LP-6) — vedle parteru
  // Každá lóže = 1 sektor, 2 řady × 4 sedadla = 8 míst (drobná lóže)
  const LOZE_LEFT_X = 100;
  const LOZE_RIGHT_X = STAGE_X + STAGE_W + 80;
  for (let i = 0; i < 6; i++) {
    const yBase = PARTER_Y0 + i * 80;
    sectors.push(buildRectSector(`LL-${i + 1}`, LOZE_LEFT_X, yBase, 2, 4, 22, 24, 'bottom'));
    sectors.push(buildRectSector(`LP-${i + 1}`, LOZE_RIGHT_X, yBase, 2, 4, 22, 24, 'bottom'));
  }

  // BALKON I — středový, polokruhový dojem dosáhneme tím, že krajní řady
  // mají méně sedadel (užší). 15 řad, 30..40 míst.
  const balkonRows = [];
  const BALKON1_Y0 = PARTER_Y0 + 22 * PARTER_PITCH + 90;
  const BALKON1_PITCH = 22;
  for (let r = 0; r < 15; r++) {
    const seatsInRow = 30 + Math.floor(r * 6 / 14); // 30..36
    const rowWidth = (seatsInRow - 1) * 26;
    const x0 = STAGE_X + STAGE_W / 2 - rowWidth / 2;
    const y = BALKON1_Y0 + r * BALKON1_PITCH;
    const seats = [];
    for (let i = 0; i < seatsInRow; i++) {
      seats.push({ num: String(i + 1), x: Math.round(x0 + i * 26), y });
    }
    balkonRows.push({ label: `B1-${r + 1}`, seats });
  }
  sectors.push({ name: 'BALKON I', rows: balkonRows });

  // BALKON II — nejvyšší, 10 řad × 28-32 míst
  const balkon2Rows = [];
  const BALKON2_Y0 = BALKON1_Y0 + 15 * BALKON1_PITCH + 80;
  for (let r = 0; r < 10; r++) {
    const seatsInRow = 28 + Math.floor(r * 4 / 9);
    const rowWidth = (seatsInRow - 1) * 26;
    const x0 = STAGE_X + STAGE_W / 2 - rowWidth / 2;
    const y = BALKON2_Y0 + r * 22;
    const seats = [];
    for (let i = 0; i < seatsInRow; i++) {
      seats.push({ num: String(i + 1), x: Math.round(x0 + i * 26), y });
    }
    balkon2Rows.push({ label: `B2-${r + 1}`, seats });
  }
  sectors.push({ name: 'BALKON II', rows: balkon2Rows });

  return {
    viewBox: '0 0 1600 1500', // přepíše autoFit
    stage: { label: 'JEVIŠTĚ', position: 'top' },
    stageBox: { x: STAGE_X, y: STAGE_Y, width: STAGE_W, height: STAGE_H },
    sectors,
  };
}

// ─── 2) O2 Aréna Praha (16 848) — multifunkční hala, koncert config ────────
// Layout (top-down, pódium nahoře):
//                        ╔═══ PÓDIUM ═══╗
//                        ║              ║
//   ┌─────────────────── PARTER ──────────────────┐
//   │  GA / VIP standing nebo sedadla (3000)      │
//   └────────────────────────────────────────────┘
//
//   Lower Bowl (LB-101..LB-124) — oblouk kolem parteru, 24 sektorů
//   Upper Bowl (UB-201..UB-224) — širší oblouk za LB, 24 sektorů
//   Skybox (BOX-1..BOX-24)      — lóže mezi LB a UB (24 ks po 12 míst)
// ─── 2) Arena Praha (O2 Arena-style, ~14 000 míst) ──────────────────────────
//
// REWRITE v2 2026-05-19: třetí ring (TL) + větší LB/UB sektory. Cíl 14k.
// Layout: STAGE / PARTER 60×40 / LB (8 boční 12×16 + 8 zadní 16×16) /
//         UB (10 boční 14×14 + 8 zadní 18×18) / TL (10 boční 12×12 + 8 zadní 14×16) /
//         24 skyboxů. Pitch 22 uniform. ≈ 14 056 míst.
//
// REWRITE v1 2026-05-19: původní layout měl 4 895 hard kolizí (audit s
// scripts/check-overlaps.mjs) protože "přední LB/UB" sektory intersect
// spatially s "boční UB/LB". Nový layout odstraňuje přední sektory úplně —
// čistá podkova bez křížení.
//
// Layout (top-down):
//   STAGE (rect, top)
//   PARTER (50 rows × 40 seats = 2 000)            — přímo pod stage
//   ─── ring 1: LB (Lower Bowl) ──────────────────  — okolo parteru
//     LB-105..LB-108 vlevo (4 sektory stacked Y)   — pitch 22, 11 řad × 12 seats
//     LB-117..LB-120 vpravo (4 sektory stacked Y)
//     LB-109..LB-114 zadní (6 sektorů side-by-side X) — 10 řad × 16 seats
//   ─── ring 2: UB (Upper Bowl) ──────────────────  — za LB
//     UB-205..UB-209 vlevo (5 sektorů Y)           — 13 řad × 10 seats
//     UB-216..UB-220 vpravo (5 sektorů Y)
//     UB-210..UB-215 zadní (6 sektorů X)           — 12 řad × 16 seats
//   SKYBOXES (12) — mezi LB a UB, malé VIP boxy
//
// Žádné cos/sin per sedadlo. Všechno axis-aligned, žádné překryvy.
function buildArena() {
  const sectors = [];
  const PITCH = 22, ROW_PITCH = 22;
  const STAGE_X = 1100, STAGE_Y = 100, STAGE_W = 800, STAGE_H = 100;

  // ── Parter (60 × 40 = 2 400) ──
  const PARTER_X0 = 1060;
  const PARTER_Y0 = 250;
  const PARTER_W = 40 * PITCH; // 880
  const PARTER_H = 60 * ROW_PITCH; // 1 320
  const PARTER_X_END = PARTER_X0 + PARTER_W; // 1 940
  const PARTER_Y_END = PARTER_Y0 + PARTER_H; // 1 570
  {
    const rows = [];
    for (let r = 0; r < 60; r++) {
      const seats = [];
      const y = PARTER_Y0 + r * ROW_PITCH;
      for (let i = 0; i < 40; i++) {
        seats.push({ num: String(i + 1), x: PARTER_X0 + i * PITCH, y });
      }
      rows.push({ label: `PA-${r + 1}`, seats });
    }
    sectors.push({ name: 'PARTER', rows });
  }

  // ── LB (Lower Bowl) — 8 boční + 8 zadní = 3 584 ──
  // Boční 16 rows × 12 seats = 192 each. Orientation 'left': rows go horizontal,
  // seats vertical → extent 352 W (16×22) × 264 H (12×22). Spacing 275.
  // 4 × 275 = 1 100, fits parter 1 320 ✓
  const LB_GAP = 40;
  const LB_SECTOR_W = 16 * ROW_PITCH; // 352
  const LB_VERT_SPACING = 275;
  for (let s = 0; s < 4; s++) {
    const yBase = PARTER_Y0 + s * LB_VERT_SPACING;
    sectors.push(buildRectSector(`LB-${105 + s}`, PARTER_X0 - LB_GAP, yBase, 16, 12, PITCH, ROW_PITCH, 'left'));
    sectors.push(buildRectSector(`LB-${120 - s}`, PARTER_X_END + LB_GAP, yBase, 16, 12, PITCH, ROW_PITCH, 'right'));
  }
  const LB_LEFT_X_END = PARTER_X0 - LB_GAP - LB_SECTOR_W; // 668
  const LB_RIGHT_X_END = PARTER_X_END + LB_GAP + LB_SECTOR_W; // 2 332

  // Zadní LB: 8 sektorů × (16 × 16) = 256/sek, extent 352 W × 352 H
  const LB_REAR_HSPACE = 360;
  const LB_REAR_Y0 = PARTER_Y_END + 30; // 1 600
  const LB_REAR_X0 = 1500 - (8 * LB_REAR_HSPACE - 8) / 2;
  for (let s = 0; s < 8; s++) {
    sectors.push(buildRectSector(`LB-${109 + s}`, LB_REAR_X0 + s * LB_REAR_HSPACE, LB_REAR_Y0, 16, 16, PITCH, ROW_PITCH, 'bottom'));
  }
  const LB_REAR_Y_END = LB_REAR_Y0 + 16 * ROW_PITCH; // 1 952

  // ── UB (Upper Bowl) — 10 boční + 8 zadní = 4 552 ──
  // Boční 18 rows × 12 seats = 216 each. Extent 396 W × 264 H. Spacing 275.
  // 5 × 275 = 1 375, slightly past parter 1 320 — ale UB se může táhnout dál.
  // Total bočních: 10 × 216 = 2 160 (vs. plánovaných 1 960)
  const UB_GAP = 50;
  const UB_SECTOR_W = 18 * ROW_PITCH; // 396
  const UB_VERT_SPACING = 275;
  for (let s = 0; s < 4; s++) {
    const yBase = PARTER_Y0 + s * UB_VERT_SPACING;
    sectors.push(buildRectSector(`UB-${205 + s}`, LB_LEFT_X_END - UB_GAP, yBase, 18, 12, PITCH, ROW_PITCH, 'left'));
    sectors.push(buildRectSector(`UB-${220 - s}`, LB_RIGHT_X_END + UB_GAP, yBase, 18, 12, PITCH, ROW_PITCH, 'right'));
  }
  const UB_LEFT_X_END = LB_LEFT_X_END - UB_GAP - UB_SECTOR_W; // 222
  const UB_RIGHT_X_END = LB_RIGHT_X_END + UB_GAP + UB_SECTOR_W; // 2 778

  // Zadní UB: 8 sektorů × (18 × 18) = 324/sek, extent 396 × 396
  const UB_REAR_HSPACE = 405;
  const UB_REAR_Y0 = LB_REAR_Y_END + UB_GAP; // 2 002
  const UB_REAR_X0 = 1500 - (8 * UB_REAR_HSPACE - 9) / 2;
  for (let s = 0; s < 8; s++) {
    sectors.push(buildRectSector(`UB-${210 + s}`, UB_REAR_X0 + s * UB_REAR_HSPACE, UB_REAR_Y0, 18, 18, PITCH, ROW_PITCH, 'bottom'));
  }
  const UB_REAR_Y_END = UB_REAR_Y0 + 18 * ROW_PITCH; // 2 398

  // ── TL (Top Level) — 10 boční + 8 zadní = 3 232 ──
  // Boční 14 rows × 12 seats = 168 each. Extent 308 W × 264 H. Spacing 275.
  // Total bočních: 10 × 168 = 1 680
  const TL_GAP = 50;
  const TL_VERT_SPACING = 275;
  for (let s = 0; s < 4; s++) {
    const yBase = PARTER_Y0 + s * TL_VERT_SPACING;
    sectors.push(buildRectSector(`TL-${305 + s}`, UB_LEFT_X_END - TL_GAP, yBase, 14, 12, PITCH, ROW_PITCH, 'left'));
    sectors.push(buildRectSector(`TL-${320 - s}`, UB_RIGHT_X_END + TL_GAP, yBase, 14, 12, PITCH, ROW_PITCH, 'right'));
  }

  // Zadní TL: 8 sektorů × (14 × 16) = 224/sek, extent 352 W × 308 H
  const TL_REAR_HSPACE = 360;
  const TL_REAR_Y0 = UB_REAR_Y_END + TL_GAP; // 2 448
  const TL_REAR_X0 = 1500 - (8 * TL_REAR_HSPACE - 8) / 2;
  for (let s = 0; s < 8; s++) {
    sectors.push(buildRectSector(`TL-${310 + s}`, TL_REAR_X0 + s * TL_REAR_HSPACE, TL_REAR_Y0, 14, 16, PITCH, ROW_PITCH, 'bottom'));
  }

  // ── Skyboxes (24 × 12 = 288) ──
  // 12 v mezeře LB↔UB ring (BOX-1..12), 12 v mezeře UB↔TL ring (BOX-13..24)
  const BOX_W = 6 * PITCH; // 132
  const placeBoxRow = (yBase, idxStart) => {
    const spacing = BOX_W + 16;
    const totalW = 12 * spacing - 16;
    const x0 = 1500 - totalW / 2;
    for (let s = 0; s < 12; s++) {
      sectors.push(buildRectSector(`BOX-${idxStart + s}`, x0 + s * spacing, yBase, 2, 6, PITCH, ROW_PITCH, 'bottom'));
    }
  };
  placeBoxRow(LB_REAR_Y_END + 3, 1);
  placeBoxRow(UB_REAR_Y_END + 3, 13);

  return {
    viewBox: '0 0 3500 3000',
    stage: { label: 'PÓDIUM', position: 'top' },
    stageBox: { x: STAGE_X, y: STAGE_Y, width: STAGE_W, height: STAGE_H },
    sectors,
  };
}

// ─── 3) Stadion FC Praha (50 000) — Letná-style fotbal ─────────────────────
// Layout (top-down). Východ + Západ procházejí přes celou výšku canvasu —
// pokrývají i rohové oblasti. Sever a Jih jsou jen nad/pod polem (úzká část).
//
//   ┌─────────────────────────────────────────────────────────────┐
//   │ ZAPAD  │             SEVER (8 bloků A-H)              │ V  │
//   │ A      ├─────────────────────────────────────────────│ Y  │
//   │ B      │                                              │ C  │
//   │ ...    │              HŘIŠTĚ (2400×1600)              │ H  │
//   │ H      │                                              │ O  │
//   │        ├─────────────────────────────────────────────│ D  │
//   │        │             JIH (10 bloků A-J)              │ A-L│
//   └─────────────────────────────────────────────────────────────┘
//
// Velikosti:
//   Sever  8 bloků × 50 řad × 30 míst = 12 000
//   Jih   10 bloků × 50 řad × 20 míst = 10 000
//   Východ 12 bloků × 50 řad × 30 míst = 18 000  (hlavní tribuna)
//   Západ  8 bloků × 50 řad × 25 míst = 10 000
//   ⇒ celkem 50 000 ✓
//
// Tribuny Východ/Západ pokrývají rohy implicitně (sektory A a L jsou v rozích).
function buildStadium() {
  const sectors = [];
  const BLOCK_GAP = 25;

  // Pole uprostřed. Schematic 3:2 ratio (proporce stadium půdorysu).
  const FIELD_W = 2400, FIELD_H = 1600;
  // Tribuny okolo: hloubka 1200 px (cca 50% rozměru pole — realistic).
  const NS_DEPTH = 1200; // sever / jih hloubka
  const EW_DEPTH = 1200; // východ / západ hloubka

  // Origin systému: západ začíná na X=0, sever začíná na Y=0.
  const FIELD_X = EW_DEPTH;        // pole vlevo začíná po Západu
  const FIELD_Y = NS_DEPTH;        // pole nahoře začíná po Severu
  const TOTAL_W = EW_DEPTH + FIELD_W + EW_DEPTH; // 4800
  const TOTAL_H = NS_DEPTH + FIELD_H + NS_DEPTH; // 4000

  // ─── SEVER (8 bloků × 50 řad × 30 míst = 12 000) ─────────
  // Šířka tribuny = šířka pole (2400). Bloky vedle sebe.
  // 8 × (30 sedadel × pitchX + gap) = FIELD_W
  // pitchX = (FIELD_W / 8 - gap) / 30 = (300-25)/30 = 9.17
  {
    const blockN = 8, rows = 50, spr = 30;
    const blockSpan = (FIELD_W - (blockN - 1) * BLOCK_GAP) / blockN; // 280.6
    const seatPitch = blockSpan / spr; // 9.35
    const rowPitch = NS_DEPTH / rows; // 24
    for (let b = 0; b < blockN; b++) {
      const letter = String.fromCharCode('A'.charCodeAt(0) + b);
      const originX = FIELD_X + b * (blockSpan + BLOCK_GAP);
      const originY = FIELD_Y - 30; // řada A je u pole (těsně nad polem)
      sectors.push(buildRectSector(
        `SEVER-${letter}`, originX, originY,
        rows, spr, seatPitch, rowPitch, 'top',
      ));
    }
  }

  // ─── JIH (10 bloků × 50 řad × 20 míst = 10 000) ─────────
  {
    const blockN = 10, rows = 50, spr = 20;
    const blockSpan = (FIELD_W - (blockN - 1) * BLOCK_GAP) / blockN; // 217.5
    const seatPitch = blockSpan / spr; // 10.87
    const rowPitch = NS_DEPTH / rows; // 24
    for (let b = 0; b < blockN; b++) {
      const letter = String.fromCharCode('A'.charCodeAt(0) + b);
      const originX = FIELD_X + b * (blockSpan + BLOCK_GAP);
      const originY = FIELD_Y + FIELD_H + 30;
      sectors.push(buildRectSector(
        `JIH-${letter}`, originX, originY,
        rows, spr, seatPitch, rowPitch, 'bottom',
      ));
    }
  }

  // ─── VÝCHOD (12 bloků × 50 řad × 30 míst = 18 000) ──────
  // Hlavní tribuna, prochází přes celou výšku canvas (TOTAL_H), zahrnuje rohy.
  {
    const blockN = 12, rows = 50, spr = 30;
    const blockSpan = (TOTAL_H - (blockN - 1) * BLOCK_GAP) / blockN; // 310.4
    const seatPitch = blockSpan / spr; // 10.35
    const rowPitch = EW_DEPTH / rows; // 24
    for (let b = 0; b < blockN; b++) {
      const letter = String.fromCharCode('A'.charCodeAt(0) + b);
      const originX = FIELD_X + FIELD_W + 30;
      const originY = b * (blockSpan + BLOCK_GAP);
      sectors.push(buildRectSector(
        `VYCHOD-${letter}`, originX, originY,
        rows, spr, seatPitch, rowPitch, 'right',
      ));
    }
  }

  // ─── ZÁPAD (8 bloků × 50 řad × 25 míst = 10 000) ────────
  {
    const blockN = 8, rows = 50, spr = 25;
    const blockSpan = (TOTAL_H - (blockN - 1) * BLOCK_GAP) / blockN; // 478.1
    const seatPitch = blockSpan / spr; // 19.13
    const rowPitch = EW_DEPTH / rows; // 24
    for (let b = 0; b < blockN; b++) {
      const letter = String.fromCharCode('A'.charCodeAt(0) + b);
      const originX = FIELD_X - 30;
      const originY = b * (blockSpan + BLOCK_GAP);
      sectors.push(buildRectSector(
        `ZAPAD-${letter}`, originX, originY,
        rows, spr, seatPitch, rowPitch, 'left',
      ));
    }
  }

  return {
    viewBox: '0 0 4800 4000', // přepíše autoFit
    field: { x: FIELD_X, y: FIELD_Y, width: FIELD_W, height: FIELD_H },
    stage: { label: 'HRACÍ PLOCHA', position: 'center' },
    sectors,
  };
}

// ─── 4) Středně velký stadion (12 000) — Doosan Aréna Plzeň-style ──────────
// Reálná předloha: Doosan Aréna Plzeň (11 700). Asymetrické 4 tribuny,
// Východ jako hlavní s VIP, ostatní brankovištěm/proti tribuna menší.
//
// Velikosti:
//   Sever  6 bloků × 22 řad × 20 míst = 2 640  (brankoviště, hosté)
//   Jih    6 bloků × 22 řad × 20 míst = 2 640  (brankoviště, kotel domácích)
//   Východ 8 bloků × 22 řad × 22 míst = 3 872  (hlavní s VIP)
//   Západ  6 bloků × 22 řad × 22 míst = 2 904  (proti hlavní)
//   ⇒ celkem 12 056 ≈ 12 000 ✓
//
// Východ a Západ procházejí přes celou výšku (zahrnují rohy implicitně).
function buildSmallStadium() {
  const sectors = [];
  const BLOCK_GAP = 25;

  const FIELD_W = 1500, FIELD_H = 900; // pole 5:3 (proporce reálného hřiště)
  const NS_DEPTH = 600;  // sever / jih hloubka
  const EW_DEPTH = 600;  // východ / západ hloubka

  const FIELD_X = EW_DEPTH;
  const FIELD_Y = NS_DEPTH;
  const TOTAL_H = NS_DEPTH + FIELD_H + NS_DEPTH; // 2100

  // SEVER (6 bloků × 22 řad × 20 míst = 2 640)
  {
    const blockN = 6, rows = 22, spr = 20;
    const blockSpan = (FIELD_W - (blockN - 1) * BLOCK_GAP) / blockN;
    const seatPitch = blockSpan / spr;
    const rowPitch = NS_DEPTH / rows;
    for (let b = 0; b < blockN; b++) {
      const letter = String.fromCharCode('A'.charCodeAt(0) + b);
      sectors.push(buildRectSector(
        `SEVER-${letter}`,
        FIELD_X + b * (blockSpan + BLOCK_GAP),
        FIELD_Y - 30,
        rows, spr, seatPitch, rowPitch, 'top',
      ));
    }
  }

  // JIH (6 × 22 × 20 = 2 640)
  {
    const blockN = 6, rows = 22, spr = 20;
    const blockSpan = (FIELD_W - (blockN - 1) * BLOCK_GAP) / blockN;
    const seatPitch = blockSpan / spr;
    const rowPitch = NS_DEPTH / rows;
    for (let b = 0; b < blockN; b++) {
      const letter = String.fromCharCode('A'.charCodeAt(0) + b);
      sectors.push(buildRectSector(
        `JIH-${letter}`,
        FIELD_X + b * (blockSpan + BLOCK_GAP),
        FIELD_Y + FIELD_H + 30,
        rows, spr, seatPitch, rowPitch, 'bottom',
      ));
    }
  }

  // VÝCHOD (8 × 22 × 22 = 3 872, hlavní tribuna s VIP) — pokrývá celou výšku
  {
    const blockN = 8, rows = 22, spr = 22;
    const blockSpan = (TOTAL_H - (blockN - 1) * BLOCK_GAP) / blockN;
    const seatPitch = blockSpan / spr;
    const rowPitch = EW_DEPTH / rows;
    for (let b = 0; b < blockN; b++) {
      const letter = String.fromCharCode('A'.charCodeAt(0) + b);
      sectors.push(buildRectSector(
        `VYCHOD-${letter}`,
        FIELD_X + FIELD_W + 30,
        b * (blockSpan + BLOCK_GAP),
        rows, spr, seatPitch, rowPitch, 'right',
      ));
    }
  }

  // ZÁPAD (6 × 22 × 22 = 2 904) — pokrývá celou výšku
  {
    const blockN = 6, rows = 22, spr = 22;
    const blockSpan = (TOTAL_H - (blockN - 1) * BLOCK_GAP) / blockN;
    const seatPitch = blockSpan / spr;
    const rowPitch = EW_DEPTH / rows;
    for (let b = 0; b < blockN; b++) {
      const letter = String.fromCharCode('A'.charCodeAt(0) + b);
      sectors.push(buildRectSector(
        `ZAPAD-${letter}`,
        FIELD_X - 30,
        b * (blockSpan + BLOCK_GAP),
        rows, spr, seatPitch, rowPitch, 'left',
      ));
    }
  }

  return {
    viewBox: '0 0 2700 2100',
    field: { x: FIELD_X, y: FIELD_Y, width: FIELD_W, height: FIELD_H },
    stage: { label: 'HRACÍ PLOCHA', position: 'center' },
    sectors,
  };
}

// ─── vyrob a uloz ──────────────────────────────────────────────────────────
const layouts = {
  'velky-sal': buildVelkySal(),
  'arena': buildArena(),
  'stadion': buildStadium(),
  'stadion-12k': buildSmallStadium(),
};

for (const layout of Object.values(layouts)) {
  layout.viewBox = autoFitViewBox(layout, 80);
}

let report = '';
for (const [name, layout] of Object.entries(layouts)) {
  writeFileSync(`${OUT_DIR}/${name}.json`, JSON.stringify(layout));
  report += `${name}: ${layout.sectors.length} sektorů, ${totalSeats(layout)} sedadel, viewBox=${layout.viewBox}\n`;
}
console.log(report);

// ─── vygeneruj SQL inserty ─────────────────────────────────────────────────
const sql = `BEGIN;
INSERT INTO catalog.venue_seating_charts (id, venue_id, name, layout, total_seats, active, source, notes)
VALUES
  ('00000000-0000-4000-a000-000000000301', '00000000-0000-4000-a000-000000000202', 'Velky koncertni sal — Rudolfinum-style amfiteátr',
    pg_read_file('/tmp/layouts/velky-sal.json')::jsonb,
    ${totalSeats(layouts['velky-sal'])},
    true, 'seed', 'Generated 2026-04-30 — realistic redesign'),
  ('00000000-0000-4000-a000-000000000302', '00000000-0000-4000-a000-000000000203', 'Aréna Praha — O2-style koncert config',
    pg_read_file('/tmp/layouts/arena.json')::jsonb,
    ${totalSeats(layouts['arena'])},
    true, 'seed', 'Generated 2026-04-30 — realistic redesign'),
  ('00000000-0000-4000-a000-000000000303', '00000000-0000-4000-a000-000000000204', 'Stadion FC Praha — Letná-style 4 tribuny',
    pg_read_file('/tmp/layouts/stadion.json')::jsonb,
    ${totalSeats(layouts['stadion'])},
    true, 'seed', 'Generated 2026-04-30 — realistic redesign')
ON CONFLICT (id) DO NOTHING;
COMMIT;
`;
writeFileSync('./scripts/seed-rich-demo-phase2.sql', sql);
console.log('SQL written to scripts/seed-rich-demo-phase2.sql');
