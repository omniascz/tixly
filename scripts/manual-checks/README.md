# Ruční kontroly (NEJSOU migrace)

Tyhle SQL soubory **nesmí ležet v `migrations/`**. Do 2026-07-30 tam byly a
`.github/workflows/deploy.yml:87` je globem `migrations/*.sql` pouštěl
**na produkci při každém deployi**.

## Proč to bylo nebezpečné

- `test_delete_safety.sql` si na `:19-26` vybere **skutečné produkční řádky**
  (`SELECT … FROM catalog.events JOIN orders JOIN tickets WHERE o.status='paid' LIMIT 1`)
  a pokouší se mazat z `identity.users`, `catalog.events` a `platform.promoters`.
- `test_feature_interaction_audit.sql` dělá 10 UPDATEů na reálných řádcích
  (`catalog.events`, `tickets.tickets`, `orders.orders`).

Před trvalým poškozením je chránil **jediný `ROLLBACK;` na konci souboru**.
Žádná pojistka pro přerušený běh, žádný `ON_ERROR_STOP`, a deploy krok
zezelenal i tak (psql bez `ON_ERROR_STOP` vrací exit 0 i po chybě).

`test_big_health_check.sql` je read-only, ale patří sem taky — do `migrations/`
nemá co dělat nic, co není migrace.

## Jak je pustit

Ručně, vědomě, a **NE proti produkci** — proti ephemeral klonu:

```bash
psql "$CLONE_URL" -v ON_ERROR_STOP=1 -f scripts/manual-checks/test_delete_safety.sql
```

Všechny tři jsou obalené `BEGIN; … ROLLBACK;`, takže po sobě neuklízejí nic —
ale to je vlastnost souboru, ne záruka prostředí.
