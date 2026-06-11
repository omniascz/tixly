# 🗺️ Tixly — mapa webu pro testování

> Dev server: **http://localhost:3000** · ~179 stránek (63 veřejných, 100 promotér-admin, 16 master-admin).
> Tohle je pracovní demo — **počítej s chybami**, to je smysl testu. Co najdeš, pošli a opravím.
> Aktualizováno 2026-06-04.

## 🔑 Přihlášení (vše heslo `Demo2026!`)
| Role | Email | Po loginu |
|---|---|---|
| 👑 Master admin | `superadmin@tixly.cz` | `/platform` |
| 🎭 Promotér (3 akce, sedačky) | `theatre@hranice.cz` | `/admin` |
| 🎭 Promotér (Divadlo Verze, 3 akce) | `verze@divadlovceletne.cz` | `/admin` |
| 🎵 Promotér (klub) | `klub@underground.cz` | `/admin` |

---

## 🛒 1. KUPUJÍCÍ — hlavní flow (otestuj nejdřív, to je jádro)
1. **Landing** → http://localhost:3000/cs — hero hledání, kategorie, nadcházející akce
2. **Výpis akcí** → /cs/events — filtry, kategorie
3. **Hledání** → /cs/search?q=Hamlet
4. **Detail akce + NÁKUP** → /cs/events/romeo-a-julie-demo — panel „Vstupenky" + tlačítka **Koupit**
5. **Checkout** → po „Koupit" (e-mail, jméno, platba přes mock bránu)
6. **Potvrzení** → /cs/order-confirmation/[orderId]
7. **Moje vstupenky** → /cs/my-tickets (po loginu kupujícího)
8. **QR / vstupenka** → /cs/tickets/[ticketId]/show

**Další veřejné:** /cs/about · /cs/contact · /cs/blog · /cs/pricing · /cs/discover · /cs/loyalty · /cs/resale (přeprodej) · /cs/p/divadlo-verze (stránka pořadatele) · /cs/p/divadlo-verze/vouchers (dárkové poukazy) · /cs/legal/terms · /cs/legal/privacy

---

## 🎭 2. PROMOTÉR ADMIN (`theatre@hranice.cz`) — 100 stránek
**Vstup:** /admin (dashboard s tržbami)

**Hlavní:**
- **Akce** → /admin/events — seznam, vytvořit novou (wizard)
- **Vytvořit akci** → /admin/events (tlačítko) — krok za krokem
- **Zákazníci** → /admin/customers
- **Objednávky** → /admin/events/[id] → detail akce má taby
- **Live dashboard** → /admin/dashboard/live (prodej naživo)
- **Výplaty** → /admin/payouts
- **Faktury** → /admin/invoices
- **Refundy** → /admin/refund-requests
- **Nastavení** → /admin/settings · branding, /admin/team (tým)

**Marketing & prodej:** /admin/promo-codes · /admin/ads · /admin/affiliates · /admin/campaigns · /admin/broadcasts · /admin/collections · /admin/vouchers

**Per akce (klikni z detailu akce):** ceny dynamicky, slevy skupinové, sedačky/holds, addony, custom pole, abonmá, donation, accreditation, will-call, QR marketing…

**AI nástroje:** /admin/ai/description · /admin/ai/cover-images · /admin/ai/price-suggestion · /admin/ai/moderation (mock — bez API klíče)

---

## 👑 3. MASTER ADMIN (`superadmin@tixly.cz`) — 16 stránek
**Vstup:** /platform (přehled platformy)

- **Pořadatelé** → /platform/promoters — schvalování, suspend, detail /platform/promoters/[id]
- **Moderace akcí** → /platform/event-moderation — schválit/zamítnout nové akce ⚠️ (tady hlídáš obsah)
- **Analytika** → /platform/analytics
- **Venues** → /platform/venues — sály + editor sedaček /platform/venues/[id]/seating-chart/editor
- **Incidenty** → /platform/incidents
- **Ověření** → /platform/verifications (KYC pořadatelů)
- **Audit log** → /platform/audit-log
- **Webhooks** → /platform/webhooks

---

## ⚠️ Kde čekat chyby (pracovní demo)
- **Platby** = mock brána (žádné reálné peníze) — „zaplať" projde fiktivně.
- **E-maily** se neodesílají (chybí Resend doména) — potvrzení uvidíš jen v appce.
- **AI nástroje** = mock (bez Claude klíče) — vrací ukázková data.
- **Fotky akcí** = dočasné z loremflickr (reálný pořadatel nahraje vlastní plakát).
- **Sedačkové mapy** u některých akcí nemusí být kompletní.
- **Některé pod-stránky** mohou chtít data, co demo akce nemají → prázdno nebo chyba. **To je přesně to, co hledáme.**

## Jak hlásit chybu
Pošli mi: **URL + co jsi dělal + co se stalo** (ideálně screenshot). Opravím a přidám test, ať se to nevrátí.
