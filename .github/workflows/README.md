# CI kontroly schématu — tři různé nástroje, tři různé slepoty

Vypadají zaměnitelně („něco kontroluje databázi"), ale **každý vidí jinou
vrstvu a žádný nevidí to, co ostatní**. Zelená z jednoho nikdy neznamená, že je
v pořádku to, co hlídá druhý. Tahle tabulka je tu proto, aby je příště nikdo
nezaměnil ani jeden nezrušil jako „duplicitní".

| | `schema-drift-guard` | `schema-reality-scan` | `rls-verify` (gate) |
|---|---|---|---|
| **kdy běží** | každý commit / PR | nightly (drahý — staví klon) | **před každým deployem** + nightly |
| **proti čemu** | `PREPARE` nad schématem | reálné schéma z `information_schema` + `pg_*` | `rls-snapshot.json` (z migrací) |
| **vrstva** | parse | schéma a granty | RLS policies |
| **co najde** | `42703`, `42P01` — sloupec/tabulka neexistuje | `23502`, `42P10`, `23514`, chybějící granty | chybějící/přebývající/změněná policy, vypnuté RLS, role ≠ `{public}`, helper bez `SECURITY DEFINER` |
| **co NEVIDÍ** | cokoli, co se vyhodnotí až za běhu | RLS, data, defaulty, **dynamické SQL (135 dotazů)** | schéma, sloupce, granty, výkon |

## Proč nestačí dva z nich

Doloženo tím, jak se nálezy v tomhle projektu **nepřekrývaly**:

- grantovou vrstvu našel **jen sken** (6 nálezů, které guard ani live sada
  neviděly — `FINDINGS §33`)
- RLS vrstvu našel **jen běh pod aplikační rolí** (6 pádů, které sken
  neviděl — `§31`, `§34`)
- `base64url` v `DEFAULT` **nenašel ani jeden** — vypadlo to při seedu testu,
  který hledal něco úplně jiného (`§35`)

## Proč `rls-verify` musí být tvrdá podmínka deploye

`BUNDLE_340-348_prod.sql` byl dosud jediné, co drift RLS vracelo zpět —
pouštěl se opakovaně a přepisoval, co se rozešlo. **Baseline se aplikuje
jednou**, takže ta samoopravná vlastnost mizí. Bez gate se drift projeví až
tím, že aplikace přestane vidět data — nebo je začne vidět všem.

Gate proto porovnává živou DB proti `rls-snapshot.json` vygenerovanému
**z migrací**, ne z produkce. Kdyby se snapshot bral z produkce, porovnával by
realitu proti realitě a drift by posvětil.

### Regenerace snapshotu (po každé migraci, která mění RLS)

```bash
# klon s baseline + 453/454/455, pak:
node scripts/rls-verify.mjs --snapshot --url="<clone-uri>"
git add nextjs-boilerplate/rls-snapshot.json
```

## Pravidlo: nula z nástroje není nález, dokud není doložená

Ke každé kontrole patří **self-check** — test, který jí podstrčí známý nález
té třídy, kterou má hledat, a ověří, že ho najde (`FINDINGS §54`).
U `rls-verify` je doložený: na klon se vloží dropnutá policy, změněný `USING`,
vypnuté RLS a helper vrácený na `INVOKER` — gate musí najít **všechny čtyři**
a skončit nenulovým kódem (`§58`).

Bez self-checku je „0 nálezů" jen mlčení. V tomhle projektu takhle lhal
guard („pokrytí 94,7 %"), sken pod ownerem, live sada i první verze
`rls-nested-scan` („přes funkci: 0").
