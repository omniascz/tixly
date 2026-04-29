/**
 * Minimal OpenAPI 3.x parser — extracts structured documentation from a spec
 * object (already parsed from YAML/JSON by the caller).
 *
 * We don't depend on `js-yaml` here — the caller passes the parsed JS object.
 * This keeps the module lightweight and easy to test with in-memory fixtures.
 */

export interface OpenApiInfo {
  title: string;
  version: string;
  description: string;
  contact?: { name?: string; email?: string };
}

export interface OpenApiServer {
  url: string;
  description: string;
}

export interface OpenApiOperation {
  path: string;
  method: string;
  operationId: string | null;
  summary: string;
  description: string;
  tags: string[];
  parameters: Array<{
    name: string;
    in: 'query' | 'path' | 'header' | 'cookie';
    required: boolean;
    description: string;
    schema?: unknown;
  }>;
  requestBody: {
    description: string;
    required: boolean;
    contentType: string;
    schema?: unknown;
  } | null;
  responses: Array<{
    code: string;
    description: string;
    contentType?: string;
    schema?: unknown;
  }>;
  security: Array<Record<string, string[]>>;
}

export interface OpenApiSchema {
  name: string;
  type: string;
  description: string;
  properties: Array<{ name: string; type: string; required: boolean; description: string }>;
}

export interface ParsedSpec {
  info: OpenApiInfo;
  servers: OpenApiServer[];
  tags: Array<{ name: string; description: string }>;
  operations: OpenApiOperation[];
  schemas: OpenApiSchema[];
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parseOpenApiSpec(spec: Record<string, unknown>): ParsedSpec {
  const info = parseInfo(spec.info as Record<string, unknown> | undefined);
  const servers = parseServers(spec.servers as unknown[] | undefined);
  const tags = parseTags(spec.tags as unknown[] | undefined);
  const operations = parseOperations(spec.paths as Record<string, unknown> | undefined);
  const schemas = parseSchemas(
    (spec.components as Record<string, unknown> | undefined)?.schemas as Record<string, unknown> | undefined,
  );

  return { info, servers, tags, operations, schemas };
}

function parseInfo(info: Record<string, unknown> | undefined): OpenApiInfo {
  if (!info) return { title: '', version: '', description: '' };
  return {
    title: String(info.title ?? ''),
    version: String(info.version ?? ''),
    description: String(info.description ?? ''),
    contact: info.contact as OpenApiInfo['contact'],
  };
}

function parseServers(servers: unknown[] | undefined): OpenApiServer[] {
  if (!Array.isArray(servers)) return [];
  return servers.map((s) => {
    const sr = s as Record<string, unknown>;
    return { url: String(sr.url ?? ''), description: String(sr.description ?? '') };
  });
}

function parseTags(tags: unknown[] | undefined): Array<{ name: string; description: string }> {
  if (!Array.isArray(tags)) return [];
  return tags.map((t) => {
    const tr = t as Record<string, unknown>;
    return { name: String(tr.name ?? ''), description: String(tr.description ?? '') };
  });
}

function parseOperations(paths: Record<string, unknown> | undefined): OpenApiOperation[] {
  if (!paths) return [];
  const operations: OpenApiOperation[] = [];
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

  for (const [path, pathItem] of Object.entries(paths)) {
    const item = pathItem as Record<string, unknown>;
    for (const method of methods) {
      const op = item[method] as Record<string, unknown> | undefined;
      if (!op) continue;
      operations.push(parseOperation(path, method.toUpperCase(), op));
    }
  }
  return operations;
}

function parseOperation(path: string, method: string, op: Record<string, unknown>): OpenApiOperation {
  const parameters = Array.isArray(op.parameters)
    ? (op.parameters as Array<Record<string, unknown>>).map((p) => ({
        name: String(p.name ?? ''),
        in: String(p.in ?? 'query') as OpenApiOperation['parameters'][number]['in'],
        required: Boolean(p.required),
        description: String(p.description ?? ''),
        schema: p.schema,
      }))
    : [];

  // Request body
  let requestBody: OpenApiOperation['requestBody'] = null;
  const rb = op.requestBody as Record<string, unknown> | undefined;
  if (rb) {
    const content = rb.content as Record<string, unknown> | undefined;
    const contentType = content ? Object.keys(content)[0] ?? 'application/json' : 'application/json';
    const mediaType = content?.[contentType] as Record<string, unknown> | undefined;
    requestBody = {
      description: String(rb.description ?? ''),
      required: Boolean(rb.required),
      contentType,
      schema: mediaType?.schema,
    };
  }

  // Responses
  const responses: OpenApiOperation['responses'] = [];
  const respObj = op.responses as Record<string, unknown> | undefined;
  if (respObj) {
    for (const [code, resp] of Object.entries(respObj)) {
      const r = resp as Record<string, unknown>;
      const content = r.content as Record<string, unknown> | undefined;
      const contentType = content ? Object.keys(content)[0] : undefined;
      const mediaType = contentType ? (content![contentType] as Record<string, unknown>) : undefined;
      responses.push({
        code,
        description: String(r.description ?? ''),
        contentType,
        schema: mediaType?.schema,
      });
    }
  }

  return {
    path,
    method,
    operationId: op.operationId ? String(op.operationId) : null,
    summary: String(op.summary ?? ''),
    description: String(op.description ?? ''),
    tags: Array.isArray(op.tags) ? (op.tags as string[]).map(String) : [],
    parameters,
    requestBody,
    responses,
    security: Array.isArray(op.security) ? (op.security as Array<Record<string, string[]>>) : [],
  };
}

function parseSchemas(schemas: Record<string, unknown> | undefined): OpenApiSchema[] {
  if (!schemas) return [];
  const out: OpenApiSchema[] = [];
  for (const [name, schemaObj] of Object.entries(schemas)) {
    const schema = schemaObj as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    const props = schema.properties as Record<string, unknown> | undefined;
    const properties: OpenApiSchema['properties'] = [];
    if (props) {
      for (const [propName, propDef] of Object.entries(props)) {
        const p = propDef as Record<string, unknown>;
        properties.push({
          name: propName,
          type: String(p.type ?? p.$ref ?? 'object'),
          required: required.includes(propName),
          description: String(p.description ?? ''),
        });
      }
    }
    out.push({
      name,
      type: String(schema.type ?? 'object'),
      description: String(schema.description ?? ''),
      properties,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Filters & navigation
// ---------------------------------------------------------------------------

export function findOperationByPath(spec: ParsedSpec, path: string, method: string): OpenApiOperation | null {
  const m = method.toUpperCase();
  return spec.operations.find((op) => op.path === path && op.method === m) ?? null;
}

export function listOperationsByTag(spec: ParsedSpec, tag: string): OpenApiOperation[] {
  return spec.operations.filter((op) => op.tags.includes(tag));
}

export function groupOperationsByTag(spec: ParsedSpec): Record<string, OpenApiOperation[]> {
  const groups: Record<string, OpenApiOperation[]> = {};
  for (const op of spec.operations) {
    const tags = op.tags.length > 0 ? op.tags : ['Untagged'];
    for (const tag of tags) {
      if (!groups[tag]) groups[tag] = [];
      groups[tag].push(op);
    }
  }
  return groups;
}
