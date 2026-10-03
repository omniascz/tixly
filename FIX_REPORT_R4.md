# FIX_REPORT_R4 — kolo 4 oprav Tixly (průběžně)

Větev `fix/round4-2026-10-03` (worktree `../tixly-fix`), základ `e5789d7`.
Prostředí: izolovaná DB z migrací, PgBouncer transaction mode, fake-gopay, Mailpit, Redis; vše pod `tixly_app`.

## Nálezy
| Nález | Příčina | Oprava | Test | RED → GREEN | Commit |
|---|---|---|---|---|---|
| S2 upgrade únik (audit 08 I1) | GET v servisním kontextu bez kontroly vlastníka; POST 403 NOT_OWNER prozrazoval existenci, vlastnictví i přes ownerEmail | vlastnictví pod RLS kupce, cizí → 404 bez dat, bez identity 401; POST jen ověřená identita | fix-r4-s2-upgrade-leak | cizí kupec 200 s daty → 3/3 | 7b481c1 |
| 5xx calendar.ics (audit 08 I2) | `pg` vrací timestamptz jako Date, `iso.replace` → 500 pro všechny vč. vlastníka; neplatné UUID → 22P02 | datum přes `toISOString`, kontrola UUID → 404; UID = otisk, ne ID objednávky (capability hosta zachována) | fix-r4-5xx-ics-kiosk | 500 → 200/403/404 | 03f6c93 |
| 5xx kiosk (audit 08 I2) | dotaz na neexistující `capacity`, `is_active`, `sort_order` → 500 vždy | `total_qty`, jen veřejné typy, řazení podle ceny | fix-r4-5xx-ics-kiosk | 500 → 200/422/404 | 03f6c93 |

| 25 rout bez identity (R3 bod 3) | middleware předával `x-user-id` jen u vyjmenovaných prefixů; jinde přihlášený dostal 401 | ověřená identita u všech `/api` cest, povinnost přihlášení dál prefix/handler | fix-r4-identity-all-api | 3 fail (40 kombinací, cookie, handler 401) → 5/5 | 724005c |
| scanner/school-group bez ověření (inventura) | odbavení školní skupiny bez jakékoli autentizace | jen aktivní pořadatel rezervace; cizí = jako neexistující token | fix-r4-school-group-scan | 2 fail (anonym i cizí admitted s daty) → 3/3 | 980442e |
| mock-qes bez produkční pojistky (inventura) | routa zapisuje podpis přímo; výchozí QES = mock; obcházela pojistku webhooku z kola 2 | 403 MOCK_DISABLED v produkci (ALLOW_MOCK_PAYMENTS=1 jen demo) | fix-r4-mock-qes-prod | GET 200 s PDF a e-mailem → 403, žádost pending | 3097c7b |
| qes_signing_requests R-58 (při 2c) | policy čte `app.bypass_rls`; QES pod tixly_app nefunguje | migrace 489: admin/servis/vlastní pořadatel | fix-r4-qes-policy | 2 fail (servis 0 řádků, 404) → 2/2; od nuly OK, 2× OK | 06bfdbf |
| přeprodej přes `ownerEmail` (inventura) | vlastnictví podle e-mailu z těla; anonym vystavil cizí vstupenku za 1 Kč a stáhl cizí inzerát | ověřená identita, nebo host s UUID své objednávky (capability stránky potvrzení); tlačítko posílá orderId | fix-r4-resale-owner-email | 2 fail (201 za 1 Kč, 200 stažení) → 4/4 | 3676a27 |
| pamětní vstupenka `?token=` cokoli (inventura) | `hasQueryToken = !!queryToken` — token se neověřoval ani nevydával | vlastník nebo HMAC token této vstupenky; ověření před dotazem; e-mail nese token | fix-r4-memory-token | 3 fail (?token=x → data) → 3/3 | 7203bc8 |
| konfigurace před přihlášením (wallet/apple, mobile/payment-intent) | kontrola env před `runAsUser` → anonym 503 | kontrola uvnitř `runAsUser` | fix-r4-auth-before-config | anonym 503 → 401 (přihlášený 503) | 7d600b7 |
<!-- /nalezy -->

**Krok 1 — audit 08 po opravách:** I1 PASS (154 GET rout × 3 cizí aktéři, 0 úniků), I2 PASS (0 odpovědí 5xx). `logs/r4/1c_r2_e2e_08.out`.

