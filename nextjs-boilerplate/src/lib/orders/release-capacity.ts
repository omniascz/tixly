/**
 * Uvolnění kapacity držené objednávkami, které se ruší/expirují.
 *
 * Jedno místo pravdy pro K3 — volá to jak cron expirace (`expire-pending-orders`),
 * tak webhook při zrušené/timeoutované platbě (`gopay/webhook` CANCELED/TIMEOUTED).
 * Žádná paralelní logika: obě cesty musí uvolnit totéž (GA množství, sedadla, promo).
 *
 * Idempotence: volající drží objednávky pod `FOR UPDATE` / `WHERE status='pending'`,
 * takže se každá objednávka uvolní právě jednou (po prvním uvolnění už není pending).
 * GA/promo se počítají z `order_items` / `orders.promo_code_id` daných objednávek,
 * takže opakované volání nad týmiž (už nepending) objednávkami je no-op na straně volajícího.
 */
import type { PoolClient } from 'pg';

export interface CapacityReleaseResult {
  gaRestored: number;
  seatsReleased: number;
  promoReleased: number;
}

/**
 * @param client  aktivní klient V TRANSAKCI (volající řídí BEGIN/COMMIT)
 * @param orderIds objednávky, jejichž kapacita se má vrátit
 */
export async function releaseOrderCapacity(
  client: PoolClient,
  orderIds: string[],
): Promise<CapacityReleaseResult> {
  if (orderIds.length === 0) return { gaRestored: 0, seatsReleased: 0, promoReleased: 0 };

  // 1) GA množství zpět z order_items (jediný zdroj rezervovaného množství pro GA).
  //    Kolo 9: strop total_qty — některé cesty (claim skupinové pozvánky) kapacitu při vytvoření neodečítají;
  //    bez stropu CHECK chk_catalog_ticket_types_remaining shodil celou dávku cronu a nepropadlo nic.
  const ga = await client.query(
    `UPDATE catalog.ticket_types tt
        SET remaining_qty = LEAST(tt.total_qty, remaining_qty + sub.qty)
       FROM (
         SELECT ticket_type_id, SUM(quantity) AS qty
           FROM orders.order_items
          WHERE order_id = ANY($1::uuid[])
          GROUP BY ticket_type_id
       ) sub
      WHERE tt.id = sub.ticket_type_id`,
    [orderIds],
  );

  // 2) Sedadla navázaná na tyto objednávky (sold→expired edge; sloupec je `seat_id`,
  //    NE `event_seat_id` — to byl 42703, který cron shazoval). Pending SEATED
  //    držení se odbavuje přes hold_until v `release-expired-seat-holds` a v cronu
  //    níže; tady vracíme jen sedadla přímo linknutá na objednávku.
  const seats = await client.query(
    `UPDATE catalog.event_seats
        SET status = 'available', order_id = NULL, ticket_id = NULL,
            hold_user_id = NULL, hold_until = NULL, updated_at = now()
      WHERE order_id = ANY($1::uuid[])
         OR id IN (SELECT seat_id FROM orders.order_items
                    WHERE order_id = ANY($1::uuid[]) AND seat_id IS NOT NULL)`,
    [orderIds],
  );

  // 3) Promo max_uses zpět: checkout inkrementuje uses_count UŽ při vytvoření
  //    objednávky (před platbou), takže nezaplacená/zrušená objednávka jinak
  //    „spálí" použití navždy. Vrátíme uses_count o počet těchto objednávek na
  //    daný kód a smažeme jejich záznamy v promo_code_usages.
  const promo = await client.query(
    `UPDATE marketing.promo_codes pc
        SET uses_count = GREATEST(0, uses_count - sub.cnt), updated_at = now()
       FROM (
         SELECT promo_code_id, COUNT(*) AS cnt
           FROM orders.orders
          WHERE id = ANY($1::uuid[]) AND promo_code_id IS NOT NULL
          GROUP BY promo_code_id
       ) sub
      WHERE pc.id = sub.promo_code_id`,
    [orderIds],
  );
  await client.query(
    `DELETE FROM marketing.promo_code_usages WHERE order_id = ANY($1::uuid[])`,
    [orderIds],
  );

  return {
    gaRestored: ga.rowCount ?? 0,
    seatsReleased: seats.rowCount ?? 0,
    promoReleased: promo.rowCount ?? 0,
  };
}
