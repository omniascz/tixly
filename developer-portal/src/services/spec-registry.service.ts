/**
 * Spec registry — holds multiple versions of the API spec so developers can
 * browse historical docs and see changes between versions.
 *
 * Specs are stored in-memory after registration. Can be loaded from file at boot.
 */
import { PortalError } from '../lib/portal-errors.js';
import { parseOpenApiSpec, type ParsedSpec } from '../lib/openapi-parser.js';

export interface SpecMeta {
  version: string;
  title: string;
  registeredAt: Date;
  operationCount: number;
  schemaCount: number;
}

const SPECS = new Map<string, { raw: Record<string, unknown>; parsed: ParsedSpec; registeredAt: Date }>();

export function registerSpec(version: string, rawSpec: Record<string, unknown>): SpecMeta {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new PortalError('INVALID_VERSION', 'Verze musí být ve formátu MAJOR.MINOR.PATCH.');
  }
  let parsed: ParsedSpec;
  try {
    parsed = parseOpenApiSpec(rawSpec);
  } catch (err) {
    throw new PortalError('SPEC_PARSE_ERROR', (err as Error).message);
  }
  const registeredAt = new Date();
  SPECS.set(version, { raw: rawSpec, parsed, registeredAt });
  return {
    version,
    title: parsed.info.title,
    registeredAt,
    operationCount: parsed.operations.length,
    schemaCount: parsed.schemas.length,
  };
}

export function unregisterSpec(version: string): void {
  if (!SPECS.has(version)) throw new PortalError('SPEC_NOT_FOUND');
  SPECS.delete(version);
}

export function listSpecs(): SpecMeta[] {
  const out: SpecMeta[] = [];
  for (const [version, entry] of SPECS.entries()) {
    out.push({
      version,
      title: entry.parsed.info.title,
      registeredAt: entry.registeredAt,
      operationCount: entry.parsed.operations.length,
      schemaCount: entry.parsed.schemas.length,
    });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

export function getSpec(version: string): ParsedSpec {
  const entry = SPECS.get(version);
  if (!entry) throw new PortalError('SPEC_NOT_FOUND');
  return entry.parsed;
}

export function getRawSpec(version: string): Record<string, unknown> {
  const entry = SPECS.get(version);
  if (!entry) throw new PortalError('SPEC_NOT_FOUND');
  return entry.raw;
}

export function getLatestVersion(): string | null {
  const versions = Array.from(SPECS.keys());
  if (versions.length === 0) return null;
  return versions.sort((a, b) => compareVersions(b, a))[0];
}

/** Semver compare: returns -1 if a < b, 0 if equal, 1 if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

// Test helper
export function _resetRegistry(): void {
  SPECS.clear();
}
