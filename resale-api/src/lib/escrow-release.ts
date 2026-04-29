/**
 * Feature #47 — Escrow release on venue entry
 *
 * Změna oproti původnímu flow:
 *   PŘED: gopay-callback AUTHORIZED → escrow_status = 'held' → claimTicket
 *         → 'captured' → ResalePayoutService (24h po eventu) → 'released'
 *   PO:   gopay-callback AUTHORIZED → 'held' → SCAN U BRÁNY → 'released'
 *
 * Tj. peníze leží v escrow přesně do okamžiku, kdy kupující reálně vstoupí
 * do venue a jeho QR projde TOTP validací. Tím:
 *   * kupující má 100% jistotu, že vstupenku doopravdy použije, než seller
 *     dostane peníze
 *   * eliminujeme okno "kupující claimnul → ale stejně se nedostal dovnitř"
 *
 * `releaseEscrowOnEntry` se volá z gate-scanner endpointu (sms-barcode modul)
 * po úspěšné TOTP validaci. Pro non-resale vstupenky je no-op a vrátí
 * `released: false` — gate scanner nemusí znát rozdíl.
 *
 * Idempotence: opakované volání pro stejnou vstupenku najde listing už ve
 * stavu 'released' (ne 'held') a vrátí no-op. Žádné dvojité vyplacení.
 */

import type {
  DbAdapter,
  EventBusAdapter,
  GopayAdapter,
  DbRow,
} from '../types/resale.js';

export interface EscrowReleaseDeps {
  db: DbAdapter;
  eventBus: EventBusAdapter;
  /** Volitelné — pokud je předán, zavolá se gopay.capture pro aktuálně
   *  pre-autorizované peníze. V testech mockujeme. */
  gopay?: GopayAdapter;
}

export interface EscrowReleaseResult {
  released: boolean;
  payoutAmount: number | null;
  listingId: string | null;
}

interface HeldListingRow extends DbRow {
  id: string;
  seller_id: string;
  buyer_id: string | null;
  ask_price: string;
  commission_rate: string;
  escrow_gopay_id: string | null;
  escrow_status: string;
}

/**
 * Najde poslední `sold` listing pro danou vstupenku ve stavu escrow='held'
 * a uvolní ho. Atomická operace — vše uvnitř transakce.
 *
 * Vrací:
 *   - `released: true`  → existoval held listing, byl uvolněn, payoutAmount > 0
 *   - `released: false` → buď žádný resale listing neexistuje (běžná vstupenka),
 *                         nebo už byl uvolněn dřívější skenování (idempotent)
 */
export async function releaseEscrowOnEntry(
  ticketId: string,
  deps: EscrowReleaseDeps,
): Promise<EscrowReleaseResult> {
  return deps.db.transaction(async (tx) => {
    // 1. Najdi nejnovější sold + held listing pro tuto vstupenku.
    //    FOR UPDATE zamkne řádek do konce transakce — zabraňuje race
    //    condition mezi dvěma souběžnými skeny u brány.
    const rows = await tx.query<HeldListingRow>(
      `SELECT id, seller_id, buyer_id, ask_price, commission_rate,
              escrow_gopay_id, escrow_status
       FROM resale.resale_listings
       WHERE ticket_id = $1
         AND status = 'sold'
       ORDER BY sold_at DESC
       LIMIT 1
       FOR UPDATE`,
      [ticketId],
    );

    if (rows.length === 0) {
      // Není to resale vstupenka — no-op, žádný listing neexistuje.
      return { released: false, payoutAmount: null, listingId: null };
    }

    const listing = rows[0];

    // Idempotence: pokud už byl uvolněn (escrow_status != 'held'), nic neděláme.
    if (listing.escrow_status !== 'held') {
      return {
        released: false,
        payoutAmount: null,
        listingId: listing.id,
      };
    }

    // 2. Spočítej payout = ask_price - commission. Vše v haléřích (INTEGER).
    const askPrice = Number(listing.ask_price);
    const commissionRate = Number(listing.commission_rate);
    const commission = Math.round(askPrice * commissionRate);
    const payoutAmount = askPrice - commission;

    // 3. (Volitelně) finalizuj GoPay capture. Před změnou DB stavu — pokud
    //    capture vyhodí, transakce se rolluje a escrow zůstane v 'held'.
    //    V mnoha implementacích je capture už proběhl při claimTicket;
    //    pokud nemáme gopay adapter, krok přeskakujeme.
    if (deps.gopay && listing.escrow_gopay_id) {
      try {
        await deps.gopay.capture(listing.escrow_gopay_id);
      } catch (err) {
        // Pokud už bylo captured dřív, GoPay vrátí chybu — logujeme a
        // pokračujeme. V produkci by adapter měl rozlišovat "už captured"
        // od skutečné chyby. Pro safety raději rethrow:
        const message = (err as Error).message ?? '';
        if (!/already.*captur/i.test(message)) {
          throw err;
        }
      }
    }

    // 4. Update listing: held → released, set payout_amount + payout_at.
    await tx.query(
      `UPDATE resale.resale_listings
       SET escrow_status = 'released',
           payout_amount = $1,
           payout_at     = NOW()
       WHERE id = $2`,
      [payoutAmount, listing.id],
    );

    // 5. Emit event PO úspěšném DB updatu (uvnitř tx je OK — eventBus
    //    typicky používá outbox pattern, takže commit DB == commit eventu).
    await deps.eventBus.publish('escrow.released', {
      listingId: listing.id,
      ticketId,
      sellerId: listing.seller_id,
      buyerId: listing.buyer_id,
      payoutAmount,
      releasedAt: new Date().toISOString(),
      trigger: 'venue_entry',
    });

    return {
      released: true,
      payoutAmount,
      listingId: listing.id,
    };
  });
}
