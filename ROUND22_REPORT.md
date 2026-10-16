# Kolo 22 — report (2026-10-15)

Cíl kola: obnovit CI po zveřejnění repozitáře a dostat tajemství pryč z api.qrserver.com (TOTP secret 2FA, QR vstupenky z dárku).
Větev `fix/round22-qr-local-2026-10-15`, PR #19 → `integrate/2026-10-04` — **nesloučen** (Vercel hlásí „Deployment was blocked").
Průběh je v `PROGRESS_R22.md`, logy v `logs/r22/`.

## 1. Krok 0

- **HEADy:** integrate/2026-10-04 lokálně = origin = `6799fb5b` (6799fb5be2416438648b2ce9d82ef16585f5f628). Lokální master `3ab73410`
  je záměrně jiný a nezměnil jsem ho, origin/master je `d4b43f4f`. fix/round18-staging-2026-10-14 je na `716fe3c9` (= očekáváno, beze změny).
- **Viditelnost repa:** `{"visibility":"PUBLIC"}`.
- **Cizí commity** po 6799fb5b: na integrate ani na master žádné. **Necommitnuté změny:** žádné.
- **Rerun 4 workflow na 6799fb5b** (`gh run rerun <id> --failed` → attempt 2, `logs/r22/0_ci_rerun.txt`). Joby skutečně běžely:

  | workflow | run | výsledek | joby (délka, počet kroků) |
  |---|---|---|---|
  | CI | 38746784038 | success | Install·typecheck·lint·unit 2 min 40 s (10), Live sada 3 min 8 s (14), Build bez sítě 2 min 54 s (9) |
  | Security | 38746784127 | success | Gitleaks 12 s (5), Dependency audit e2e 16 s / mobile 46 s / mobile-promoter 52 s / nextjs-boilerplate 1 min 31 s (8) |
  | RLS Gate | 38746784318 | success | RLS verify (DB z migrací) 1 min 5 s (11); produkce skipped (záměrně) |
  | Schema Drift Guard | 38746784037 | success | Schema drift 1 min 8 s (11) |

- **Vercel na 6799fb5b** (`logs/r22/0_vercel.txt`): pro Vercel – nextjs-boilerplate ani Vercel – tixly neexistuje žádný commit status
  ani nasazení (projekty jsou pozastavené). Ve Vercelu jsem nic nespouštěl.
- **PR #2 po rerunu:** OPEN, MERGEABLE, **CLEAN**. Všechny kontroly pass, „RLS verify (produkce)" skipping (záměrně), Vercel checky chybí.
- **staging.keys.env:** neexistuje; `git check-ignore` → `.gitignore:105:staging.keys.env`.
- **Ověření Kola 21** (`logs/r22/0_verify_r21.txt`): unit r21 + r14 + r19 **28 passed**; golden-path-r21-sentry-url-tokens **1 passed**.

## 2. Krok 1 — žádné tajemství na api.qrserver.com

Spec `e2e/tests/golden-path-r22-qr-local.spec.ts` běží nad `next start` s r22demo z migrací a seedem (role tixly_app, RLS). Každý požadavek
prohlížeče na jiného hostitele než localhost/127.0.0.1 se zaznamená a zahodí přes `route.abort()`. 2FA setup a verify i nákup, platba
a uplatnění dárku jdou přes skutečné API aplikace (platba přes simulátor GoPay :3998). Mezi RED a GREEN jsem spec neměnil.

| bod | RED (`logs/r22/1_red.txt`) | GREEN (`logs/r22/1_green.txt`) | commit |
|---|---|---|---|
| (a1) | FAIL — 1 požadavek na api.qrserver.com, nesl tajemství (otpauth + secretBase32) | PASS — 0 požadavků mimo localhost, 0 s tajemstvím, 0 na qrserver | RED `23b932fd`, GREEN `5696a8f5` |
| (a2) | FAIL — src = URL qrserveru (zahozeno), natural 0×0 | PASS — data:image/png 180×180, pixely = toDataURL(otpauth), třídy `h-44 w-44` | 〃 |
| (a3) | PASS — verify 200, záložní kódy se zobrazily | PASS — verify 200, záložní kódy se zobrazily | 〃 |
| (b1) | FAIL — 1 požadavek na api.qrserver.com, nesl tajemství (qrPayload + jeho secret; token dárku ne) | PASS — 0 požadavků mimo localhost, 0 s tajemstvím, 0 na qrserver | 〃 |
| (b2) | FAIL — src = URL qrserveru (zahozeno), natural 0×0 | PASS — data:image/png 220×220 (width/height 220), pixely = toDataURL(qrPayload) | 〃 |

**Změna `nextjs-boilerplate/src/app/admin/settings/TwoFactorSettings.tsx`** (diff v `logs/r22/1_fix_diff.txt`):
- JSDoc bod 3 před: `UI ukáže QR (otpauth qrcode přes externí službu nebo manual code) + input pro 6 cifer`
  → po: `UI ukáže QR (otpauth URL vygenerovaný lokálně v prohlížeči knihovnou qrcode, nikam se neposílá) / nebo manual code + input pro 6 cifer`.
