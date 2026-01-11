/**
 * gRPC Client Types
 *
 * Type definitions for resilient gRPC client infrastructure.
 */

/**
 * Logger interface for gRPC client
 * Compatible with pino, winston, console, etc.
 */
export interface GrpcLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

/**
 * Connection state enum
 */
export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
}

/**
 * Metrics for the client (OpenTelemetry-compatible)
 */
export interface ClientMetrics {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalRetries: number;
  circuitBreakerTrips: number;
  cacheHits: number;
  cacheMisses: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  minLatencyMs: number;
  lastResetAt: Date;
}

/**
 * Health status for the client
 */
export interface ClientHealth {
  state: ConnectionState;
  healthy: boolean;
  lastConnectedAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  reconnectAttempts: number;
  latencyMs: number;
  metrics: ClientMetrics;
}

/**
 * Configuration for the resilient client
 */
export interface ResilientClientConfig {
  /** Service name for logging */
  serviceName: string;
  /** gRPC server URL (host:port) */
  grpcUrl: string;
  /** Proto file name (relative to protos directory) */
  protoFile: string;
  /** Package name in the proto file */
  packageName: string;
  /** Service class name in the proto file */
  serviceClassName: string;
  /** Absolute path to protos directory (REQUIRED) */
  protosPath: string;
  /** Logger instance (REQUIRED) */
  logger: GrpcLogger;
  /** Timeout for gRPC calls in ms (default: 5000) */
  timeoutMs?: number;
  /** Number of retries for failed calls (default: 3) */
  retryCount?: number;
  /** Base delay between retries in ms (default: 1000) */
  retryDelayMs?: number;
  /** Maximum reconnect attempts (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Maximum reconnect delay in ms (default: 30000) */
  maxReconnectDelayMs?: number;
  /** Initial reconnect delay in ms (default: 1000) */
  initialReconnectDelayMs?: number;
  /** Whether to use TLS (default: false for development) */
  useTls?: boolean;
  /** Keepalive time in ms (default: 30000) */
  keepaliveTimeMs?: number;
  /** Keepalive timeout in ms (default: 10000) */
  keepaliveTimeoutMs?: number;
  /** Enable fallback cache for graceful degradation (default: false) */
  enableFallbackCache?: boolean;
  /** Fallback cache TTL in ms (default: 60000 - 1 minute) */
  fallbackCacheTtlMs?: number;
  /** Maximum cache size (default: 100 entries) */
  maxCacheSize?: number;
}

/**
 * Options for individual gRPC calls
 */
export interface CallOptions {
  /** Timeout override for this call */
  timeoutMs?: number;
  /** Locale for i18n (sent via metadata) */
  locale?: string;
  /** Client URL for email links (sent via metadata) */
  clientUrl?: string;
  /** Skip retry for this call */
  skipRetry?: boolean;
  /** Cache key for fallback cache (enables caching for this call) */
  cacheKey?: string;
  /** Skip cache for this call */
  skipCache?: boolean;
}

/**
 * Cache entry for fallback responses
 */
export interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  ttl: number;
}

/**
 * Default configuration values (excluding required fields)
 */
export const DEFAULT_CONFIG = {
  timeoutMs: 5000,
  retryCount: 3,
  retryDelayMs: 1000,
  maxReconnectAttempts: Infinity,
  maxReconnectDelayMs: 30000,
  initialReconnectDelayMs: 1000,
  useTls: false,
  keepaliveTimeMs: 30000,
  keepaliveTimeoutMs: 10000,
  enableFallbackCache: false,
  fallbackCacheTtlMs: 60000,
  maxCacheSize: 100,
} as const;

/**
 * Default metrics values
 */
export const DEFAULT_METRICS: ClientMetrics = {
  totalCalls: 0,
  successfulCalls: 0,
  failedCalls: 0,
  totalRetries: 0,
  circuitBreakerTrips: 0,
  cacheHits: 0,
  cacheMisses: 0,
  avgLatencyMs: 0,
  maxLatencyMs: 0,
  minLatencyMs: Infinity,
  lastResetAt: new Date(),
};
