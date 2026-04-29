/**
 * Shared types for SDK generation.
 */

export type Language = 'javascript' | 'typescript' | 'python';

export interface SdkOperation {
  operationId: string;         // camelCase or snake_case method name
  method: string;              // GET, POST, …
  path: string;                // /tickets/{id}
  pathParams: string[];
  queryParams: string[];
  bodyType: string | null;     // TypeScript/Python type name
  responseType: string;
  summary: string;
  tag: string;
}

export interface SdkSchema {
  name: string;
  properties: Array<{
    name: string;
    type: string;
    required: boolean;
  }>;
}

export interface SdkSpec {
  packageName: string;
  version: string;
  baseUrl: string;
  operations: SdkOperation[];
  schemas: SdkSchema[];
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GeneratedSdk {
  language: Language;
  packageName: string;
  version: string;
  files: GeneratedFile[];
}
