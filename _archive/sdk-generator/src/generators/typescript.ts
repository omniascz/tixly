/**
 * TypeScript SDK generator — emits fully-typed client based on the same
 * template as JavaScript but with type definitions derived from schemas.
 */
import type { SdkSpec, GeneratedFile, GeneratedSdk, SdkOperation, SdkSchema } from '../lib/sdk-types.js';

export function generateTypeScriptSdk(spec: SdkSpec): GeneratedSdk {
  const files: GeneratedFile[] = [
    { path: 'package.json', content: renderPackageJson(spec) },
    { path: 'src/types.ts', content: renderTypes(spec) },
    { path: 'src/client.ts', content: renderClient(spec) },
    { path: 'tsconfig.json', content: renderTsConfig() },
    { path: 'README.md', content: renderReadme(spec) },
  ];
  return {
    language: 'typescript',
    packageName: spec.packageName,
    version: spec.version,
    files,
  };
}

function renderPackageJson(spec: SdkSpec): string {
  return JSON.stringify({
    name: spec.packageName,
    version: spec.version,
    description: `Official TypeScript SDK for ${spec.packageName}`,
    main: 'dist/client.js',
    types: 'dist/client.d.ts',
    type: 'module',
    scripts: { build: 'tsc' },
    devDependencies: { typescript: '^5.0.0' },
    license: 'MIT',
  }, null, 2);
}

function renderTsConfig(): string {
  return JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      declaration: true,
      outDir: 'dist',
    },
    include: ['src'],
  }, null, 2);
}

function renderTypes(spec: SdkSpec): string {
  const schemas = spec.schemas.map((s) => renderSchemaInterface(s)).join('\n\n');
  return `/** Auto-generated types for ${spec.packageName} v${spec.version} */

${schemas}
`;
}

function renderSchemaInterface(schema: SdkSchema): string {
  const props = schema.properties.map((p) =>
    `  ${p.name}${p.required ? '' : '?'}: ${p.type};`
  ).join('\n');
  return `export interface ${schema.name} {
${props}
}`;
}

function renderClient(spec: SdkSpec): string {
  const schemaImports = spec.schemas.length > 0
    ? `import type { ${spec.schemas.map((s) => s.name).join(', ')} } from './types.js';\n\n`
    : '';

  const methods = spec.operations.map((op) => renderMethod(op)).join('\n\n');

  return `${schemaImports}/**
 * ${spec.packageName} — auto-generated TypeScript SDK
 * Version: ${spec.version}
 * Base URL: ${spec.baseUrl}
 */

export interface ApiClientOptions {
  baseUrl?: string;
  bearerToken?: string;
  apiKey?: string;
  fetch?: typeof fetch;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly body: string;
  constructor(status: number, body: string, method: string, url: string) {
    super(\`\${method} \${url} failed with \${status}: \${body}\`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export class ApiClient {
  private baseUrl: string;
  private bearerToken: string | null;
  private apiKey: string | null;
  private fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '${spec.baseUrl}';
    this.bearerToken = options.bearerToken ?? null;
    this.apiKey = options.apiKey ?? null;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.bearerToken) headers['Authorization'] = \`Bearer \${this.bearerToken}\`;
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { pathParams?: Record<string, unknown>; queryParams?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<T> {
    let url = this.baseUrl.replace(/\\/$/, '') + path;
    if (opts.pathParams) {
      for (const [key, val] of Object.entries(opts.pathParams)) {
        url = url.replace(\`{\${key}}\`, encodeURIComponent(String(val)));
      }
    }
    if (opts.queryParams) {
      const qs = Object.entries(opts.queryParams)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => \`\${encodeURIComponent(k)}=\${encodeURIComponent(String(v))}\`)
        .join('&');
      if (qs) url += '?' + qs;
    }

    const response = await this.fetchImpl(url, {
      method,
      headers: this.buildHeaders(),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ApiError(response.status, errorBody, method, url);
    }
    const contentType = response.headers.get('content-type') ?? '';
    return contentType.includes('application/json') ? response.json() : (response.text() as unknown as T);
  }

${methods}
}
`;
}

function renderMethod(op: SdkOperation): string {
  const name = op.operationId;
  const paramDecls: string[] = [];
  for (const p of op.pathParams) paramDecls.push(`${p}: string`);
  if (op.bodyType) paramDecls.push(`body: ${op.bodyType}`);
  paramDecls.push(`options: { query?: Record<string, unknown> } = {}`);

  const pathParamsObj = op.pathParams.length > 0
    ? `{ ${op.pathParams.join(', ')} }`
    : '{}';

  const bodyArg = op.bodyType ? 'body' : 'undefined';
  const respType = op.responseType === 'unknown' ? 'unknown' : op.responseType;

  return `  /** ${op.summary || name} */
  async ${name}(${paramDecls.join(', ')}): Promise<${respType}> {
    return this.request<${respType}>('${op.method}', '${op.path}', {
      pathParams: ${pathParamsObj},
      queryParams: options.query,
      body: ${bodyArg},
    });
  }`;
}

function renderReadme(spec: SdkSpec): string {
  return `# ${spec.packageName}

Auto-generated TypeScript SDK for ${spec.packageName}, version ${spec.version}.

## Installation

\`\`\`bash
npm install ${spec.packageName}
\`\`\`

## Usage

\`\`\`typescript
import { ApiClient } from '${spec.packageName}';

const client = new ApiClient({
  baseUrl: '${spec.baseUrl}',
  bearerToken: 'your-token',
});
\`\`\`
`;
}
