/**
 * Rights-engine — vyhodnocení programmable rights lístku (bez kryptoměn).
 *
 * Lístek nese pravidla, která se v čase mění: časovaný kredit (F&B po naskenování),
 * auto-přeprodej za nominál při no-show, podmíněný upgrade. Čistá funkce nad
 * ticket_types.programmable_rights + kontextem (čas, sken, kapacita).
 */

export interface ProgrammableRights {
  /** Kredit aktivní po naskenování (nebo od začátku akce) na X minut. */
  timeBoxedCredit?: { amountMinor: number; currency: string; fromScan?: boolean; validMinutes: number };
  /** Když lístek nikdo nenaskenuje do začátku akce, nabídne se k auto-přeprodeji za nominál. */
  autoResaleIfUnscanned?: boolean;
  /** Podmíněný upgrade, když je akce málo zaplněná. */
  conditionalUpgrade?: { toTicketTypeId: string; ifCapacityBelowPct: number };
}

export interface RightsContext {
  now: Date;
  scannedAt?: Date | null;
  eventStart: Date;
  /** 0..1 naplněnost akce (volitelné). */
  capacityPct?: number | null;
}

export interface ActiveRight {
  kind: 'credit' | 'auto_resale' | 'upgrade';
  label: string;
  detail?: Record<string, unknown>;
}

export function evaluateRights(rights: ProgrammableRights | null | undefined, ctx: RightsContext): ActiveRight[] {
  if (!rights) return [];
  const out: ActiveRight[] = [];
  const now = ctx.now.getTime();

  // Časovaný kredit
  const c = rights.timeBoxedCredit;
  if (c && c.amountMinor > 0 && c.validMinutes > 0) {
    const start = c.fromScan ? (ctx.scannedAt ? ctx.scannedAt.getTime() : null) : ctx.eventStart.getTime();
    if (start !== null) {
      const end = start + c.validMinutes * 60_000;
      if (now >= start && now <= end) {
        out.push({
          kind: 'credit',
          label: `Aktivní kredit ${(c.amountMinor / 100).toFixed(0)} ${c.currency} (platí ${c.validMinutes} min)`,
          detail: { amountMinor: c.amountMinor, currency: c.currency, expiresAt: new Date(end).toISOString() },
        });
      }
    }
  }

  // Auto-přeprodej při no-show
  if (rights.autoResaleIfUnscanned && !ctx.scannedAt && now > ctx.eventStart.getTime()) {
    out.push({
      kind: 'auto_resale',
      label: 'Lístek nebyl naskenován — lze ho automaticky nabídnout k přeprodeji za nominál.',
    });
  }

  // Podmíněný upgrade
  const u = rights.conditionalUpgrade;
  if (u && typeof ctx.capacityPct === 'number' && ctx.capacityPct * 100 < u.ifCapacityBelowPct) {
    out.push({
      kind: 'upgrade',
      label: 'Máš nárok na upgrade sedadla zdarma (akce je málo zaplněná).',
      detail: { toTicketTypeId: u.toTicketTypeId },
    });
  }

  return out;
}
