/**
 * Code example generator — produces cURL, JavaScript (fetch), and Python
 * (requests) snippets from an OpenAPI operation definition.
 */
import type { OpenApiOperation } from '../lib/openapi-parser.js';

export type ExampleLanguage = 'curl' | 'javascript' | 'python';

export interface CodeExample {
  language: ExampleLanguage;
  code: string;
}

export interface ExampleContext {
  baseUrl: string;
  bearerToken?: string;
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// Request builder
// ---------------------------------------------------------------------------

export function generateExamples(
  op: OpenApiOperation,
  ctx: ExampleContext,
  languages: ExampleLanguage[] = ['curl', 'javascript', 'python'],
): CodeExample[] {
  const url = buildUrl(ctx.baseUrl, op);
  const headers = buildHeaders(op, ctx);
  const body = generateBodyStub(op);

  return languages.map((lang) => {
    switch (lang) {
      case 'curl': return { language: lang, code: generateCurl(op, url, headers, body) };
      case 'javascript': return { language: lang, code: generateJavaScript(op, url, headers, body) };
      case 'python': return { language: lang, code: generatePython(op, url, headers, body) };
    }
  });
}

function buildUrl(baseUrl: string, op: OpenApiOperation): string {
  let url = baseUrl.replace(/\/$/, '') + op.path;
  // Replace path params with placeholders
  for (const p of op.parameters.filter((x) => x.in === 'path')) {
    url = url.replace(`{${p.name}}`, `<${p.name}>`);
  }
  // Add query params
  const queryParams = op.parameters.filter((x) => x.in === 'query' && x.required);
  if (queryParams.length > 0) {
    url += '?' + queryParams.map((p) => `${p.name}=<${p.name}>`).join('&');
  }
  return url;
}

function buildHeaders(op: OpenApiOperation, ctx: ExampleContext): Record<string, string> {
  const headers: Record<string, string> = {};
  if (op.requestBody) headers['Content-Type'] = op.requestBody.contentType;

  // Check security schemes
  const hasBearerAuth = op.security.some((s) => Object.keys(s).some((k) => k.toLowerCase().includes('bearer')));
  const hasApiKey = op.security.some((s) => Object.keys(s).some((k) => k.toLowerCase().includes('apikey')));

  if (hasBearerAuth && ctx.bearerToken) {
    headers['Authorization'] = `Bearer ${ctx.bearerToken}`;
  } else if (hasBearerAuth) {
    headers['Authorization'] = 'Bearer <your-token>';
  }
  if (hasApiKey && ctx.apiKey) headers['X-API-Key'] = ctx.apiKey;
  else if (hasApiKey) headers['X-API-Key'] = '<your-api-key>';

  // Header params
  for (const p of op.parameters.filter((x) => x.in === 'header')) {
    headers[p.name] = `<${p.name}>`;
  }

  return headers;
}

function generateBodyStub(op: OpenApiOperation): string | null {
  if (!op.requestBody) return null;
  // Generate minimal JSON placeholder from schema
  const schema = op.requestBody.schema as Record<string, unknown> | undefined;
  if (!schema) return '{}';
  const stub: Record<string, unknown> = {};
  const props = schema.properties as Record<string, unknown> | undefined;
  if (props) {
    for (const [name, def] of Object.entries(props)) {
      const d = def as Record<string, unknown>;
      stub[name] = typeStub(String(d.type ?? 'string'));
    }
  }
  return JSON.stringify(stub, null, 2);
}

function typeStub(type: string): unknown {
  switch (type) {
    case 'integer': case 'number': return 0;
    case 'boolean': return false;
    case 'array': return [];
    case 'object': return {};
    default: return 'string';
  }
}

// ---------------------------------------------------------------------------
// Language generators
// ---------------------------------------------------------------------------

function generateCurl(op: OpenApiOperation, url: string, headers: Record<string, string>, body: string | null): string {
  const lines: string[] = [`curl -X ${op.method} '${url}' \\`];
  for (const [k, v] of Object.entries(headers)) {
    lines.push(`  -H '${k}: ${v}' \\`);
  }
  if (body) {
    lines.push(`  -d '${body.replace(/\n/g, '')}'`);
  } else {
    // Remove trailing backslash
    lines[lines.length - 1] = lines[lines.length - 1].replace(/ \\$/, '');
  }
  return lines.join('\n');
}

function generateJavaScript(op: OpenApiOperation, url: string, headers: Record<string, string>, body: string | null): string {
  const headerStr = JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ');
  const opts: string[] = [`  method: '${op.method}'`, `  headers: ${headerStr}`];
  if (body) opts.push(`  body: JSON.stringify(${body})`);

  return `const response = await fetch('${url}', {
${opts.join(',\n')}
});
const data = await response.json();`;
}

function generatePython(op: OpenApiOperation, url: string, headers: Record<string, string>, body: string | null): string {
  const headerDict = Object.entries(headers).map(([k, v]) => `    '${k}': '${v}'`).join(',\n');
  const lines: string[] = [
    'import requests',
    '',
    `url = '${url}'`,
    `headers = {\n${headerDict}\n}`,
  ];
  if (body) {
    lines.push(`payload = ${body}`);
    lines.push(`response = requests.${op.method.toLowerCase()}(url, headers=headers, json=payload)`);
  } else {
    lines.push(`response = requests.${op.method.toLowerCase()}(url, headers=headers)`);
  }
  lines.push('data = response.json()');
  return lines.join('\n');
}
