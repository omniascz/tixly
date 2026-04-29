// OpenTelemetry distributed tracing — typy a rozhraní
//
// Všechny OTEL typy jsou definovány jako rozhraní (bez závislosti na @opentelemetry/* balíčcích),
// aby byl modul plně testovatelný. V produkci se implementace injektuje z real OTEL SDK.

export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';
export type SpanStatusCode = 'unset' | 'ok' | 'error';

export interface SpanAttributes {
  [key: string]: string | number | boolean | string[] | undefined;
}

export interface SpanStatus {
  code: SpanStatusCode;
  message?: string;
}

export interface Span {
  setAttribute(key: string, value: string | number | boolean): this;
  setAttributes(attrs: SpanAttributes): this;
  setStatus(status: SpanStatus): this;
  recordException(error: Error | string): this;
  end(): void;
  isRecording(): boolean;
  spanContext(): SpanContext;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

export interface SpanOptions {
  kind?: SpanKind;
  attributes?: SpanAttributes;
  parentSpan?: Span;
}

export interface Tracer {
  startSpan(name: string, options?: SpanOptions): Span;
  startActiveSpan<T>(name: string, fn: (span: Span) => T, options?: SpanOptions): T;
}

export interface TracerConfig {
  serviceName: string;
  serviceVersion?: string;
  environment?: string;
  exporterType: 'jaeger' | 'honeycomb' | 'otlp' | 'console' | 'noop';
  exporterEndpoint?: string;
  honeycombApiKey?: string;
  honeycombDataset?: string;
  sampleRate?: number; // 0.0–1.0, default 1.0
}

// DB adapter interface (same pattern as other modules)
export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

// Cache adapter interface
export interface CacheAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
}

// Kafka-style message interface
export interface KafkaMessage {
  topic: string;
  partition?: number;
  offset?: string;
  key?: string;
  value: unknown;
}
