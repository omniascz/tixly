import { use } from 'react';

/**
 * Parametry dynamické route v klientské stránce — v Next 14 i 15.
 *
 * Next 15 předává `params` jako Promise (rozbaluje se přes `use()`), Next 14,
 * na kterém projekt běží, jako obyčejný objekt. `use(objekt)` v Reactu hodí
 * „An unsupported type was passed to use(): [object Object]" a stránka spadne
 * do error boundary — build ani `tsc` to nezachytí, projeví se to až
 * v prohlížeči. Tak to od června 2026 shazovalo mimo jiné typy vstupenek
 * a guestlist.
 *
 * `use()` smí být volané podmíněně (na rozdíl od ostatních hooků).
 */
export function useRouteParams<T>(params: T | Promise<T>): T {
  if (params && typeof (params as { then?: unknown }).then === 'function') {
    return use(params as Promise<T>);
  }
  return params as T;
}
