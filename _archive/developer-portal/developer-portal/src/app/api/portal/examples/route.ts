import { NextRequest, NextResponse } from 'next/server';
import { getSpec, getLatestVersion } from '../../../../services/spec-registry.service.js';
import { findOperationByPath } from '../../../../lib/openapi-parser.js';
import { generateExamples, type ExampleLanguage } from '../../../../services/examples.service.js';
import { isPortalError, PortalError } from '../../../../lib/portal-errors.js';

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const version = p.get('version') ?? getLatestVersion();
    if (!version) throw new PortalError('SPEC_NOT_FOUND');
    const path = p.get('path');
    const method = p.get('method');
    if (!path || !method) return NextResponse.json({ error: 'path and method required' }, { status: 400 });

    const spec = getSpec(version);
    const op = findOperationByPath(spec, path, method);
    if (!op) throw new PortalError('PATH_NOT_FOUND');

    const baseUrl = spec.servers[0]?.url ?? 'https://api.example.com';
    const langs = (p.get('languages')?.split(',') as ExampleLanguage[]) ?? ['curl', 'javascript', 'python'];

    return NextResponse.json({
      version, path, method, examples: generateExamples(op, { baseUrl }, langs),
    });
  } catch (err) {
    if (isPortalError(err)) return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    throw err;
  }
}
