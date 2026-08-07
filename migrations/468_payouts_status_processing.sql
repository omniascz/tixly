--
-- 468_payouts_status_processing.sql — R-31
--   platform.payouts.status: doplnit 'processing' do CHECK vyctu
--
-- ── Proc se enum TENTOKRAT rozsiruje ─────────────────────────────────────────
-- U D4 (audit_log.action) bylo zamcene rozhodnuti opacne — 'BULK_RELEASE' se
-- do vyctu NEPRIDAVALO, protoze to nebyl stav, ale popis operace, a patril do
-- `new_values`. Tady je to jinak: 'processing' JE stav, ne popis. Vyplata jim
-- realne prochazi (approved → processing → paid) a u penez je viditelnost toho
-- prechodu podstatna — bez nej nejde odlisit "jeste se neodeslalo" od
-- "odesila se prave ted".
--
-- ── Uplna inventura zapisovatelu (ne jen ti, co spadli) ──────────────────────
-- Prosel jsem VSECHNY ctyri zapisovatele do platform.payouts a u kazdeho vsechny
-- hodnoty, ktere do `status` piseou — vcetne parametrizovanych:
--   lib/payouts/executor.ts          'processing' (3x), 'paid', 'failed'
--                                    + failPayout: $2 = 'failed' | 'pending'
--                                      (executor.ts:267, podle MAX_RETRIES)
--   cron/event-payout-release        INSERT ... 'pending'
--   cron/payouts-auto-settle         INSERT ... 'pending'
--   payments/wise/webhook            'paid', 'failed'
-- Hodnoty 'active' a 'refunded', ktere hruby grep v tech souborech nasel,
-- patri JINYM tabulkam (objednavky/listky), ne payouts — overeno cilenym
-- grepem na `UPDATE platform.payouts` / `INTO platform.payouts`.
--
-- Mimo vycet je tedy JEDINA hodnota: 'processing'.
-- 'approved' a 'cancelled' ve vyctu zustavaji, i kdyz je kod nepise — jsou to
-- rucni/administrativni stavy a zuzovat vycet neni predmetem tohohle rozhodnuti.
--

BEGIN;

ALTER TABLE platform.payouts DROP CONSTRAINT IF EXISTS payouts_status_check;
ALTER TABLE platform.payouts ADD CONSTRAINT payouts_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'approved'::text,
    'processing'::text,
    'paid'::text,
    'failed'::text,
    'cancelled'::text
  ]));

COMMIT;
