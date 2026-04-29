import { NextRequest, NextResponse } from 'next/server';
import { getSpec, getLatestVersion } from '../../../../services/spec-registry.service.js';
import { groupOperationsByTag, findOperationByPath } from '../../../../lib/openapi-parser.js';
import { isPortalError, PortalError } from '../../../../lib/portal-errors.js';

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const version = p.get('version') ?? getLatestVersion();
    if (!version) throw new PortalError('SPEC_NOT_FOUND', 'Žádná verze není registrována.');

    const spec = getSpec(version);

    // Specific operation lookup
    const path = p.get('path');
    const method = p.get('method');
    if (path && method) {
      const op = findOperationByPath(spec, path, method);
      if (!op) throw new PortalError('PATH_NOT_FOUND');
      return NextResponse.json({ version, operation: op });
    }

    // Specific tag
    const tag = p.get('tag');
    if (tag) {
      const groups = groupOperationsByTag(spec);
      return NextResponse.json({ version, tag, operations: groups[tag] ?? [] });
    }

    // Full index
    return NextResponse.json({
      version,
      info: spec.info,
      servers: spec.servers,
      tags: spec.tags,
      operationsByTag: groupOperationsByTag(spec),
      schemas: spec.schemas.map((s) => ({ name: s.name, type: s.type })),
    });
  } catch (err) {
    if (isPortalError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
