# Overlap audit — final state (2026-05-19)

**Status: 8/8 layoutů ✅ 0 kolizí.**

Spuštěno: `node scripts/check-overlaps.mjs <chart.json>` — auto mode počítá
render radius z layout pitch (přesně jak `SeatPicker.tsx:556` —
`radius = clamp(2, 12, pitch / 3)` po render patch).

| Layout | Sektorů | Sedadel | Pitch | Hard kolize | Stav |
|---|--:|--:|--:|--:|:--|
| Arena Praha | 43 | 6 612 | 22.00 | 0 | ✅ rewritten |
| Stadion FC Praha | 38 | 50 000 | 10.35 | 0 | ✅ |
| Sportovní stadion FC Olomouc | 26 | 12 056 | 22.92 | 0 | ✅ rescaled 2× |
| Velký koncertní sál Praha | 15 | 1 487 | 22.00 | 0 | ✅ |
| Divadlo Stará střelnice | 4 | 308 | 47.00 | 0 | ✅ |
| Divadlo v Celetné — Hlavní sál | 1 | 117 | 34.00 | 0 | ✅ |
| Divadlo v Celetné — Kabaret | 10 | 80 | 40.00 | 0 | ✅ |
| Divadlo v Celetné — Studio | 1 | 49 | 34.00 | 0 | ✅ |

## Co bylo opravené (5 commitů, postupně)

### Commit 1: `99187d1` — overlap detection tooling
Vznikly utility `check-overlaps.mjs` a `dump-layouts.mjs`. Initial audit
zjistil 4 569 kolizí v Areně Praze (jen LB-105/106/UB-201/202/etc.
sektory sdílely 11-seat sloupce).

### Commit 2: `1913704` + `452d7bb` — auto-mode + 3-vrstvá analýza
Check upgradován na real render radius. Detekuje rozdíl mezi P0 hard
kolizemi a P1 vizuální těsností.

### Commit 3: `db13471` — 3 vrstvy fixu
- **Render patch** SeatPicker.tsx:556: `pitch × 0.42` → `pitch / 3` —
  garantuje 33 % volnou mezeru mezi okraji kruhů i s hover stroke
- **Olomouc x2 scale** přes `scripts/scale-layout.mjs` — pitch 11.46 → 22.92
- **Arena Praha geometric patch** v `generate-rich-layouts.mjs` —
  reduce seats per row, 4 895 → 206 kolizí

### Commit 4: `194613d` — Arena Praha rewrite
Kompletní přepis `buildArena()` na čistou podkovu BEZ "přední LB/UB"
sektorů (zdroj všech residuálních kolizí). Struktura:

- PARTER (50 × 40 = 2 000)
- LB ring: 8 boční + 6 zadní + 12 skyboxes
- UB ring: 10 boční + 6 zadní

43 sektorů, 6 612 sedadel, pitch 22.00 uniform. **0 kolizí**.

Trade-off: -1 732 sedadel vs předchozí Aréna (8 344 → 6 612).

## Tooling pro budoucí venues

```bash
# Stáhni aktuální layouty z DB
node scripts/dump-layouts.mjs

# Zkontroluj jeden layout
node scripts/check-overlaps.mjs scripts/layouts-from-db/<slug>.json

# Zvětši layout 2× (pokud je pitch malý)
node scripts/scale-layout.mjs in.json out.json 2

# Patch DB s novým layoutem + regenerate event_seats
# (modify VENUE_ID/CHART_ID konstanty v patch-*-layout.mjs)
node scripts/patch-arena-layout.mjs  # příklad
```

## Pravidla pro nové layouty

1. **Pitch ≥ 18** ideálně 22+ — render formula `pitch / 3` dá radius 7+, dia 14+
2. **Sektor = blok minimum 3 řady × 6 sedadel** — žádné 1-řadové proužky
3. **Axis-aligned obdélníky** — žádné cos/sin po sedadle
4. **Stage / field má explicitní `{x, y, w, h}`**, ne jen `position: 'top'`
5. **Sektory se nesmí prostorově křížit** — pre-publish run `check-overlaps.mjs`
6. **Lóže = samostatné sektory** s krátkými jmény (BOX-1..BOX-12)

Workflow když dostaneš nový venue brief:
1. Načrtni layout v Excel s buňkami = sektory (jeden sektor per cell)
2. V `generate-rich-layouts.mjs` napiš `build<VenueName>()` funkci
3. Spusť generator → check-overlaps → ručně proji visual editor v UI
4. Pokud OK, UPSERT do DB přes patch-*.mjs template
5. Test buyer flow: koupit lístek, ověřit confirmation
