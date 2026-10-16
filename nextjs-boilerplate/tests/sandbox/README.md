# Sandbox testy platebních bran (kolo 7)

`tests/sandbox/gopay.sandbox.test.ts` a `tests/sandbox/comgate.sandbox.test.ts`:
platba → zaplacení → webhook → vstupenka, refund při chybě brány, refund.

- Běží proti **skutečnému sandboxu brány** a **izolované lokální DB** (z migrací, aplikace pod `tixly_app`).
- Bez proměnných níže se přeskočí s hláškou `[sandbox:…] PŘESKOČENO — chybí: …`.
- **Ochrana proti produkci:** klíče mají vlastní názvy (`*_SANDBOX_*`), do `GOPAY_*`/`COMGATE_*` se přepíšou
  až uvnitř testu; test odmítne produkční hostitele brány (`gate.gopay.cz`, ComGate bez `test=true`)
  i jinou než lokální databázi (`DATABASE_URL`, `FIX_DB_*` mimo localhost → chyba).
- Krok „zaplacení" dělá člověk: test vypíše odkaz na platební stránku sandboxu a čeká
  (dotazem na API brány), až bude platba zaplacená — `SANDBOX_PAY_TIMEOUT_MS`, výchozí 5 min.
  Notifikaci brány na localhost nedoručí, proto test zavolá náš webhook se skutečným ID platby
  a webhook si stav ověří u brány sám.
- Refund při chybě: refund s dočasně neplatným tajemstvím → brána odmítne, peníze se nepohnou,
  objednávka `refund_failed`, vstupenka platná. Potom refund se správnými údaji → vráceno.

## Proměnné prostředí

| Proměnná | Brána | Kde ji vlastník získá |
|---|---|---|
| `GOPAY_SANDBOX_GOID` | GoPay | Testovací přístupy (GoID, ClientID, ClientSecret) posílá GoPay po registraci obchodníka — [gopay.com](https://www.gopay.com/en/), postup [Essential Guide to Integration](https://help.gopay.com/en/s/u8), [Testing payments in the sandbox](https://help.gopay.com/en/s/wk) |
| `GOPAY_SANDBOX_CLIENT_ID` | GoPay | tamtéž |
| `GOPAY_SANDBOX_CLIENT_SECRET` | GoPay | tamtéž |
| `COMGATE_SANDBOX_MERCHANT` | ComGate | Klientský portál [portal.comgate.cz](https://portal.comgate.cz/cs/) → Integrace → Nastavení obchodu → Propojení obchodu (identifikátor e-shopu) |
| `COMGATE_SANDBOX_SECRET` | ComGate | tamtéž (heslo pro komunikaci); v portálu povolit **IP adresu stroje**, ze kterého testy poběží — API ComGate je chráněné IP whitelistem ([FAQ](https://apidoc.comgate.cz/en/faq)) |
| `FIX_E2E=1` | obě | izolovaná lokální DB (viz `tests/helpers/local-fixture.ts`) |
| `FIX_DB_OWNER_URL`, `FIX_DB_APP_URL` | obě | lokální DB z migrací (`neondb_owner` / `tixly_app`) |
| `SANDBOX_PAY_TIMEOUT_MS` | obě | volitelné, čekání na zaplacení (výchozí 300000) |

Dokumentace API: GoPay [doc.gopay.com](https://doc.gopay.com/), ComGate REST v2.0
[apidoc.comgate.cz/en/api/rest/](https://apidoc.comgate.cz/en/api/rest/).

## Zaplacení v sandboxu

- **GoPay:** testovací karty z [help.gopay.com/en/s/wk](https://help.gopay.com/en/s/wk) — MasterCard `5447380000000006`,
  VISA `4444444444444448`, CVV libovolné 3 číslice, expirace libovolné budoucí datum. Výsledek určuje částka:
  končí-li na `00`, platba projde (test zakládá vstupenku za 100,00 Kč a hlídá, že částka končí na 00).
- **ComGate:** platba s `test=true` se otevře v testovacím režimu brány; dokončete ji podle pokynů na stránce.

## Spuštění

```bash
cd nextjs-boilerplate
FIX_E2E=1 FIX_DB_OWNER_URL=postgresql://neondb_owner:…@localhost:55632/<db> \
FIX_DB_APP_URL=postgresql://tixly_app:…@localhost:55632/<db> \
GOPAY_SANDBOX_GOID=… GOPAY_SANDBOX_CLIENT_ID=… GOPAY_SANDBOX_CLIENT_SECRET=… \
COMGATE_SANDBOX_MERCHANT=… COMGATE_SANDBOX_SECRET=… \
npm run test:sandbox
```
