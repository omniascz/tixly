import { describe, it, expect } from 'vitest';
import { openApiToSdkSpec } from '../lib/spec-adapter.js';
import { generateJavaScriptSdk } from '../generators/javascript.js';
import { generateTypeScriptSdk } from '../generators/typescript.js';
import { generatePythonSdk } from '../generators/python.js';

const SAMPLE: Record<string, unknown> = {
  openapi: '3.0.3',
  info: { title: 'Test API', version: '1.0.0' },
  servers: [{ url: 'https://api.test.com/v1' }],
  paths: {
    '/tickets': {
      get: {
        operationId: 'listTickets', summary: 'List tickets', tags: ['tickets'],
        parameters: [
          { name: 'limit', in: 'query' },
          { name: 'offset', in: 'query' },
        ],
        responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/TicketList' } } } } },
      },
      post: {
        operationId: 'createTicket', summary: 'Create ticket', tags: ['tickets'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Ticket' } } },
        },
        responses: { '201': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Ticket' } } } } },
      },
    },
    '/tickets/{ticketId}': {
      get: {
        operationId: 'getTicket', summary: 'Get ticket', tags: ['tickets'],
        parameters: [{ name: 'ticketId', in: 'path', required: true }],
        responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Ticket' } } } } },
      },
      delete: {
        operationId: 'deleteTicket', summary: 'Delete ticket', tags: ['tickets'],
        parameters: [{ name: 'ticketId', in: 'path', required: true }],
        responses: { '204': {} },
      },
    },
  },
  components: {
    schemas: {
      Ticket: {
        type: 'object',
        required: ['id', 'price'],
        properties: {
          id: { type: 'string' },
          price: { type: 'integer' },
          name: { type: 'string' },
          isActive: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
      TicketList: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/Ticket' } },
          total: { type: 'integer' },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// openApiToSdkSpec
// ---------------------------------------------------------------------------
describe('openApiToSdkSpec', () => {
  it('extracts operations from all paths and methods', () => {
    const spec = openApiToSdkSpec(SAMPLE, { packageName: 'test-sdk', version: '1.0.0' });
    expect(spec.operations).toHaveLength(4);
    const methods = spec.operations.map((o) => o.operationId).sort();
    expect(methods).toEqual(['createTicket', 'deleteTicket', 'getTicket', 'listTickets']);
  });

  it('identifies path params', () => {
    const spec = openApiToSdkSpec(SAMPLE, { packageName: 'test-sdk', version: '1.0.0' });
    const getOp = spec.operations.find((o) => o.operationId === 'getTicket')!;
    expect(getOp.pathParams).toEqual(['ticketId']);
    expect(getOp.queryParams).toEqual([]);
  });

  it('identifies query params', () => {
    const spec = openApiToSdkSpec(SAMPLE, { packageName: 'test-sdk', version: '1.0.0' });
    const listOp = spec.operations.find((o) => o.operationId === 'listTickets')!;
    expect(listOp.queryParams).toEqual(['limit', 'offset']);
  });

  it('resolves body type from $ref', () => {
    const spec = openApiToSdkSpec(SAMPLE, { packageName: 'test-sdk', version: '1.0.0' });
    const postOp = spec.operations.find((o) => o.operationId === 'createTicket')!;
    expect(postOp.bodyType).toBe('Ticket');
  });

  it('resolves response type from $ref', () => {
    const spec = openApiToSdkSpec(SAMPLE, { packageName: 'test-sdk', version: '1.0.0' });
    const getOp = spec.operations.find((o) => o.operationId === 'getTicket')!;
    expect(getOp.responseType).toBe('Ticket');
  });

  it('extracts schemas with required flag', () => {
    const spec = openApiToSdkSpec(SAMPLE, { packageName: 'test-sdk', version: '1.0.0' });
    const ticket = spec.schemas.find((s) => s.name === 'Ticket')!;
    expect(ticket.properties.find((p) => p.name === 'id')?.required).toBe(true);
    expect(ticket.properties.find((p) => p.name === 'price')?.required).toBe(true);
    expect(ticket.properties.find((p) => p.name === 'name')?.required).toBe(false);
  });

  it('maps OpenAPI types to TypeScript types', () => {
    const spec = openApiToSdkSpec(SAMPLE, { packageName: 'test-sdk', version: '1.0.0' });
    const ticket = spec.schemas.find((s) => s.name === 'Ticket')!;
    expect(ticket.properties.find((p) => p.name === 'id')?.type).toBe('string');
    expect(ticket.properties.find((p) => p.name === 'price')?.type).toBe('number');
    expect(ticket.properties.find((p) => p.name === 'isActive')?.type).toBe('boolean');
    expect(ticket.properties.find((p) => p.name === 'tags')?.type).toBe('string[]');
  });

  it('uses provided baseUrl over server[0]', () => {
    const spec = openApiToSdkSpec(SAMPLE, { packageName: 'test-sdk', version: '1.0.0', baseUrl: 'https://override.com' });
    expect(spec.baseUrl).toBe('https://override.com');
  });

  it('derives operationId from path + method when missing', () => {
    const noIdSpec = {
      paths: { '/foo/{id}': { get: { responses: { '200': {} } } } },
    };
    const spec = openApiToSdkSpec(noIdSpec, { packageName: 't', version: '1.0.0' });
    expect(spec.operations[0].operationId).toMatch(/^get/);
  });
});

// ---------------------------------------------------------------------------
// JavaScript generator
// ---------------------------------------------------------------------------
describe('generateJavaScriptSdk', () => {
  const sdkSpec = openApiToSdkSpec(SAMPLE, { packageName: '@test/sdk', version: '1.0.0' });
  const sdk = generateJavaScriptSdk(sdkSpec);

  it('emits package.json, client.js, README', () => {
    const paths = sdk.files.map((f) => f.path);
    expect(paths).toContain('package.json');
    expect(paths).toContain('src/client.js');
    expect(paths).toContain('README.md');
  });

  it('package.json has correct name and version', () => {
    const pkg = JSON.parse(sdk.files.find((f) => f.path === 'package.json')!.content);
    expect(pkg.name).toBe('@test/sdk');
    expect(pkg.version).toBe('1.0.0');
  });

  it('client.js includes ApiClient class', () => {
    const client = sdk.files.find((f) => f.path === 'src/client.js')!.content;
    expect(client).toContain('export class ApiClient');
    expect(client).toContain('export class ApiError');
  });

  it('client.js has method per operation', () => {
    const client = sdk.files.find((f) => f.path === 'src/client.js')!.content;
    expect(client).toContain('async listTickets(');
    expect(client).toContain('async createTicket(');
    expect(client).toContain('async getTicket(ticketId');
    expect(client).toContain('async deleteTicket(ticketId');
  });

  it('client.js handles path param substitution', () => {
    const client = sdk.files.find((f) => f.path === 'src/client.js')!.content;
    expect(client).toContain('pathParams:');
    expect(client).toContain('encodeURIComponent');
  });

  it('README lists all operations', () => {
    const readme = sdk.files.find((f) => f.path === 'README.md')!.content;
    expect(readme).toContain('listTickets');
    expect(readme).toContain('createTicket');
  });
});

// ---------------------------------------------------------------------------
// TypeScript generator
// ---------------------------------------------------------------------------
describe('generateTypeScriptSdk', () => {
  const sdkSpec = openApiToSdkSpec(SAMPLE, { packageName: '@test/ts-sdk', version: '2.0.0' });
  const sdk = generateTypeScriptSdk(sdkSpec);

  it('emits typescript source files', () => {
    const paths = sdk.files.map((f) => f.path);
    expect(paths).toContain('src/client.ts');
    expect(paths).toContain('src/types.ts');
    expect(paths).toContain('tsconfig.json');
  });

  it('types.ts contains schema interfaces', () => {
    const types = sdk.files.find((f) => f.path === 'src/types.ts')!.content;
    expect(types).toContain('export interface Ticket');
    expect(types).toContain('id: string;');        // required
    expect(types).toContain('name?: string;');     // optional
  });

  it('client.ts imports types and declares typed methods', () => {
    const client = sdk.files.find((f) => f.path === 'src/client.ts')!.content;
    expect(client).toContain("import type { Ticket, TicketList }");
    expect(client).toContain('Promise<Ticket>');
  });

  it('client.ts has strict TypeScript class', () => {
    const client = sdk.files.find((f) => f.path === 'src/client.ts')!.content;
    expect(client).toContain('private baseUrl: string');
    expect(client).toContain('ApiClientOptions');
  });
});

// ---------------------------------------------------------------------------
// Python generator
// ---------------------------------------------------------------------------
describe('generatePythonSdk', () => {
  const sdkSpec = openApiToSdkSpec(SAMPLE, { packageName: 'test-sdk', version: '1.0.0' });
  const sdk = generatePythonSdk(sdkSpec);

  it('emits setup.py, pyproject.toml, package module', () => {
    const paths = sdk.files.map((f) => f.path);
    expect(paths).toContain('setup.py');
    expect(paths).toContain('pyproject.toml');
    expect(paths).toContain('test_sdk/__init__.py');
    expect(paths).toContain('test_sdk/client.py');
  });

  it('client.py has ApiClient class with requests', () => {
    const client = sdk.files.find((f) => f.path === 'test_sdk/client.py')!.content;
    expect(client).toContain('import requests');
    expect(client).toContain('class ApiClient:');
    expect(client).toContain('class ApiError(Exception):');
  });

  it('converts operationId to snake_case method names', () => {
    const client = sdk.files.find((f) => f.path === 'test_sdk/client.py')!.content;
    expect(client).toContain('def list_tickets(');
    expect(client).toContain('def create_ticket(');
    expect(client).toContain('def get_ticket(');
  });

  it('path params are typed Any and snake_case', () => {
    const client = sdk.files.find((f) => f.path === 'test_sdk/client.py')!.content;
    expect(client).toContain('ticket_id: Any');
    expect(client).toContain('path_params={"ticketId": ticket_id}');
  });

  it('setup.py declares requests dependency', () => {
    const setup = sdk.files.find((f) => f.path === 'setup.py')!.content;
    expect(setup).toContain("'requests>=2.28.0'");
  });

  it('__init__.py exports ApiClient and ApiError', () => {
    const init = sdk.files.find((f) => f.path === 'test_sdk/__init__.py')!.content;
    expect(init).toContain('from .client import ApiClient, ApiError');
  });
});
