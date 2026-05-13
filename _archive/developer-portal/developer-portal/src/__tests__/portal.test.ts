import { describe, it, expect, beforeEach } from 'vitest';
import { parseOpenApiSpec, findOperationByPath, listOperationsByTag, groupOperationsByTag } from '../lib/openapi-parser.js';
import {
  registerSpec, unregisterSpec, listSpecs, getSpec, getLatestVersion, compareVersions, _resetRegistry,
} from '../services/spec-registry.service.js';
import { diffSpecs } from '../services/changelog.service.js';
import { generateExamples } from '../services/examples.service.js';
import { PortalError, isPortalError } from '../lib/portal-errors.js';

const SAMPLE_SPEC: Record<string, unknown> = {
  openapi: '3.0.3',
  info: { title: 'Test API', version: '1.0.0', description: 'Test', contact: { email: 'test@example.com' } },
  servers: [{ url: 'https://api.example.com/v1', description: 'Prod' }],
  tags: [{ name: 'tickets', description: 'Tickets' }, { name: 'orders', description: 'Orders' }],
  paths: {
    '/tickets': {
      get: {
        operationId: 'listTickets', summary: 'List tickets', tags: ['tickets'],
        parameters: [{ name: 'limit', in: 'query', required: false, description: 'Page size' }],
        responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'array' } } } } },
        security: [{ bearerAuth: [] }],
      },
      post: {
        operationId: 'createTicket', summary: 'Create ticket', tags: ['tickets'],
        requestBody: {
          required: true, description: 'Ticket data',
          content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'integer' } }, required: ['name'] } } },
        },
        responses: { '201': { description: 'Created' }, '400': { description: 'Bad Request' } },
        security: [{ bearerAuth: [] }],
      },
    },
    '/orders/{orderId}': {
      get: {
        operationId: 'getOrder', summary: 'Get order', tags: ['orders'],
        parameters: [{ name: 'orderId', in: 'path', required: true, description: 'Order ID' }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not Found' } },
      },
    },
  },
  components: {
    schemas: {
      Ticket: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Ticket ID' },
          price: { type: 'integer', description: 'Price in hellers' },
        },
        required: ['id'],
      },
    },
  },
};