- Přidáno `import QRCode from 'qrcode';` (za lucide-react, aby sedělo import/order).
- Řádky 127–130 před:
  ```ts
  // Záložní QR generator přes externí službu (zatím — produkčně vlastní)
  const qrUrl = setupData
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(setupData.otpauth)}`
    : null;
  ```
  Po (řádky 129–146):
  - nový komentář: „QR z otpauth URL (obsahuje TOTP secret) generujeme lokálně v prohlížeči — nikdy ne přes externí službu. Když generování selže, QR se nezobrazí a zůstane ruční kód.";
  - nový stav `useState<string | null>` `qrSrc`;
  - `useEffect` nad `setupData` volá `QRCode.toDataURL(setupData.otpauth, { width: 180, margin: 4 })` a výsledek uloží přes `setQrSrc`; při chybě uloží `null`, při změně `setupData` stav uklidí.
- V renderu před: `{qrUrl ? (… <img src={qrUrl} …`. Po: `{qrSrc ? (… <img src={qrSrc} alt="QR kód 2FA" className="h-44 w-44" />`.

**Změna `nextjs-boilerplate/src/app/[locale]/gift/[token]/page.tsx`** (`QRDisplay`):
- Přidáno `import QRCode from 'qrcode';`.
- Před:
  ```ts
  useEffect(() => {
    const size = 220;
    const encoded = encodeURIComponent(payload);
    setQrSrc(`https://api.qrserver.com/v1/create-qr-code/?data=${encoded}&size=${size}x${size}&margin=4`);
  }, [payload]);
  ```
  Po:
  - `QRCode.toDataURL(payload, { width: size, margin: 4 })` → `setQrSrc`; když se payload změní, rozpracované generování se zahodí;
  - při chybě se nastaví `qrFailed` a komponenta vrátí `null`;
  - než se QR vygeneruje, zůstává jako dřív animovaný čtverec 220×220;
  - `<img>` (alt, 220×220, třídy) je beze změny.

**Parametry `toDataURL`:** 2FA `{ width: 180, margin: 4 }`, dárek `{ width: 220, margin: 4 }`, v testu stejné. Shodu obrázku test ověřuje
porovnáním dekódovaných pixelů RGBA a rozměrů (pngjs, závislost qrcode). Bajtově se řetězce data URL liší (`řetězec shodný: false`),
protože prohlížeč kóduje PNG přes canvas a Node přes pngjs. Pixely jsou shodné.

**grep `api.qrserver.com` v nextjs-boilerplate/src po opravě:** jediný výskyt je `src/app/admin/events/[id]/kiosk-display/page.tsx:21`
(veřejná URL kiosku, záměrně beze změny).

**Porovnání snímků** (`logs/r22/shots/1_{red,green}_{a2_2fa,b2_gift}.png`, QR a ruční kód jsou zamaskované): umístění ani velikost QR
se nezměnily.
- 2FA: box {x 672, y 370, 176×176} je v RED i GREEN stejný; pixelový rozdíl snímků 5 px na levém okraji pole pro kód, tedy mimo QR.
- Dárek: box {x 530, y 387, 220×220} je v RED i GREEN stejný; pixelový rozdíl 0 px.
- V RED se obrázek nenačetl (natural 0×0), v GREEN má 180×180 / 220×220.

Lint obou souborů hlásí stejné nálezy jako před změnou: v gift už dřív byla 1 chyba import/order (Badge), ostatní jsou starší warningy.
tsc 0. Žádné nové závislosti, žádné migrace; Next zůstává na 15.5.x a `images.unoptimized: true` je beze změny.

## 3. Kompletní sada, CI, Vercel, PR

| položka | výsledek | log |
|---|---|---|
| migrace od nuly | FAILED_FILES=0 (r22a, 5 sestavení) | `9_build_db_r22a*.txt` |
| typecheck | 0 chyb | `9_tsc.txt` |
| lint | 967 (baseline 1008, nevzrostl) | `9_lint.txt` |
| unit | 735 passed + 13 skip (80 souborů) | `9_unit.txt` |
| live po částech | 487 passed + 1 skip (n00 83, n01 49, n02 73, n03 40, g00 163+1, g01 77, webhook_pool 2) | `live/*.txt` |
| build | OK (kód src = 5696a8f5) | `1_green_build.txt` |
| build bez sítě (čistý klon 5696a8f5) | OK | `9_build_no_network.console.txt` |
| audity 01–12 vč. 07b, 08 | 0 FAIL (07b: 0 zápisů) | `9_audits_summary.txt` |
| turné | 10/10 (3. pokus) | `9_tour.txt`, `tour/` |
| golden r13-keep / r16 / r20 / r21 | 10 / 12 / 3 / 1 = 26 passed | `9_golden_summary.txt` |
| offline skener | 6/6 | `9_offline.txt` |
| Gitleaks lokálně | 5 testovacích fingerprintů → .gitleaksignore, pak „no leaks found" | `9_gitleaks_triage.md` |

**CI na PR #19** (head 81c10d35, `logs/r22/9_pr19.txt`):
- Install·typecheck·lint·unit pass (2m6s), Live sada pass (3m28s), Build bez sítě pass (3m6s), Schema drift pass (1m14s).
- Ruční **Security 38808029421 success** (Gitleaks + Dependency audit ×4).
- Ruční **RLS Gate 38808034534 success** (RLS verify z migrací; produkce skipped).

**Vercel – nextjs-boilerplate: FAIL** a **Vercel – tixly: FAIL**. Přesná hláška commit statusu: **„Deployment was blocked"**.
Nasazení dpl_GX4M8qzDnLvWBxfSuaxnXhKxk392 a dpl_EDCypFDSddWZHGVFGm92PEvS7FTU jsou ve stavu `BLOCKED` a build vůbec neproběhl.
API důvod neuvádí; odpovídá to pozastaveným projektům.

**PR #19 jsem nesloučil** (pravidlo zadání). Integrate zůstává na **`6799fb5b`**, žádný nový commit na integrate nepřibyl;
ROUND22_REPORT.md je na větvi PR. Lokální tixly/ je na větvi `fix/round22-qr-local-2026-10-15`.
**PR #2:** OPEN, MERGEABLE, **CLEAN**, head 6799fb5b, všechny kontroly pass (produkce skipping, Vercel checky chybí).

**Co musí udělat vlastník:**
1. Ve Vercelu obnovit (Resume) projekty `nextjs-boilerplate` a `tixly`, nebo rozhodnout, že Vercel na PR nebude podmínkou sloučení.
2. Na PR #19 znovu spustit nasazení (Vercel → Deployments → Redeploy, nebo nový push) a počkat, až budou Vercel – nextjs-boilerplate
   i Vercel – tixly zelené.
3. Sloučit `gh pr merge 19 --merge`, v tixly/ spustit `git checkout integrate/2026-10-04 && git pull --ff-only` a ověřit, že PR #2 je CLEAN.

## 4. Co nebylo ověřeno a proč

- **Sloučení PR #19, fast-forward integrate a PR #2 s kódem kola 22** — neproběhlo kvůli zablokovaným nasazením Vercel (viz výše).
- **Build ve Vercelu** pro kolo 22 neproběhl (BLOCKED). Lokální build i CI build bez sítě prošly.
- **Bajtová shoda data URL** s `QRCode.toDataURL` v Node nejde (jiný PNG kodér). Ověřil jsem shodu dekódovaných pixelů a rozměrů.
  QR jsem nenaskenoval skutečnou aplikací (Authenticator) ani dekodérem QR.
- **Větev s chybou generování QR** (toDataURL vyhodí výjimku) test nepokrývá, je ošetřená jen v kódu (2FA: QR se skryje a ruční kód
  zůstane; dárek: nic se nevykreslí).
- **Administrátor ze seedu** je účet demo pořadatele `demo@tixly-staging.test`, protože seed-demo nemá platform admina. Test mu po
  ověření 2FA zase vypne přes `/api/admin/2fa/disable` (200).
- **Nákup dárku** nešel kliknutím v SeatPickeru: demo termíny mají slevové kategorie, takže SeatPicker vede na /seats/kategorie, kde
  volba dárku není. Test proto podrží místo přes API aplikace (`POST /api/events/<id>/seats/hold`, stejně jako SeatPicker) a otevře
  `/cs/checkout?…` se stejnými parametry, jaké SeatPicker skládá pro termín bez kategorií. Volba „Kupuji jako dárek", platba
  v simulátoru GoPay i uplatnění dárku jsou skutečné.
- **Snímky jsou zamaskované**, protože QR i ruční kód nesou tajemství. Obsah QR na nich vidět není; polohu a velikost dokládají čísla.
- **Turné** prošlo až na 3. pokus:
  - 1. pokus selhal v testu 3 na souběhu v testu blokací (`9_tour_try1.txt`): `blokace/page.tsx` vynuluje název až po `await load()`,
    ale test už mezitím vyplnil další název. Tuto stránku kolo 22 nemění.
  - 2. pokus nedoběhl, protože Docker/WSL VM byl ve 22:33:11 ukončen zvenčí (procesy ve WSL skončily s exit 143), ne touto session.
  - Docker Desktop jsem znovu spustil a nastartoval `fix-pg`, `fix-redis`, `fix-mail`. Kontejnerů jiného projektu `fm-*` jsem se
    nedotkl, po restartu Dockeru neběží.
- Při triáži Gitleaks se mi do konverzace dostala hodnota jednoho testovacího `shareToken` party-split z lokální DB r22a (localhost,
  databáze se znovu zakládá). Do repozitáře se nad rámec už commitnutého logu nedostala a skutečné tajemství to není.
