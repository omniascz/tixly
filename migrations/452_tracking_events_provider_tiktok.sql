-- 452 — tracking_events_provider_check: doplnit 'tiktok' (server-side CAPI audit log).
-- lib/tracking/tiktok-capi.ts INSERTuje do marketing.tracking_events s provider='tiktok',
-- ale prod constraint povoloval jen {meta_capi, ga4, meta_pixel} → INSERT padal na
-- check constraint (23514), maskováno .catch() → audit řádek se NIKDY tiše nezapsal.
-- Sourozenci meta_capi/ga4 fungují, jejich provider JE ve výčtu; TikTok migrace kdysi
-- přidala promoter creds + CAPI kód, ale enum nerozšířila (co-drift se 3 renamy sloupců).
-- Aditivní rozšíření výčtu, IDENTICKÝ vzor jako 444/451. Hodnota je write-only label
-- (nikde se nečte/nematchuje, ověřeno grepem), tracking_events je prázdná → nic se nerozbije.
-- DEPLOY POŘADÍ: tato migrace na DB PŘED nasazením kódu (INSERT s 'tiktok' potřebuje enum).
ALTER TABLE marketing.tracking_events DROP CONSTRAINT IF EXISTS tracking_events_provider_check;
ALTER TABLE marketing.tracking_events ADD CONSTRAINT tracking_events_provider_check
  CHECK (provider IN ('meta_capi', 'ga4', 'meta_pixel', 'tiktok'));
