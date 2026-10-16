# Kolo 20 / krok 1.4 — stejný vzor (`<datum>.replace(` / `.slice(` / `.split(` na hodnotě přímo z pg) v src/app a src/lib

Hledáno na HEAD větve (po opravě page.tsx), soubory testů vynechány. Výrazy:

1. `grep -rnE "[A-Za-z_]*(date|_at|_start|_end|start_|end_|starts|ends|time|Date|At)[A-Za-z_]*\??\)?\.(replace|slice|split|substring|substr|padStart|startsWith|includes|localeCompare)\(" src/app src/lib`
   bez `toISOString().slice/split/replace` a `new Date().toISOString` (hodnota už je řetězec) → **18 výskytů**
2. `\.[a-z_]*(_on|until|_from|deadline|scheduled|birth|dob|expires|period|month|_day|day_|timestamp)[a-z_]*\.(replace|slice|split|substring|substr)\(` → 0
3. `String(<datum>).slice/split/replace/substring(` → 1 (už v seznamu 1: fio.ts)

Ovladač pg (node-postgres) bez vlastních parserů typů (`setTypeParser` v src 0×) vrací `timestamptz`/`timestamp`/`date` jako
`Date`; sloupec přetypovaný v SQL na `::text` přichází jako řetězec. Hodnoty v klientských komponentách přicházejí z API přes JSON
(Date → ISO řetězec), tam vada nastat nemůže.

| soubor:řádek | výraz | zdroj hodnoty | z pg jako Date? | vada? |
|---|---|---|---|---|
| src/app/admin/events/page.tsx:197 | `newDate.replace(' ', 'T')` | vstup uživatele (klient) | ne | ne |
| src/app/admin/events/[id]/edit/page.tsx:53 | `d.dateStart.slice(0, 16)` | JSON z API (klient) | ne | ne |
| src/app/admin/events/[id]/season/page.tsx:134 | `day.startsAt.slice(0, 16)` | JSON z API (klient) | ne | ne |
| src/app/admin/events/[id]/season/page.tsx:135 | `day.endsAt.slice(0, 16)` | JSON z API (klient) | ne | ne |
| src/app/admin/events/[id]/ticket-types/page.tsx:131 | `tt.presaleStartsAt.slice(0, 16)` | JSON z API (klient) | ne | ne |
| src/app/admin/events/[id]/ticket-types/page.tsx:132 | `tt.presaleEndsAt.slice(0, 16)` | JSON z API (klient) | ne | ne |
| src/app/admin/events/[id]/ticket-types/page.tsx:157 | `tt.presaleStartsAt.slice(0, 16)` | JSON z API (klient) | ne | ne |
| src/app/admin/events/[id]/ticket-types/page.tsx:159 | `tt.presaleEndsAt.slice(0, 16)` | JSON z API (klient) | ne | ne |
| src/app/admin/events/[id]/tickets/[ticketId]/history/page.tsx:128 | `a.timestamp.localeCompare(...)` | JSON z API (klient) | ne | ne |
| src/app/api/admin/date-holds/route.ts:107 | `e.date_start.slice(0, 10)` | SQL ř. 83 `e.date_start::text` | ne (text) | ne |
| src/app/api/admin/events/[id]/offers/route.ts:146 | `evRow?.date_start?.slice(0, 10)` | SQL ř. 117 `e.date_start::text` | ne (text) | ne |
| src/app/api/admin/reports/pohoda/route.ts:98 | `o.paid_at.slice(0, 10)` | SQL ř. 67 `o.paid_at::text` | ne (text) | ne |
| src/app/api/admin/scanner/offline-sync/route.ts:47 | `a.scannedAt.localeCompare(...)` | tělo požadavku (JSON) | ne | ne |
| src/app/api/admin/theatre-reports/route.ts:32 | `s.dateStart.slice(0, 16)` | lib/theatre/reports.ts ř. 50 `e.date_start::text` | ne (text) | ne |
| src/app/api/admin/theatre-reports/route.ts:44 | `o.dateStart.slice(0, 16)` | lib/theatre/reports.ts ř. 62 `e.date_start::text` | ne (text) | ne |
| src/lib/accounting/documents.ts:204 | `taxableDate.slice(0, 4)` | SQL ř. 158–159 `…::date::text` | ne (text) | ne |
| src/lib/bank/fio.ts:81 | `String(date).slice(0, 10)` | JSON odpověď Fio API | ne | ne |
| src/lib/music/providers/songkick.ts:23 | `p.date_start.slice(0, 10)` | lib/music ř. 60 `e.date_start::text` | ne (text) | ne |

**Výsledek: 18 výskytů, 0 kandidátů na vadu stejného typu** (opravená page.tsx už výraz neobsahuje). Poznámka mimo vadu pádu:
`<timestamptz>::text` vrací čas v časové zóně relace DB (lokální fix-pg: UTC, ověřeno výstupem `+00`; produkce neověřována), takže `slice(0, 10)` dává datum v UTC, ne
v Europe/Prague — u akcí po 23:00 SEČ/22:00 SELČ by se datum lišilo o den (date-holds, offers, theatre-reports, songkick).
Nejde o pád ani o tento vzor; zapsáno jen jako postřeh pro další kolo. Neopravováno (rozsah kola).