// ---------------------------------------------------------------------------
// parseOpenApiSpec
// ---------------------------------------------------------------------------
describe('parseOpenApiSpec', () => {
  it('parses info section', () => {
    const spec = parseOpenApiSpec(SAMPLE_SPEC);
    expect(spec.info.title).toBe('Test API');
    expect(spec.info.version).toBe('1.0.0');
    expect(spec.info.contact?.email).toBe('test@example.com');
  });

  it('parses servers', () => {
    const spec = parseOpenApiSpec(SAMPLE_SPEC);
    expect(spec.servers).toHaveLength(1);
    expect(spec.servers[0].url).toBe('https://api.example.com/v1');
  });

  it('parses tags', () => {
    const spec = parseOpenApiSpec(SAMPLE_SPEC);
    expect(spec.tags).toHaveLength(2);
  });

  it('extracts all operations', () => {
    const spec = parseOpenApiSpec(SAMPLE_SPEC);
    expect(spec.operations).toHaveLength(3);
    const methods = spec.operations.map((o) => `${o.method} ${o.path}`);
    expect(methods).toContain('GET /tickets');
    expect(methods).toContain('POST /tickets');
    expect(methods).toContain('GET /orders/{orderId}');
  });

  it('parses operation parameters', () => {
    const spec = parseOpenApiSpec(SAMPLE_SPEC);
    const getOrder = spec.operations.find((o) => o.path === '/orders/{orderId}')!;
    expect(getOrder.parameters).toHaveLength(1);
    expect(getOrder.parameters[0].name).toBe('orderId');
    expect(getOrder.parameters[0].in).toBe('path');
    expect(getOrder.parameters[0].required).toBe(true);
  });

  it('parses request body with content type', () => {
    const spec = parseOpenApiSpec(SAMPLE_SPEC);
    const post = spec.operations.find((o) => o.path === '/tickets' && o.method === 'POST')!;
    expect(post.requestBody).not.toBeNull();
    expect(post.requestBody!.contentType).toBe('application/json');
    expect(post.requestBody!.required).toBe(true);
  });

  it('parses response codes', () => {
    const spec = parseOpenApiSpec(SAMPLE_SPEC);
    const getOrder = spec.operations.find((o) => o.path === '/orders/{orderId}')!;
    expect(getOrder.responses.map((r) => r.code)).toEqual(['200', '404']);
  });

  it('parses schemas with required properties', () => {
    const spec = parseOpenApiSpec(SAMPLE_SPEC);
    expect(spec.schemas).toHaveLength(1);
    const ticket = spec.schemas[0];
    expect(ticket.name).toBe('Ticket');
    expect(ticket.properties).toHaveLength(2);
    expect(ticket.properties.find((p) => p.name === 'id')?.required).toBe(true);
    expect(ticket.properties.find((p) => p.name === 'price')?.required).toBe(false);
  });

  it('handles empty/missing fields gracefully', () => {
    const spec = parseOpenApiSpec({});
    expect(spec.info.title).toBe('');
    expect(spec.operations).toEqual([]);
    expect(spec.schemas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------
describe('navigation', () => {
  const parsed = parseOpenApiSpec(SAMPLE_SPEC);

  it('findOperationByPath returns exact match', () => {
    const op = findOperationByPath(parsed, '/tickets', 'GET');
    expect(op?.operationId).toBe('listTickets');
  });

  it('findOperationByPath is case-insensitive on method', () => {
    expect(findOperationByPath(parsed, '/tickets', 'get')).not.toBeNull();
  });

  it('findOperationByPath returns null for missing', () => {
    expect(findOperationByPath(parsed, '/missing', 'GET')).toBeNull();
  });

  it('listOperationsByTag filters correctly', () => {
    expect(listOperationsByTag(parsed, 'tickets')).toHaveLength(2);
    expect(listOperationsByTag(parsed, 'orders')).toHaveLength(1);
  });

  it('groupOperationsByTag groups by tag', () => {
    const groups = groupOperationsByTag(parsed);
    expect(Object.keys(groups).sort()).toEqual(['orders', 'tickets']);
    expect(groups.tickets).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Spec registry
// ---------------------------------------------------------------------------
describe('spec registry', () => {
  beforeEach(() => _resetRegistry());

  it('registers a valid spec', () => {
    const meta = registerSpec('1.0.0', SAMPLE_SPEC);
    expect(meta.version).toBe('1.0.0');
    expect(meta.operationCount).toBe(3);
    expect(meta.schemaCount).toBe(1);
  });

  it('rejects invalid semver version', () => {
    expect(() => registerSpec('v1', SAMPLE_SPEC)).toThrow(PortalError);
  });

  it('retrieves registered spec', () => {
    registerSpec('1.0.0', SAMPLE_SPEC);
    const spec = getSpec('1.0.0');
    expect(spec.info.title).toBe('Test API');
  });

  it('throws when spec not found', () => {
    try { getSpec('missing'); }
    catch (e) { expect(isPortalError(e)).toBe(true); expect((e as PortalError).code).toBe('SPEC_NOT_FOUND'); }
  });

  it('lists specs sorted by version descending', () => {
    registerSpec('1.0.0', SAMPLE_SPEC);
    registerSpec('2.0.0', SAMPLE_SPEC);
    registerSpec('1.5.0', SAMPLE_SPEC);
    const list = listSpecs();
    expect(list.map((s) => s.version)).toEqual(['2.0.0', '1.5.0', '1.0.0']);
  });

  it('getLatestVersion returns highest', () => {
    registerSpec('1.0.0', SAMPLE_SPEC);
    registerSpec('2.5.1', SAMPLE_SPEC);
    expect(getLatestVersion()).toBe('2.5.1');
  });

  it('returns null for empty registry', () => {
    expect(getLatestVersion()).toBeNull();
  });

  it('unregisters a spec', () => {
    registerSpec('1.0.0', SAMPLE_SPEC);
    unregisterSpec('1.0.0');
    expect(listSpecs()).toHaveLength(0);
  });
});

describe('compareVersions', () => {
  it('handles major version differences', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
  });
  it('handles minor version differences', () => {
    expect(compareVersions('1.2.0', '1.1.0')).toBe(1);
  });
  it('handles patch version differences', () => {
    expect(compareVersions('1.0.5', '1.0.3')).toBe(1);
  });
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Changelog diff
// ---------------------------------------------------------------------------
describe('diffSpecs', () => {
  const V1 = parseOpenApiSpec(SAMPLE_SPEC);

  it('detects added operation', () => {
    const v2Spec = {
      ...SAMPLE_SPEC,
      paths: {
        ...(SAMPLE_SPEC.paths as object),
        '/new-endpoint': { get: { summary: 'New', tags: ['tickets'], responses: { '200': { description: 'OK' } } } },
      },
    };
    const V2 = parseOpenApiSpec(v2Spec);
    const diff = diffSpecs('1.0.0', '2.0.0', V1, V2);
    expect(diff.addedOperations).toHaveLength(1);
    expect(diff.addedOperations[0].path).toBe('/new-endpoint');
    expect(diff.breakingChanges).toBe(0);
  });

  it('detects removed operation as breaking', () => {
    const v2Spec = {
      ...SAMPLE_SPEC,
      paths: { '/tickets': (SAMPLE_SPEC.paths as any)['/tickets'] },
    };
    const V2 = parseOpenApiSpec(v2Spec);
    const diff = diffSpecs('1.0.0', '2.0.0', V1, V2);
    expect(diff.removedOperations).toHaveLength(1);
    expect(diff.removedOperations[0].path).toBe('/orders/{orderId}');
    expect(diff.breakingChanges).toBe(1);
  });

  it('detects added required parameter', () => {
    const v2Spec = JSON.parse(JSON.stringify(SAMPLE_SPEC));
    (v2Spec.paths['/tickets'].get.parameters as any[]).push({
      name: 'event_id', in: 'query', required: true, description: 'Event ID filter',
    });
    const V2 = parseOpenApiSpec(v2Spec);
    const diff = diffSpecs('1.0.0', '2.0.0', V1, V2);
    expect(diff.modifiedOperations).toHaveLength(1);
    expect(diff.modifiedOperations[0].changes.some((c) => c.includes('event_id'))).toBe(true);
  });

  it('detects schema additions and removals', () => {
    const v2Spec = JSON.parse(JSON.stringify(SAMPLE_SPEC));
    (v2Spec.components.schemas as any).Order = { type: 'object', properties: {} };
    delete (v2Spec.components.schemas as any).Ticket;
    const V2 = parseOpenApiSpec(v2Spec);
    const diff = diffSpecs('1.0.0', '2.0.0', V1, V2);
    expect(diff.addedSchemas).toContain('Order');
    expect(diff.removedSchemas).toContain('Ticket');
    expect(diff.breakingChanges).toBe(1);  // removed schema
  });
});

// ---------------------------------------------------------------------------
// Examples generator
// ---------------------------------------------------------------------------
describe('generateExamples', () => {
  const parsed = parseOpenApiSpec(SAMPLE_SPEC);
  const postOp = parsed.operations.find((o) => o.method === 'POST')!;
  const getOp = parsed.operations.find((o) => o.path === '/orders/{orderId}')!;

  it('generates all 3 languages by default', () => {
    const examples = generateExamples(postOp, { baseUrl: 'https://api.example.com' });
    expect(examples.map((e) => e.language)).toEqual(['curl', 'javascript', 'python']);
  });

  it('generates curl with Authorization header for secured ops', () => {
    const examples = generateExamples(postOp, { baseUrl: 'https://api.example.com' });
    const curl = examples.find((e) => e.language === 'curl')!;
    expect(curl.code).toContain('curl -X POST');
    expect(curl.code).toContain('Authorization: Bearer');
  });

  it('generates JavaScript fetch with body', () => {
    const examples = generateExamples(postOp, { baseUrl: 'https://api.example.com' });
    const js = examples.find((e) => e.language === 'javascript')!;
    expect(js.code).toContain("await fetch(");
    expect(js.code).toContain('JSON.stringify');
  });

  it('generates Python requests with path params', () => {
    const examples = generateExamples(getOp, { baseUrl: 'https://api.example.com' });
    const py = examples.find((e) => e.language === 'python')!;
    expect(py.code).toContain('import requests');
    expect(py.code).toContain('requests.get');
    expect(py.code).toContain('<orderId>');
  });

  it('filters languages by input', () => {
    const examples = generateExamples(postOp, { baseUrl: 'https://api.example.com' }, ['curl']);
    expect(examples).toHaveLength(1);
    expect(examples[0].language).toBe('curl');
  });

  it('uses provided bearer token when available', () => {
    const examples = generateExamples(postOp, { baseUrl: 'https://api.example.com', bearerToken: 'test-token-123' });
    const curl = examples.find((e) => e.language === 'curl')!;
    expect(curl.code).toContain('Bearer test-token-123');
  });
});

// ---------------------------------------------------------------------------
// PortalError
// ---------------------------------------------------------------------------
describe('PortalError', () => {
  it('maps codes to status', () => {
    expect(new PortalError('SPEC_NOT_FOUND').statusCode).toBe(404);
    expect(new PortalError('INVALID_VERSION').statusCode).toBe(400);
    expect(new PortalError('SPEC_PARSE_ERROR').statusCode).toBe(500);
  });
  it('type guard works', () => {
    expect(isPortalError(new PortalError('SPEC_NOT_FOUND'))).toBe(true);
    expect(isPortalError(new Error())).toBe(false);
  });
});
