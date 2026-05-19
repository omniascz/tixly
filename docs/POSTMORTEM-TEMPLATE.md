# Incident Postmortem — &lt;short title&gt;

> **Pokyn pro autora:** Vyplň do 5 pracovních dnů od resolution. Blameless —
> popisujeme systém, ne lidi. Cíl: aby se incident nestal podruhé, ne najít viníka.

---

## Metadata

| Pole | Hodnota |
|---|---|
| **Incident ID** | INC-YYYY-MM-DD-### |
| **Severity** | P0 / P1 / P2 |
| **Status** | Resolved / Mitigated / Open |
| **Datum** | YYYY-MM-DD |
| **Detection time** | HH:MM CET |
| **Resolution time** | HH:MM CET |
| **Total downtime** | X min |
| **Affected users** | ~X% promotérů / kupujících |
| **Financial impact** | CZK X (refunds + lost sales) |
| **Author** | jméno |
| **Reviewers** | jména |

---

## TL;DR (3 věty)

Co se stalo, proč, a jak jsme to opravili. Max 3 věty, čitelné pro netechnické členy týmu.

---

## Timeline (vše v CET)

| Čas | Událost |
|---|---|
| HH:MM | Trigger — co první šlo špatně |
| HH:MM | First alert — Sentry / Better Uptime / customer report |
| HH:MM | First responder engaged |
| HH:MM | Severity declared |
| HH:MM | Mitigation step 1 |
| HH:MM | Mitigation step 2 |
| HH:MM | Resolution confirmed |
| HH:MM | Status page incident closed |

---

## Root cause analysis (5 whys)

1. **Why** něco selhalo? — bezprostřední příčina
2. **Why** to selhalo? — technická příčina
3. **Why** technická příčina existovala? — chybějící kontrola / design
4. **Why** chyběla kontrola? — procesní mezera
5. **Why** procesní mezera existovala? — kulturní / strategická příčina

---

## Co fungovalo

- Detection: alert přišel za X sekund
- On-call response: ...
- Communication: ...
- Tooling: ...

## Co nefungovalo

- Detection: alert měl přijít dřív / nepřišel vůbec
- Runbook: byl/nebyl k dispozici, byl/nebyl aktuální
- Tooling: chyběl access k ...
- Communication: ...

## Co bylo štěstí

Faktory mimo naši kontrolu které incident zmírnily a nemůžeme na ně počítat.

---

## Action items

| # | Co | Owner | Due | Issue |
|---|---|---|---|---|
| 1 | Akce — konkrétní změna kódu / runbooku / monitoringu | jméno | YYYY-MM-DD | #N |
| 2 | ... | | | |

**Pravidlo:** Žádný action item = "be more careful". Vše musí být systémová změna
(kontrola v CI, alert, runbook update, automation).

---

## Lessons learned

Klíčové insighty pro tým / pro budoucí design. Nepublikujeme abstrakce —
konkrétní lekci ve dvou větách.

---

## Customer comms

- Status page: link na incident
- Email rozeslán: ano/ne, kolik dotčených, kdy
- Refunds / kredity: částka, počet uživatelů
- Public retrospective (blog post): plán / link
