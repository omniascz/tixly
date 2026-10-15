# Kolo 19 — triáž Gitleaks (Security, ruční běh 38699352187 na d39f301e)

Pravidlo `generic-api-key`, 2 místa (gitleaks je hlásí opakovaně pro každý výskyt na řádku):

| fingerprint | co to je | verdikt |
|---|---|---|
| `d39f301e…:audit/logs/r19_e2e_03_refund_scan.jsonl:generic-api-key:4` | `evidence.audit_log[*].new_values.idempotency_key` — náhodné UUID (36 znaků) testovací objednávky auditu 03 v lokální DB r19a (DB z migrací, po auditu zahozena); stejný typ nálezu jako `audit/logs/r2_e2e_03_refund_scan.jsonl:4` v kole 5 | testovací, není tajemství |
| `d39f301e…:logs/r19/fixture_offline.json:generic-api-key:1` | fixture specu offline skeneru: `gate` (token brány skeneru) a `t.*.secret` (QR tajemství testovacích vstupenek) z lokální demo DB r19demo — DB se před každým během zakládá znovu (`create.sh --local`), hodnoty nikde jinde neplatí | testovací, není tajemství |

Skutečné tajemství: 0. Hodnoty se nevypisují (triáž jen podle názvů klíčů a délek).

## 2. Ruční běh 38699774752 na 608d5fae — sken celé historie

`workflow_dispatch` spouští `gitleaks detect` nad `git log --all` (všechny větve), ne jen nad rozsahem PR jako `pull_request`.
Proto běh hlásí i starší nálezy z kol 9–16, které PR #2 (režim `pull_request`) neviděl. Stejný sken celé historie selhal už
2026-10-12 v plánovaném běhu na master (38259676729, 387 nálezů), tedy před kolem 19.
Běh 38699774752: 326 hlášení = 53 fingerprintů, které ještě nebyly v `.gitleaksignore`. Všechny jsou `generic-api-key`:

| commit | soubory | co to je (podle názvu klíče, hodnoty nevypisovány) | verdikt |
|---|---|---|---|
| d39f301e (kolo 19), a91bf5d8 (16), 03fbdd88 (15), 168be0ca (14) | `logs/rNN/live/g01.txt`, `n03.txt`, `logs/r14/9_live.txt` | výstupy live testů: `shareToken` (party-split), `token` převodu vstupenky, `token` v těle požadavku testu; lokální DB z migrací, po běhu zahozena | testovací |
| eca1afc3 (14) | `logs/r14/4_neon_converted_run2/3.txt` | tentýž typ výstupu live testů (party-split, převod vstupenky) | testovací |
| 715c3c32 | `audit/logs/r8–r16_e2e*_03_refund_scan.jsonl:4` | `idempotency_key`, `gift_redeem_token` testovacích objednávek auditu 03 — stejný typ jako r2 v kole 5 a r19 v triáži 1 | testovací |
| 715c3c32 | `logs/r14–r16/fixture_*.json:1` | fixture offline skeneru: `gate`, `t.*.secret` z lokální demo DB — stejný typ jako `logs/r19/fixture_offline.json` | testovací |
| fbf71b5e | `scripts/staging/vercel-preview.env.example:33` | `GOPAY_CLIENT_SECRET=` s prázdnou hodnotou (detektor reaguje na název) | falešný |

Skutečné tajemství: 0.
