import { NextRequest, NextResponse } from 'next/server';
import { openApiToSdkSpec } from '../../../../lib/spec-adapter.js';
import { generateJavaScriptSdk } from '../../../../generators/javascript.js';
import { generateTypeScriptSdk } from '../../../../generators/typescript.js';
import { generatePythonSdk } from '../../../../generators/python.js';
import type { Language } from '../../../../lib/sdk-types.js';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { openApi, language, packageName, version, baseUrl } = body as {
    openApi: Record<string, unknown>;
    language: Language;
    packageName: string;
    version: string;
    baseUrl?: string;
  };

  if (!openApi || !language || !packageName || !version) {
    return NextResponse.json({ error: 'openApi, language, packageName, version required' }, { status: 400 });
  }

  const spec = openApiToSdkSpec(openApi, { packageName, version, baseUrl });
  let sdk;
  switch (language) {
    case 'javascript': sdk = generateJavaScriptSdk(spec); break;
    case 'typescript': sdk = generateTypeScriptSdk(spec); break;
    case 'python': sdk = generatePythonSdk(spec); break;
    default:
      return NextResponse.json({ error: `Unsupported language: ${language}` }, { status: 400 });
  }

  return NextResponse.json(sdk, { status: 201 });
}
