/**
 * JavaScript SDK generator — emits a single-file client.js module that
 * wraps each operation as a named function using `fetch`.
 *
 * Generated structure:
 *   - ApiClient class with constructor({ baseUrl, bearerToken, apiKey })
 *   - One async method per operation
 *   - Automatic path param substitution + query string encoding
 *   - JSON body serialization
 */
import type { SdkSpec, GeneratedFile, GeneratedSdk } from '../lib/sdk-types.js';

export function generateJavaScriptSdk(spec: SdkSpec): GeneratedSdk {
  const files: GeneratedFile[] = [
    { path: 'package.json', content: renderPackageJson(spec) },
    { path: 'src/client.js', content: renderClient(spec) },
    { path: 'README.md', content: renderReadme(spec) },
  ];
  return {
    language: 'javascript',
    packageName: spec.packageName,
    version: spec.version,
    files,
  };
}

function renderPackageJson(spec: SdkSpec): string {
  return JSON.stringify({
    name: spec.packageName,
    version: spec.version,
    description: `Official JavaScript SDK for ${spec.packageName}`,
    main: 'src/client.js',
    type: 'module',
    license: 'MIT',
  }, null, 2);
}

function renderClient(spec: SdkSpec): string {
  const methods = spec.operations.map((op) => renderMethod(op)).join('\n\n');

  return `/**
 * ${spec.packageName} — auto-generated JavaScript SDK
 * Version: ${spec.version}
 * Base URL: ${spec.baseUrl}
 */

export class ApiClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || '${spec.baseUrl}';
    this.bearerToken = options.bearerToken || null;
    this.apiKey = options.apiKey || null;
    this.fetch = options.fetch || globalThis.fetch;
  }

  _buildHeaders(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    if (this.bearerToken) headers['Authorization'] = \`Bearer \${this.bearerToken}\`;
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    return headers;
  }

  async _request(method, path, { pathParams = {}, queryParams = {}, body = null } = {}) {
    let url = this.baseUrl.replace(/\\/$/, '') + path;
    for (const [key, val] of Object.entries(pathParams)) {
      url = url.replace(\`{\${key}}\`, encodeURIComponent(val));
    }
    const qs = Object.entries(queryParams)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => \`\${encodeURIComponent(k)}=\${encodeURIComponent(v)}\`)
      .join('&');
    if (qs) url += '?' + qs;

    const response = await this.fetch(url, {
      method,
      headers: this._buildHeaders(),
      body: body !== null ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ApiError(response.status, errorBody, method, url);
    }
    const contentType = response.headers.get('content-type') || '';
    return contentType.includes('application/json') ? response.json() : response.text();
  }

${methods}
}

export class ApiError extends Error {
  constructor(status, body, method, url) {
    super(\`\${method} \${url} failed with \${status}: \${body}\`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}
`;
}

function renderMethod(op: SdkOperation): string {
  const name = op.operationId;
  const params: string[] = [];
  if (op.pathParams.length > 0) params.push(...op.pathParams);
  if (op.bodyType) params.push('body');
  params.push('options = {}');

  const pathParamsObj = op.pathParams.length > 0
    ? `{ ${op.pathParams.map((p) => p).join(', ')} }`
    : '{}';

  const bodyArg = op.bodyType ? 'body' : 'null';

  return `  /** ${op.summary || name} */
  async ${name}(${params.join(', ')}) {
    return this._request('${op.method}', '${op.path}', {
      pathParams: ${pathParamsObj},
      queryParams: options.query || {},
      body: ${bodyArg},
    });
  }`;
}

// Import type
import type { SdkOperation } from '../lib/sdk-types.js';

function renderReadme(spec: SdkSpec): string {
  return `# ${spec.packageName}

Auto-generated JavaScript SDK for ${spec.packageName}, version ${spec.version}.

## Installation

\`\`\`bash
npm install ${spec.packageName}
\`\`\`

## Usage

\`\`\`javascript
import { ApiClient } from '${spec.packageName}';

const client = new ApiClient({
  baseUrl: '${spec.baseUrl}',
  bearerToken: 'your-token',
});

// Example: list operations
${spec.operations.slice(0, 1).map((op) => `const result = await client.${op.operationId}();`).join('\n')}
\`\`\`

## Operations

${spec.operations.map((op) => `- \`${op.operationId}\` — ${op.method} ${op.path}${op.summary ? ` — ${op.summary}` : ''}`).join('\n')}
`;
}
