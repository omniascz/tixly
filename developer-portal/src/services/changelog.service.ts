/**
 * Changelog diff generator — compares two parsed OpenAPI specs and emits
 * a human-readable list of added/removed/modified operations and schemas.
 */
import type { ParsedSpec, OpenApiOperation } from '../lib/openapi-parser.js';

export interface SpecDiff {
  fromVersion: string;
  toVersion: string;
  addedOperations: Array<{ method: string; path: string; summary: string }>;
  removedOperations: Array<{ method: string; path: string; summary: string }>;
  modifiedOperations: Array<{ method: string; path: string; changes: string[] }>;
  addedSchemas: string[];
  removedSchemas: string[];
  breakingChanges: number;
}

export function diffSpecs(
  fromVersion: string,
  toVersion: string,
  from: ParsedSpec,
  to: ParsedSpec,
): SpecDiff {
  const diff: SpecDiff = {
    fromVersion,
    toVersion,
    addedOperations: [],
    removedOperations: [],
    modifiedOperations: [],
    addedSchemas: [],
    removedSchemas: [],
    breakingChanges: 0,
  };

  const fromOps = keyByPathMethod(from.operations);
  const toOps = keyByPathMethod(to.operations);

  // Added + modified
  for (const [key, op] of toOps.entries()) {
    if (!fromOps.has(key)) {
      diff.addedOperations.push({ method: op.method, path: op.path, summary: op.summary });
    } else {
      const oldOp = fromOps.get(key)!;
      const changes = compareOperations(oldOp, op);
      if (changes.length > 0) {
        diff.modifiedOperations.push({ method: op.method, path: op.path, changes });
      }
    }
  }

  // Removed
  for (const [key, op] of fromOps.entries()) {
    if (!toOps.has(key)) {
      diff.removedOperations.push({ method: op.method, path: op.path, summary: op.summary });
      diff.breakingChanges++;    // removing an endpoint is always breaking
    }
  }

  // Schema changes
  const fromSchemaNames = new Set(from.schemas.map((s) => s.name));
  const toSchemaNames = new Set(to.schemas.map((s) => s.name));
  for (const name of toSchemaNames) {
    if (!fromSchemaNames.has(name)) diff.addedSchemas.push(name);
  }
  for (const name of fromSchemaNames) {
    if (!toSchemaNames.has(name)) {
      diff.removedSchemas.push(name);
      diff.breakingChanges++;
    }
  }

  return diff;
}

function keyByPathMethod(ops: OpenApiOperation[]): Map<string, OpenApiOperation> {
  const m = new Map<string, OpenApiOperation>();
  for (const op of ops) m.set(`${op.method} ${op.path}`, op);
  return m;
}

function compareOperations(from: OpenApiOperation, to: OpenApiOperation): string[] {
  const changes: string[] = [];

  // Required params added
  const fromReqParams = new Set(from.parameters.filter((p) => p.required).map((p) => `${p.in}:${p.name}`));
  const toReqParams = new Set(to.parameters.filter((p) => p.required).map((p) => `${p.in}:${p.name}`));
  for (const p of toReqParams) {
    if (!fromReqParams.has(p)) changes.push(`Added required parameter: ${p}`);
  }
  for (const p of fromReqParams) {
    if (!toReqParams.has(p)) changes.push(`Removed required parameter: ${p}`);
  }

  // Request body required change
  if (from.requestBody?.required !== to.requestBody?.required) {
    changes.push(`Request body required changed: ${from.requestBody?.required} → ${to.requestBody?.required}`);
  }

  // Response codes
  const fromCodes = new Set(from.responses.map((r) => r.code));
  const toCodes = new Set(to.responses.map((r) => r.code));
  for (const code of toCodes) {
    if (!fromCodes.has(code)) changes.push(`Added response code: ${code}`);
  }
  for (const code of fromCodes) {
    if (!toCodes.has(code)) changes.push(`Removed response code: ${code}`);
  }

  if (from.summary !== to.summary) {
    changes.push(`Summary changed`);
  }

  return changes;
}
