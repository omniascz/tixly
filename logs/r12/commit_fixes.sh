#!/usr/bin/env bash
# Kolo 12 / krok 2: opravy po oblastech — samostatné commity (test: e2e/tests/golden-path-r12-ux-fixes.spec.ts F1–F12).
set -euo pipefail
cd /c/Users/omnia/Documents/tixly
NB=nextjs-boilerplate/src
TRAILER=$'\n\nCo-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>'
c() { local msg="$1"; shift; git add -- "$@"; git commit -q -m "$msg$TRAILER"; git log --oneline -1; }

c "fix(R12-2a): sdílené potvrzení v okně aplikace a chyby API česky

ConfirmDialog (důsledky v bodech, volitelné pole, Zpět / konkrétní akce) místo window.confirm/prompt;
errorText: co se stalo a co udělat (dřív INVALID_BODY, HTTP 422, JSON)." \
  $NB/components/admin/ConfirmDialog.tsx $NB/lib/ui/error-text.ts

c "fix(R12-2b): navigace — Inscenace v menu, promo kódy z Marketingu, nástroje termínu z karty, mobilní menu, role pokladny

- Inscenace (dřív jen Vše → Produkce a reprízy), odkaz Promo kódy na stránce Marketing (F1)
- mobil: menu se otevírá tlačítkem Menu, nezabírá 240 px z 390 (F11)
- role box_office (Pokladna): provozní menu jako staff a na serveru stejné omezení *NonStaff
  (dřív finance/nastavení/tým jako správce) — zpřísnění; role česky (Vlastník, Správce, Pokladna,
  Vstup a provoz), Pokladna nabízená při pozvání (F10)
- hlavička Administrace / role; hlavní nadpis stránky h1 (PageHeader)" \
  $NB/lib/admin/nav.ts $NB/components/admin/Sidebar.tsx $NB/components/admin/Topbar.tsx $NB/components/admin/PageHeader.tsx \
  $NB/app/admin/layout.tsx $NB/app/admin/marketing/page.tsx $NB/lib/admin-auth.ts \
  $NB/app/admin/staff/page.tsx $NB/app/api/admin/staff/route.ts "$NB/app/api/admin/staff/[userId]/route.ts" $NB/app/admin/team/page.tsx

c "fix(R12-2c): seznam akcí — město a sál, zrušený termín „Zrušeno\", jen denní akce česky (F2)

Dřív 3× „Racek\" bez města (pokladní otevřela špatný termín), zrušený termín se štítkem „Prodej\",
14 odkazů na řádek (Add-ons, Live, Member pricing, Dynamic…) — nástroje jsou v záložkách termínu." \
  $NB/app/admin/events/page.tsx $NB/app/api/admin/events/route.ts $NB/types/admin.ts

c "fix(R12-2d): blokace — bez volných míst se nezaloží prázdná, uvolnění s potvrzením, stavy česky (F3)" \
  "$NB/app/admin/events/[id]/blokace/page.tsx" $NB/lib/theatre/blocks.ts

c "fix(R12-2e): firemní objednávka — zaplacení a zrušení potvrzením v aplikaci (ne prompt), místa číselně (F4)" \
  "$NB/app/admin/events/[id]/firemni/page.tsx"

c "fix(R12-2f): přesun termínu — potvrzení s důsledky (e-mail všem kupcům) (F5)" \
  "$NB/app/admin/events/[id]/zruseni/page.tsx"

c "fix(R12-2g): promo kódy — potvrzení vytvoření, kategorie názvem, chyby česky (F6)" \
  $NB/app/admin/promo-codes/page.tsx $NB/app/api/admin/promo-codes/route.ts

c "fix(R12-2h): termín v sále bez míst v cenových zónách se nezaloží (dřív „v prodeji, 0 míst\") (F7)

Editor plánku při uložení upozorní, kolik míst nemá cenovou zónu." \
  $NB/lib/theatre/terms.ts "$NB/app/api/admin/productions/[id]/terms/route.ts"

c "fix(R12-2i): editor plánku česky, Zpět do knihovny míst (dřív 404), odkaz z knihovny na editor (F8)" \
  "$NB/app/platform/venues/[id]/seating-chart/editor/VisualEditor.tsx" "$NB/app/admin/venues/[venueId]/seating-chart/editor/page.tsx" \
  $NB/app/admin/venues/page.tsx

c "fix(R12-2j): inscenace — obsazení po řádcích, fotka souborem, přímé odkazy na nástroje termínu, chyby česky (F1, F9)" \
  "$NB/app/admin/productions/[id]/page.tsx" $NB/app/admin/productions/page.tsx

c "fix(R12-2k): pokladna — česky, termín s městem, rezervace k vyzvednutí, tisk vstupenek s QR (F10)

Dřív se tiskl souhrn s ID a TOTP tajemstvím vstupenky (bez QR) — tajemství na papír nepatří.
Po zaplacení rezervace tlačítko tisku vstupenek (dřív chybělo)." \
  $NB/app/admin/pos/page.tsx $NB/app/api/admin/pos/events/route.ts "$NB/app/admin/events/[id]/rezervace/page.tsx"

c "fix(R12-2l): skener — velké barevné stavy, zvuk a vibrace (i jiný termín), výpadek sítě neověřené nepouští na zelenou (F11)

- ScanState: VSTUP POVOLEN / OVĚŘTE PRŮKAZ / JINÝ TERMÍN / UŽ POUŽITO …, na mobilu panel u spodního okraje
- výpadek sítě během ověření: ověření proti staženému seznamu; bez seznamu oranžové „OVĚŘTE RUČNĚ\"
  (dřív zelené „vpuštěno\" bez jakékoli kontroly)
- QR z kamery se ověří hned; texty česky (bez TOTP, payload, Scanner); stav vstupenky česky" \
  $NB/app/admin/scanner/page.tsx $NB/app/admin/scanner/ScanState.tsx $NB/app/api/admin/scanner/validate/route.ts

c "fix(R12-2m): web — odkaz Program (podle měst) v hlavičce, „Pokračovat k objednávce\" (F12)" \
  $NB/components/public/TopNav.tsx "$NB/app/[locale]/events/[id]/seats/SeatPicker.tsx" \
  "$NB/app/[locale]/events/[id]/slots/SlotPickerClient.tsx" "$NB/app/[locale]/lottery/redeem/LotteryRedeemClient.tsx"

c "fix(R12-2n): slevové kategorie — kód se doplní z názvu; reporty — chyba stažení se ukáže

Dřív povinný technický kód kategorie; nepovedené stažení CSV/PDF neřeklo nic." \
  "$NB/app/admin/events/[id]/kategorie/page.tsx" "$NB/app/admin/events/[id]/reporty/page.tsx"

c "test(R12-2): opravy F1–F12 GREEN 12/12; UX průchod před (původní kód) a po; turné a nákup na nové texty

- golden-path-r12-ux-fixes: RED 12/12 → GREEN 12/12
- průchod před (d0bbcb00 z čistého klonu) a po: logs/r12/before, logs/r12/after
- turné: potvrzovací okna (zaplacení firmy, uvolnění blokace), Uložit plánek, TOUR_SHOTS" \
  e2e/tests logs/r12
