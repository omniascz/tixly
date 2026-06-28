/**
 * Factory pro QES poskytovatele.
 * QES_PROVIDER=mock|docusign|signicat (default: mock)
 */

import type { IQESProvider } from './types';

let _provider: IQESProvider | null = null;

export function getQESProvider(): IQESProvider {
  if (_provider) return _provider;
  const name = (process.env.QES_PROVIDER ?? 'mock') as string;
  if (name === 'docusign') {
    const { DocuSignProvider } = require('./docusign-provider') as typeof import('./docusign-provider');
    _provider = new DocuSignProvider();
  } else {
    const { MockQESProvider } = require('./mock-provider') as typeof import('./mock-provider');
    _provider = new MockQESProvider();
  }
  return _provider!;
}

export * from './types';
