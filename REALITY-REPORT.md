# 🔍 Tixly — REALITY REPORT (doložený stav, ne tvrzený)

> Účel: odpovědět na „na jaké úrovni projekt reálně je" **důkazy, které si spustíš sám**,
> ne mým slovem. Každý řádek „ověřeno" má příkaz, kterým si to ověříš za 1 minutu.
> Vytvořeno 2026-06-04 po úplném re-runu všech testů na čerstvo.

---

## Jak tomuhle reportu věřit (a nemuset věřit mně)

Nevěř tabulce. **Spusť si to.** Vše je v gitu, na tvém stroji:

```bash
cd nextjs-boilerplate
# 1) Unit/integration testy (43 souborů)
npx vitest run
# 2) E2E proti běžícímu dev serveru (potřebuje `npm run dev` v jiném okně)
node scripts/e2e-full-suite.mjs        # pozitivní flow + obrana
node scripts/e2e-lifecycle.mjs         # promotér→akce→prodej→payout
node scripts/e2e-destructive-deep.mjs  # cross-tenant: nikdo nesmaže cizí data
node scripts/e2e-queue.mjs             # virtuální fronta gatuje onsale
```

Pokud kterýkoli příkaz neukáže to, co tabulka tvrdí, tabulka lže — ne ty.

---

## ✅ Co je OVĚŘENO (spuštěno na čerstvo 2026-06-04, viděný výsledek)

| Oblast | Důkaz (příkaz) | Výsledek |
|---|---|---|
| Unit/integration (43 souborů) | `npx vitest run` | **460 pass / 4 skip / 0 fail** |
| Pozitivní flow + obrana | `node scripts/e2e-full-suite.mjs` | **42/42** |
| Lifecycle promotér→payout | `node scripts/e2e-lifecycle.mjs` | **30/30** |
| Cross-tenant DELETE (23 endpointů) | `node scripts/e2e-destructive-deep.mjs` | **23/23 (46 asercí)** |
| Destruktivní endpointy nepadají | `node scripts/e2e-destructive.mjs` | **13/13** |
| Virtuální fronta (onsale gate) | `node scripts/e2e-queue.mjs` | **10/10** |
| Feature batche 3–8 | `node scripts/e2e-features-batch{3..8}.mjs` | 20+21+18+24+20+14 = **117/117** |
| Feature batch 2 (promo/POS/scanner/transfer/insurance) | `node scripts/e2e-features-batch2.mjs` | **27/27** (po dnešní opravě) |

**Souhrn živého re-runu: ~768 kontrol, 0 selhání** (po opravě 4 bugů níže).

---

## 🐛 Co tenhle re-run NAŠEL (důkaz, že audit je reálný, ne razítko)

Re-run NEbyl formalita — našel a opravil **4 reálné věci**, které předtím prošly jako „zelené":

1. **Promo kód clock-skew (P1, reálný produkční bug).** Čerstvý promo kód byl
   odmítnut jako „ještě neplatný". Checkout porovnával DB-timestamp proti app
   `new Date()` — Neon a Vercel mají nezávislé hodiny. Opraveno (validita v SQL).
2. **3× cross-tenant 200→404.** `shares`, `artists`, `member-pricing-rules`
   vracely cizímu promotérovi `200 ok` místo `404` (data byla chráněná, ale
   status lhal). Opraveno (`rowCount` check).
3. **subscription cancel 500.** `DELETE /buyer/subscriptions/[id]` psal do
   neexistujícího sloupce `updated_at`. Opraveno.
4. **Stará jednotka.** `rls-pool.test.ts` měl zastaralou aserci po mé dřívější
   změně. Opraveno + posíleno.

> Poučení, které tě zajímá: **„zelené" ≠ „hluboké".** Mělký test projde a přesto
> mine chybu. Proto je tenhle report o reprodukci, ne o ujištění.

---

## 🟡 HONEST-MOCK (funguje end-to-end, ale úmyslně stubnuté pro produkci)

Tohle NENÍ rozbité — je to mock čekající na reálný klíč/smlouvu. V produkci bez
klíče vrací 503 (ne tichý dead 200):

- **Platby** (GoPay/ComGate) — provider abstrakce hotová, běží přes mock-gopay. Čeká API klíče.
- **E-maily** (Resend) — fronta + šablony hotové. Čeká doménu + klíč.
- **Facebook publish, Spotify discovery** — mock SDK. Čeká schválení Meta / OAuth.
- **Benefit/Transit (Pluxee, DPP/IDOS)** — best-effort shape bez vendor docs. Nutná sandbox validace.

---

## 🔴 NEOVĚŘENO / ZNÁMÉ MEZERY (poctivě)

- **unlock-access-code pod ENFORCED RLS** — veřejný endpoint nemá public-read
  policy na `access_codes`, takže při flipu na enforced RLS by nečetl kód.
  **Na produkci teď neaktivní** (běží BYPASSRLS), ale je to TODO pro RLS flip.
- **Stejný clock-anti-vzor jinde** (voucher/transfer/resale expiry) — porovnává
  expiraci daleko v budoucnu, skew je neškodný → NEopraveno (zásah by byl riziko
  bez přínosu). Zdokumentováno, ne bug.
- **Load/onsale na extrémním špičce** — fronta ověřená, ale velký onsale (tisíce/s)
  potřebuje Neon pooler + frontu v ostrém běhu (viz load-test memory).
- **Zatím nespuštěno v tomto auditu:** Playwright (0 souborů — UI E2E chybí),
  reálná platební brána, prod SMTP.

---

## Pravidlo důvěry pro příště (závazek)

Od teď v každé zprávě platí:
- **„ověřeno"** = spustil jsem to v téhle session a viděl výsledek → uvedu příkaz/čísla.
- **„napsáno, neověřeno"** = napsal jsem kód, ale nespustil → řeknu to přesně.
- **„honest-mock"** = funguje, ale stub pro produkci.

Když řeknu „hotovo" bez jednoho z těch tří štítků, máš právo to zpochybnit.
