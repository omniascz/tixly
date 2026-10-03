# FIX_REPORT_R4 — kolo 4 oprav Tixly (průběžně)

Větev `fix/round4-2026-10-03` (worktree `../tixly-fix`), základ `e5789d7`.
Prostředí: izolovaná DB z migrací, PgBouncer transaction mode, fake-gopay, Mailpit, Redis; vše pod `tixly_app`.

## Nálezy
| Nález | Příčina | Oprava | Test | RED → GREEN | Commit |
|---|---|---|---|---|---|
| S2 upgrade únik (audit 08 I1) | GET v servisním kontextu bez kontroly vlastníka; POST 403 NOT_OWNER prozrazoval existenci, vlastnictví i přes ownerEmail | vlastnictví pod RLS kupce, cizí → 404 bez dat, bez identity 401; POST jen ověřená identita | fix-r4-s2-upgrade-leak | cizí kupec 200 s daty → 3/3 | 7b481c1 |
| 5xx calendar.ics (audit 08 I2) | `pg` vrací timestamptz jako Date, `iso.replace` → 500 pro všechny vč. vlastníka; neplatné UUID → 22P02 | datum přes `toISOString`, kontrola UUID → 404; UID = otisk, ne ID objednávky (capability hosta zachována) | fix-r4-5xx-ics-kiosk | 500 → 200/403/404 | 03f6c93 |
| 5xx kiosk (audit 08 I2) | dotaz na neexistující `capacity`, `is_active`, `sort_order` → 500 vždy | `total_qty`, jen veřejné typy, řazení podle ceny | fix-r4-5xx-ics-kiosk | 500 → 200/422/404 | 03f6c93 |
