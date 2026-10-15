# Kolo 21 / krok 2.3 — jak `dataCollection.urlQueryParams.deny` páruje názvy (@sentry/core 11.7.0)

Zdroj: `nextjs-boilerplate/node_modules/@sentry/core` (package.json `"version": "11.7.0"`), build/esm.

## Typ
`build/types/types/datacollection.d.ts:1-13`
```ts
 * - `true`: Collect all data without filtering (empty denylist). Sensitive values like keys and tokens are always filtered out.
 * - `false`: Do not collect any data.
 * - `{ allow: string[] }`: Collect only the specified keys.
 * - `{ deny: string[] }`: Collect all keys except the specified ones.
export type CollectBehavior = boolean | { allow: string[]; } | { deny: string[]; };
```
`urlQueryParams?: CollectBehavior;` — `datacollection.d.ts:55`.

## Párování — PODŘETĚZEC bez ohledu na velikost písmen
`build/esm/utils/data-collection/filterKeyValueData.js:3-21`
```js
function isSensitiveKey(lower, denySnippets) {
  return denySnippets.some((snippet) => lower.includes(snippet));
}
function shouldFilterDataKey(key, behavior, additionalDenyTerms) {
  if (behavior === false) { return true; }
  const lowerKey = key.toLowerCase();
  const denySnippets = additionalDenyTerms != null ? [...SENSITIVE_KEY_SNIPPETS, ...additionalDenyTerms] : SENSITIVE_KEY_SNIPPETS;
  if (isSensitiveKey(lowerKey, denySnippets)) { return true; }
  if (behavior === true) { return false; }
  const terms = "deny" in behavior ? behavior.deny : behavior.allow;
  const matchesConfiguredTerm = terms.some((term) => lowerKey.includes(term.toLowerCase()));   // řádek 19
  return "deny" in behavior ? matchesConfiguredTerm : !matchesConfiguredTerm;
}
```
Tedy: název parametru se převede na malá písmena a **odmítne se, pokud obsahuje kterýkoli výraz z `deny` jako podřetězec**
(`lowerKey.includes(term.toLowerCase())`, řádek 19). Navíc se VŽDY (i při `deny`) odmítají názvy obsahující některý
z `SENSITIVE_KEY_SNIPPETS` (`filtering-snippets.js:2-24`): `auth, token, secret, session, password, passwd, pwd, key, jwt,
bearer, sso, saml, csrf, xsrf, credentials, sid, identity, set-cookie, cookie`. Hodnota se nahradí `[Filtered]`
(`filtering-snippets.js:1`).

Důsledek pro seznam kroku 1.2: `sig` odmítne i např. `design`/`signup`, `code` i `promoCode`/`zipcode`, `hash` i `hashtag` —
přijatelné (do Sentry jde méně, ne víc). `sessionId`/`session_id`/`token`/`key`/`secret`/`password`/`access_token`/
`refresh_token` SDK filtruje už samo (snippety), v `deny` jsou kvůli úplnosti seznamu.

## Kde se filtr uplatní (jen URL / dotaz, ne hodnoty hlaviček)
`build/esm/utils/data-collection/filterQueryParams.js:4-13` (dvojice `klíč=hodnota` → `klíč=[Filtered]`),
`filterUrlQuery.js:3-15` (dotaz v URL), volání: `integrations/http/server-subscription.js:198,200` (`url.full`, `url.query`
serverového spanu), `utils/url.js:78,82`, `fetch.js:201,211,215`, `integrations/fetch.js:85`,
`integrations/http/get-outgoing-span-data.js:26`, `integrations/http/add-outgoing-request-breadcrumb.js:21`.
Hodnota hlavičky `referer` je pro SDK obyčejná hlavička — `urlQueryParams` se na ni **nevztahuje** (proto vada:
`http.request.header.referer` nese celou URL s `?token=…`). Proto maskování v `scrub-pii.ts`.
