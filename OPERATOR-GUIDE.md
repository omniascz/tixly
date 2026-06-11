# Tixly — jak řídit svou platformu (lidsky)

Praktický návod bez žargonu. Dvě role: **Master admin** (ty, provozovatel Tixly) a
**Promotér** (pořadatel, co prodává lístky na své akce). Adresy níže jsou pro lokální
běh (`localhost:3000`); na produkci nahraď doménou.

---

## 1. Přihlášení

- **Master admin:** `/platform` — celá platforma (promotéři, sály, moderace).
- **Promotér:** `/admin` — workspace jednoho pořadatele (jeho akce, prodeje, peníze).
- Dev účet: `superadmin@tixly.cz` / `Demo2026!`

> Když uvidíš „401" / vyhodí tě to → vypršela relace, **přihlas se znovu** (token platí ~1 h).

---

## 2. Master admin — co řídíš ty (`/platform`)

Levé menu:
- **Dashboard** — přehled: kolik promotérů, akcí, tržby za 30 dní.
- **Promotéři** — schvaluješ nové pořadatele (registrují se sami → čekají na tvé „approve").
  Tady taky nastavíš provizi/podmínky konkrétnímu promotérovi.
- **Sály a stadiony** — fyzické sály a jejich **plány sedadel** (ty maluješ fyziku sálu,
  promotér si pak vybírá). Plán sálu: `/platform/venues/<id>/seating-chart` —
  3 kroky: jeviště → sektory → „řady X–Y mají Z sedadel". Náhled vpravo.
- **Moderace akcí** — akce označené k revizi (AI gate je předfiltruje); ty dáváš finální OK.
- **Incidenty / Audit log / Webhooks** — provozní přehled, kdo co změnil, integrace.

**Typický flow:** promotér se zaregistruje → ty ho v *Promotéři* schválíš → on si založí akci →
(pokud ji AI gate označí) ji v *Moderace* schválíš → akce je veřejná.

---

## 3. Promotér — jak prodat lístky (`/admin`)

Levé menu (sekce **Akce / Prodej / Přehled / Setup / Finance**):

**A) Založit a publikovat akci**
1. *Akce → Nová akce* — název, datum, místo, popis, kategorie.
2. Přiřaď **sál** (z těch, co master admin připravil) nebo *online/TBD*.
3. Nastav **typy vstupenek a ceny** (např. Přízemí 350 Kč, Balkon 220 Kč) + kapacity.
4. *Publikovat* → akce je veřejně k prodeji na `/cs/events/<id>`.

**B) Sledovat prodej** (*Prodej*)
- *Objednávky* — kdo co koupil, stav platby, refundy.
- *Zákazníci* — kdo nakupuje.
- *Pokladna (POS)* — prodej na místě (hotovost/karta), vytiskne účtenku.
- *Live prodej* (*Přehled*) — co se prodává teď.

**C) U vchodu** (*Prodej → Scanner*)
- Naskenuješ QR z lístku → zelená = vpustit, červená = neplatný/použitý.
- *Skupinové odbavení* — jeden QR odbaví celou objednávku najednou.

**D) Peníze** (*Finance → Výplaty*)
- Vidíš, kolik ti přijde, kdy, po odečtení provize/holdbacku.

**E) Prodávat i jinde** (*Prodej → Embed na web*)
- Zkopíruješ kód → vložíš na svůj web / Shopify → lístky se prodávají i tam
  (platba vždy proběhne na Tixly).

---

## 4. Co kupující vidí (veřejná část)

- `/cs/events` — katalog všech akcí (filtry podle kategorie).
- `/cs/events/<id>` — detail: popis, ceny, „Koupit" → výběr sedadel/množství →
  platba → lístek e-mailem (PDF s QR) + do mobilu/Wallet.

---

## 5. Časté otázky

- **„Promotér se nemůže přihlásit / nevidí akce"** → zkontroluj, že je *schválený*
  (Master admin → Promotéři → status „active").
- **„Akce není vidět ve veřejném katalogu"** → není *published*, nebo čeká na moderaci.
- **„Lístek se nenaskenoval"** → zkontroluj, že nebyl už použitý / nepatří k jiné akci.
- **„Nepřišel e-mail s lístkem"** → potřebuje nastavenou e-mailovou službu (Resend) —
  do té doby lístek najdeš v detailu objednávky / „moje lístky".

---

## 6. Co zatím NEjede naostro (čeká na externí kroky)

- **Reálné platby** — teď mock (testovací); ostré platby až po smlouvě s GoPay/ComGate.
- **E-maily** — až po nastavení Resend + domény.
- **Vlastní doména** — teď `localhost` / Vercel URL.

Do té doby je vše plně funkční pro **interní testování a demo** — můžeš si proklikat
celý prodej s testovací platbou.
