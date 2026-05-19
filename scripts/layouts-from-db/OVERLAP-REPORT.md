# Overlap audit — všechny aktivní seating charty (2026-05-19)

Spuštěno: `node scripts/check-overlaps.mjs <chart.json>` — **auto mode** počítá render radius
z layout pitch (přesně tak, jak to dělá `SeatPicker.tsx:556` —
`radius = clamp(2, 12, pitch × 0.42)`). Kolize = sedadla blíž než
diameter (kruhy fyzicky překrývají).

| Layout | Sektorů | Sedadel | Pitch | Hard kolize | Stav |
|---|--:|--:|--:|--:|:--|
| Stadion FC Praha | 38 | 50 000 | 10.35 | 0 | ⚠️ těsně (pitch < 12) |
| **Arena Praha** | 73 | 14 840 | **8.00** | **4 895** | ❌ rebuild |
| **Sportovní stadion FC Olomouc** | 26 | 12 056 | **11.46** | 0 | ⚠️ těsně (pitch < 12) |
| Velký koncertní sál Praha | 15 | 1 487 | 22.00 | 0 | ✅ |
| Divadlo Stará střelnice (Hranice) | 4 | 308 | 47.00 | 0 | ✅ |
| Divadlo v Celetné — Hlavní sál | 1 | 117 | 34.00 | 0 | ✅ |
| Divadlo v Celetné — Kabaret | 10 | 80 | 40.00 | 0 | ✅ |
| Divadlo v Celetné — Studio | 1 | 49 | 34.00 | 0 | ✅ |

## Tři vrstvy problému (uživatel skutečně vidí všechny tři)

### P0 — Arena Praha hard kolize (4 895)
Matematicky překrývající se kruhy. Sektor LB-105/UB-201 atd. mají
posledních 11 sedadel na stejných souřadnicích jako prvních 11
sousedního sektoru. **Vidět i bez zoomu.**

### P1 — Olomouc + Stadion Praha vizuální těsnost
Pitch 10.35 / 11.46. Render radius je 4.35 / 4.81 (diameter ~10 / ~10).
Mezi sedadly je < 1 px volného místa. Při SVG `strokeWidth={0.5}` se
okraje **dotýkají**. Při hover `strokeWidth = radius × 0.25 = 1.2`
už okraje fyzicky překrývají. To je co user vidí "i po zoomu".

### P2 — Vše ostatní OK
Pitch 22+ má pohodlné rozestupy, vždy oddělená sedadla.

## Root cause P0 — Arena Praha

```
~4 px  LB-105/A/15  ↔  LB-106/A/1
~4 px  LB-105/A/16  ↔  LB-106/A/2
...
~4 px  LB-105/A/25  ↔  LB-106/A/11
```

Sektor LB-105 má 25 sedadel v řadě, ale **LB-106 startX je posunutý jen o ~14 seatPitch**.
Posledních 11 sedadel LB-105 leží přesně tam, kde prvních 11 LB-106. Stejné pro UB sektory.

## Root cause P1 — pitch je moc malý

Olomouc + Stadion Praha mají pitch ~10. Renderer počítá radius z pitchu, ale clamp
na max 12 znamená že hustý layout dostane malé kruhy. Diameter je téměř roven pitchi,
zbývá < 1 px volného místa = vizuální slepení.

Doporučená min pitch hodnota: **18** (radius = 7.56, diameter 15.12, 3 px volného místa).
Toto vyžaduje **zvětšit viewBox** layoutu úměrně, ne změnit pitch izolovaně
(jinak by se sedadla rozprostřela mimo viewport).

## Fix workflow

### P0 — Arena Praha
1. V `scripts/generate-rich-layouts.mjs` najdi funkci pro Arenu Praha
2. Buď zmenšit seatsPerRow z 25 na 14 pro LB-101..LB-130 (každý sektor 14 sedadel)
3. Nebo posunout startX dalšího sektoru o správný offset
4. Vygeneruj nový arena-praha.json
5. UPSERT do `catalog.venue_seating_charts` s novou verzí + active=true
6. DELETE z `catalog.event_seats` pro Arena Praha events
7. Volej `copy_layout_to_event_seats()` znovu
8. Re-run `node scripts/check-overlaps.mjs scripts/layouts-from-db/arena-praha.json` — musí být 0

### P1 — Olomouc + Stadion Praha
1. Zvětšit viewBox 2× v generator funkci (např. z 2866 na ~5700)
2. Tím se naturally zvětší pitch z 11 na ~22
3. UPSERT layout, re-link event_seats
4. Re-run check — pitch by měl být 18+

### Alternativa pro P1 — render-side fix
Zmenšit render radius v `SeatPicker.tsx:556`:
- Z `Math.min(12, pitch * 0.42)` na `Math.min(pitch / 3, 12)`
- Pro pitch 11 → radius 3.66, diameter 7.32, mezera 3.68 px ✓
- Méně práce, ale na úkor menších/hůř klikatelných kruhů na hustých layoutech
