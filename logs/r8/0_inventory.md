# Kolo 8 — inventura existujícího kódu (2026-10-04, read-only průzkum před stavbou)

1. Inscenace: `catalog.productions` (id, promoter_id, title, slug) + `catalog.events.production_id`; routy `api/admin/productions[/id/events]`, stránka `admin/productions`. `event_groups.*` (tour/festival/series), `tours.*` nepoužité. Veřejně: žádná stránka inscenace; `[locale]/events` bez filtru města/měsíce; `[locale]/city/[city]` bez měsíce; `api/public/events` umí city/date_from/date_to.
2. Sály: `catalog.venues` = fakticky jeden sál (bez místa→sálů); `venue_seating_charts` (layout jsonb sectors/rows/seats, verze); `event_seats` (sector,row,seat_number,status,hold_kind,hold_label, UNIQUE s event_day_id NULL → duplicity možné); kopie `lib/seats/copy-layout-to-event-seats.ts` (vada: čte seat.acc místo accessibility; ON CONFLICT bez účinku při NULL event_day_id); editor `platform/venues/[id]/seating-chart/editor/VisualEditor.tsx` (marquee/shift výběr, posun, podklad PDF/obrázek přes pdfjs), promotér `admin/venues/[venueId]/seating-chart`. Chybí: typ místa, cenové zóny v plánku, validace duplicit, generátor s číslováním liché/sudé.
3. Blokace: holdy jako sloupce `event_seats` (hold/kill) přes `api/admin/events/[id]/holds` + `holds/issue` (comps). `seat_holds.seat_holds` nepoužitá. Comps `api/admin/events/[id]/comps`, guestlist `orders.guestlist_entries`. Chybí pojmenovaná blokace jako entita s přehledem uvolněno/vydáno/prodáno.
4. Ceny: kategorie = samostatné typy vstupenek; `discount_pricing_rules` (ověření uživatele, bez CRUD), member/volume/group pravidla; seated checkout jen 1 typ vstupenky na požadavek; promo kód v checkoutu nevynucuje applicable_ticket_type_ids/min/max_per_user.
5. Rezervace: `api/admin/reservations` (POST only, bez míst, platba převodem); cron `expire-pending-orders` uvolní held místa; POS `api/admin/pos/sale` bez hledání podle kódu/jména.
6. Firemní: `b2b_orders.invoice_orders` nepoužitá (rozbité RLS dle mig 464); `platform.b2b_accounts` = předplacený kredit; školní rezervace bez faktury; doklady `orders.invoices` + ISDOC (kolo 7).
7. Zrušení: žádná route cancel; `postpone`, `reschedule` (+ odpovědi kupců s tokenem), `emergency` (e-maily jen console.log); `api/admin/orders/bulk-refund` → executeOrderRefund.
8. Reporty: ~198 reportů v `lib/reports`, CSV ručně, bez XLSX knihovny, bez reportu podle zón, bez seznamu pro uvaděčky.
9. Skener: `api/admin/scanner/validate` vrací jen ticketId/eventTitle/ticketTypeName/holder — bez místa a bez „ověřit průkaz".
10. PDF vstupenky: `lib/tickets/pdf-renderer.ts` (místo ano, kategorie ne).
11. Playwright: `e2e/` (bez webServer, BASE_URL), ~44 specs.
Provize: `platform.fee_schedules` (0 % jde), výchozí 5 % natvrdo jako fallback.
