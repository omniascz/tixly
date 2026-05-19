# Overlap audit — všechny aktivní seating charty (2026-05-19)

Spuštěno: `node scripts/check-overlaps.mjs <chart.json>` s default tolerance 5 SVG units.

| Layout | Sektorů | Sedadel | Kolize | Stav |
|---|--:|--:|--:|:--|
| Stadion FC Praha | 38 | 50 000 | 0 | ✅ |
| **Arena Praha** | 73 | 14 840 | **4 569** | ❌ rebuild |
| Sportovní stadion FC Olomouc | 26 | 12 056 | 0 | ✅ |
| Velký koncertní sál Praha | 15 | 1 487 | 0 | ✅ |
| Divadlo Stará střelnice (Hranice) | 4 | 308 | 0 | ✅ |
| Divadlo v Celetné — Hlavní sál | 1 | 117 | 0 | ✅ |
| Divadlo v Celetné — Kabaret | 10 | 80 | 0 | ✅ |
| Divadlo v Celetné — Studio | 1 | 49 | 0 | ✅ |

**7/8 layoutů je v pořádku.** Jediný rozbitý je **Arena Praha**.

## Root cause Areny Praha

```
4.00px  LB-105/A/15  ↔  LB-106/A/1
4.00px  LB-105/A/16  ↔  LB-106/A/2
...
4.00px  LB-105/A/25  ↔  LB-106/A/11
```

Sektor LB-105 má 25 sedadel v řadě, ale **LB-106 startX je posunutý jen o ~14 seatPitch**.
Posledních 11 sedadel LB-105 leží přesně tam, kde prvních 11 LB-106. Stejné pro UB sektory.

136 kolizí v LB-105 ↔ LB-106 = 11 sedadel × ~12 řad. Násobeno počtem dvojic = 4 569.

## Fix

V `scripts/generate-rich-layouts.mjs` v funkci pro Arenu Praha:
- Buď zmenšit seatsPerRow z 25 na 14 pro LB-101..LB-130 (každý sektor 14 sedadel)
- Nebo posunout startX dalšího sektoru o správný offset

Po fixu:
1. Vygeneruj nový arena-praha.json
2. UPSERT do `catalog.venue_seating_charts` s novou verzí + active=true (stará verze ostane v historii)
3. DELETE z `catalog.event_seats` pro Arena Praha events
4. Volej `copy_layout_to_event_seats()` znovu
5. Re-run `node scripts/check-overlaps.mjs` — musí být 0 kolizí
