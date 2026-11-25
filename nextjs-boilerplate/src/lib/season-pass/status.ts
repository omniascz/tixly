/**
 * Stav permanentky. orders.season_passes nemá sloupec status ani holder_user_id:
 * platnost i držitel se odvozují z navázané objednávky (alias `sp` = season_passes, `o` = LEFT JOIN orders.orders).
 * Permanentka je použitelná jen po zaplacení objednávky.
 */
export const SEASON_PASS_STATUS_SQL = `CASE
  WHEN o.status = 'paid' THEN CASE WHEN sp.valid_until > NOW() THEN 'active' ELSE 'expired' END
  WHEN o.status = 'pending' AND o.expires_at > NOW() THEN 'pending_payment'
  ELSE 'cancelled' END`;
