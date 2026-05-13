/**
 * Converts an OpenAPI spec (raw JS object) into the normalized SdkSpec shape
 * consumed by language generators.
 */
import type { SdkOperation, SdkSchema, SdkSpec } from './sdk-types.js';

export interface AdapterOptions {
  packageName: string;
  version: string;
  baseUrl?: string;
}

export function openApiToSdkSpec(openApi: Record<string, unknown>, opts: AdapterOptions): SdkSpec {
  const info = (openApi.info as Record<string, unknown>) ?? {};
  const servers = (openApi.servers as Array<{ url: string }>) ?? [];
  const baseUrl = opts.baseUrl ?? servers[0]?.url ?? 'https://api.example.com';

  const operations: SdkOperation[] = [];
  const paths = (openApi.paths as Record<string, unknown>) ?? {};
  const methods = ['get', 'post', 'put', 'patch', 'delete'];

  for (const [path, pathItem] of Object.entries(paths)) {
    const item = pathItem as Record<string, unknown>;
    for (const method of methods) {
      const op = item[method] as Record<string, unknown> | undefined;
      if (!op) continue;

      const params = (op.parameters as Array<Record<string, unknown>>) ?? [];
      const pathParams = params.filter((p) => p.in === 'path').map((p) => String(p.name));
      const queryParams = params.filter((p) => p.in === 'query').map((p) => String(p.name));

      // Body schema
      let bodyType: string | null = null;
      const rb = op.requestBody as Record<string, unknown> | undefined;
      if (rb) {
        const content = rb.content as Record<string, unknown> | undefined;
        const mediaType = content?.['application/json'] as Record<string, unknown> | undefined;
        const schema = mediaType?.schema as Record<string, unknown> | undefined;
        bodyType = extractTypeName(schema) ?? 'Record<string, unknown>';
      }

      // Response type (first 2xx)
      let responseType = 'unknown';
      const responses = op.responses as Record<string, unknown> | undefined;
      if (responses) {
        for (const [code, resp] of Object.entries(responses)) {
          if (!code.startsWith('2')) continue;
          const r = resp as Record<string, unknown>;
          const content = r.content as Record<string, unknown> | undefined;
          const mediaType = content?.['application/json'] as Record<string, unknown> | undefined;
          const schema = mediaType?.schema as Record<string, unknown> | undefined;
          responseType = extractTypeName(schema) ?? 'unknown';
          break;
        }
      }

      const tags = (op.tags as string[]) ?? [];
      const operationId = String(
        op.operationId ?? deriveOperationId(method, path),
      );

      operations.push({
        operationId,
        method: method.toUpperCase(),
        path,
        pathParams,
        queryParams,
        bodyType,
        responseType,
        summary: String(op.summary ?? ''),
        tag: tags[0] ?? 'default',
      });
    }
  }

  // Schemas
  const schemasObj = ((openApi.components as Record<string, unknown>)?.schemas as Record<string, unknown>) ?? {};
  const schemas: SdkSchema[] = [];
  for (const [name, schemaObj] of Object.entries(schemasObj)) {
    const schema = schemaObj as Record<string, unknown>;
    const required = new Set((schema.required as string[]) ?? []);
    const props = (schema.properties as Record<string, unknown>) ?? {};
    schemas.push({
      name,
      properties: Object.entries(props).map(([propName, propDef]) => {
        const p = propDef as Record<string, unknown>;
        return {
          name: propName,
          type: openApiTypeToTs(p),
          required: required.has(propName),
        };
      }),
    });
  }

  return {
    packageName: opts.packageName,
    version: opts.version,
    baseUrl,
    operations,
    schemas,
  };
}

function extractTypeName(schema: Record<string, unknown> | undefined): string | null {
  if (!schema) return null;
  const ref = schema.$ref as string | undefined;
  if (ref) return ref.replace('#/components/schemas/', '');
  const type = String(schema.type ?? '');
  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    const inner = extractTypeName(items);
    return inner ? `${inner}[]` : 'unknown[]';
  }
  return type || null;
}

function openApiTypeToTs(prop: Record<string, unknown>): string {
  const ref = prop.$ref as string | undefined;
  if (ref) return ref.replace('#/components/schemas/', '');
  const type = String(prop.type ?? 'any');
  switch (type) {
    case 'integer':
    case 'number':
      return 'number';
    case 'string': return 'string';
    case 'boolean': return 'boolean';
    case 'array': {
      const items = prop.items as Record<string, unknown> | undefined;
      return items ? `${openApiTypeToTs(items)}[]` : 'unknown[]';
    }
    case 'object': return 'Record<string, unknown>';
    default: return 'unknown';
  }
}

function deriveOperationId(method: string, path: string): string {
  const clean = path
    .replace(/^\//, '')
    .replace(/\{([^}]+)\}/g, 'By$1')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((p, i) => (i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('');
  return `${method.toLowerCase()}${clean.charAt(0).toUpperCase() + clean.slice(1)}`;
}
