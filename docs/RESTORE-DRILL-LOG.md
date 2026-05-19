# Restore drill log

Monthly drills per RUNBOOK-DISASTER-RECOVERY.md §5. Každý drill = nová řada.
Cíl: ≤ 45 min od stažení po validaci, ≤ 5 min discrepancy proti produkci.

| Datum | Operator | Backup file | Stažení | Restore | Validation | Celkem | Discrepancy | Notes |
|---|---|---|---|---|---|---|---|---|
| TBD | — | — | — min | — min | — min | — min | — | první drill po launch |

---

## Šablona záznamu (skopíruj při dalším drilu)

```
| 2026-MM-DD | Omnia | tixly-2026-MM-DD.dump | 3 min | 12 min | 8 min | 23 min | 0 rows | Plynulý průběh, žádné incidenty. |
```

## Akce při neúspěchu drilu

1. Drillův výsledek > 45 min → P2 ticket
2. Discrepancy v countech > 0 řádků → P1 ticket
3. Restore failure → P0 — backup je k ničemu, fixuj okamžitě

## Audit cadence

- Měsíčně: drill
- Kvartálně: review této tabulky + DR runbooku
- Ročně: full DR simulation (whole stack failover)
