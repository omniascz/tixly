# PROGRESS — kolo 15 (upgrade Next.js 14 → 15 bez změny chování a vzhledu)

Větev `fix/round15-next15-2026-10-07` z `f2af248a`. Výstupy `logs/r15/`. Skripty `logs/r15/*.sh` (z kola 14: demo
`reset_demo.sh` → r15demo, server `serve_r15.sh [build]` :3200, `serve_r15a.sh`, `live_chunk.sh`, `with_gopay.sh`,
`run_audits.sh`). Jeden těžký proces naráz; procesy ukončovat přes PowerShell (next start na Windows).

## Cíl verze
- next 15.5.27 = nejnovější 15.5.x; GitHub Advisory DB pro next@15.5.27: 0 advisories; pro 14.2.35: 2 critical,
  8 high (`logs/r15/0_advisories_next.txt`). React 19 (průvodce upgradem na 15 pro App Router).

## Krok 1 — referenční snímek (f2af248a)
- Spec `e2e/tests/golden-path-r15-screens.spec.ts`: 22 obrazovek kola 13 + program, inscenace, checkout (1440+390);
  skener 1440+390 je v sadě (12-skener).
- r15demo z `create.sh --local`, build na f2af248a (Next 14.2.35) → `logs/r15/routes-before.txt` (tabulka z next build),
  normalizovaně `routes-before.norm.txt`: 1124 rout, 1119 ƒ dynamických, 5 ○ statických.
- Screenshoty `logs/r15/before/` (28 PNG). Determinismus: druhý běh na stejném kódu → 28/28 pixelově shodných
  (`1_compare_before_self.txt`), porovnávací skript `e2e/r15-compare.mjs` (přesné, bez tolerance).
