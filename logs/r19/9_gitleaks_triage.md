# Kolo 19 — triáž Gitleaks (Security, ruční běh 38699352187 na d39f301e)

Pravidlo `generic-api-key`, 2 místa (gitleaks je hlásí opakovaně pro každý výskyt na řádku):

| fingerprint | co to je | verdikt |
|---|---|---|
| `d39f301e…:audit/logs/r19_e2e_03_refund_scan.jsonl:generic-api-key:4` | `evidence.audit_log[*].new_values.idempotency_key` — náhodné UUID (36 znaků) testovací objednávky auditu 03 v lokální DB r19a (DB z migrací, po auditu zahozena); stejný typ nálezu jako `audit/logs/r2_e2e_03_refund_scan.jsonl:4` v kole 5 | testovací, není tajemství |
| `d39f301e…:logs/r19/fixture_offline.json:generic-api-key:1` | fixture specu offline skeneru: `gate` (token brány skeneru) a `t.*.secret` (QR tajemství testovacích vstupenek) z lokální demo DB r19demo — DB se před každým během zakládá znovu (`create.sh --local`), hodnoty nikde jinde neplatí | testovací, není tajemství |

Skutečné tajemství: 0. Hodnoty se nevypisují (triáž jen podle názvů klíčů a délek).
