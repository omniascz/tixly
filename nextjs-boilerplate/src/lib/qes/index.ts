/**
 * Factory pro QES poskytovatele.
 * QES_PROVIDER=mock|docusign|signicat (default: mock)
 */

import type { IQESProvider } from './types';
// Statické importy (dřív lazy require): oba providery jsou lehké a bez vedlejších efektů
// při importu; require() navíc nefunguje v ESM běhu testů (vitest) → QES nešlo otestovat.
import { DocuSignProvider } from './docusign-provider';
import { MockQESProvider } from './mock-provider';

let _provider: IQESProvider | null = null;

export function getQESProvider(): IQESProvider {
  if (_provider) return _provider;
  const name = (process.env.QES_PROVIDER ?? 'mock') as string;
  if (name === 'docusign') {
    _provider = new DocuSignProvider();
  } else {
    _provider = new MockQESProvider();
  }
  return _provider!;
}

/** Jen pro testy: zahodí cache providera (QES_PROVIDER se pak načte znovu). */
export function _resetQESProviderForTests(): void {
  _provider = null;
}

export * from './types';
