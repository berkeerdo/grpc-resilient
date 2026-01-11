/**
 * Gateway gRPC Client Types
 *
 * Type definitions for API Gateway/Proxy gRPC client infrastructure.
 * Designed for services that act as reverse proxies to multiple backend services.
 *
 * @packageDocumentation
 */

import type { Options as ProtoLoaderOptions } from '@grpc/proto-loader';

/**
 * Connection state for gateway clients
 * @category Gateway
 */
export enum GatewayConnectionState {
  /** Not connected to the backend service */
  DISCONNECTED = 'DISCONNECTED',
  /** Initial connection attempt in progress */
  CONNECTING = 'CONNECTING',
  /** Successfully connected and ready */
  CONNECTED = 'CONNECTED',
  /** Reconnecting after connection loss */
  RECONNECTING = 'RECONNECTING',
}

/**
 * Metrics for gateway gRPC clients (OpenTelemetry-compatible)
 * @category Gateway
 */
export interface GatewayClientMetrics {
  /** Total number of calls made */
  totalCalls: number;
  /** Number of successful calls */
  successfulCalls: number;
  /** Number of failed calls */
  failedCalls: number;
  /** Total retry attempts */
  totalRetries: number;
  /** Average latency in milliseconds */
  avgLatencyMs: number;
  /** Maximum latency recorded */
  maxLatencyMs: number;
  /** Minimum latency recorded */
  minLatencyMs: number;
  /** Last metrics reset timestamp */
  lastResetAt: Date;
}

/**
 * Configuration for gateway gRPC client
 * @category Gateway
 */
export interface GatewayClientConfig {
  /** Service name for logging and metrics */
  serviceName: string;
  /** gRPC server URL (host:port) */
  grpcUrl: string;
  /** Proto file name (relative to protosPath) */
  protoFile: string;
  /** Package name in proto file */
  packageName: string;
  /** Service class name in proto file */
  serviceClassName: string;
  /** Absolute path to protos directory */
  protosPath: string;
  /** Call timeout in milliseconds @default 5000 */
  timeoutMs?: number;
  /** Number of retry attempts @default 3 */
  retryCount?: number;
  /** Base delay between retries in ms @default 1000 */
  retryDelayMs?: number;
  /** Maximum reconnection attempts @default Infinity */
  maxReconnectAttempts?: number;
  /** Maximum delay between reconnects in ms @default 30000 */
  maxReconnectDelayMs?: number;
  /** Initial delay for reconnection in ms @default 1000 */
  initialReconnectDelayMs?: number;
  /** Custom proto loader options */
  protoOptions?: ProtoLoaderOptions;
  /** Use TLS for connection @default false */
  useTls?: boolean;
  /** CA certificate path for TLS */
  tlsCaCertPath?: string;
  /** Client certificate path for mutual TLS */
  tlsClientCertPath?: string;
  /** Client key path for mutual TLS */
  tlsClientKeyPath?: string;
  /** Keepalive time in ms @default 30000 */
  keepaliveTimeMs?: number;
  /** Keepalive timeout in ms @default 10000 */
  keepaliveTimeoutMs?: number;
}

/**
 * Health status for gateway client
 * @category Gateway
 */
export interface GatewayServiceHealth {
  /** Current connection state */
  state: GatewayConnectionState;
  /** Whether the service is healthy and connected */
  healthy: boolean;
  /** Last recorded latency in milliseconds */
  latencyMs: number;
  /** Timestamp of last health check */
  lastCheck: Date;
  /** Timestamp of last successful connection */
  lastConnectedAt: Date | null;
  /** Timestamp of last error */
  lastErrorAt: Date | null;
  /** Last error message if any */
  error?: string;
  /** Number of reconnection attempts */
  reconnectAttempts: number;
  /** Current metrics snapshot */
  metrics: GatewayClientMetrics;
}

/**
 * Per-call options for gateway gRPC calls
 * @category Gateway
 */
export interface GatewayCallOptions {
  /** Timeout override for this specific call (in milliseconds) */
  timeoutMs?: number;
  /** Locale for i18n (sent via gRPC metadata as accept-language) */
  locale?: string;
  /** Client URL for callbacks (sent via gRPC metadata as x-client-url) */
  clientUrl?: string;
  /** Skip retry for this call */
  skipRetry?: boolean;
  /** Additional metadata to send with the call */
  metadata?: Record<string, string>;
}

/**
 * Logger interface for gateway clients
 * @category Gateway
 */
export interface GatewayLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

/**
 * TLS/SSL credential options
 * @category Gateway
 */
export interface TlsCredentialsOptions {
  /** Service name for logging */
  serviceName: string;
  /** Use TLS encryption */
  useTls: boolean;
  /** CA certificate path */
  caCertPath?: string;
  /** Client certificate path (for mutual TLS) */
  clientCertPath?: string;
  /** Client key path (for mutual TLS) */
  clientKeyPath?: string;
  /** Logger instance */
  logger: GatewayLogger;
}

/**
 * Default configuration values for gateway clients
 * @category Gateway
 */
export const GATEWAY_DEFAULT_CONFIG = {
  timeoutMs: 5000,
  retryCount: 3,
  retryDelayMs: 1000,
  maxReconnectAttempts: Infinity,
  maxReconnectDelayMs: 30000,
  initialReconnectDelayMs: 1000,
  useTls: false,
  keepaliveTimeMs: 30000,
  keepaliveTimeoutMs: 10000,
} as const;

/**
 * Default metrics values
 * @category Gateway
 */
export const GATEWAY_DEFAULT_METRICS: GatewayClientMetrics = {
  totalCalls: 0,
  successfulCalls: 0,
  failedCalls: 0,
  totalRetries: 0,
  avgLatencyMs: 0,
  maxLatencyMs: 0,
  minLatencyMs: Infinity,
  lastResetAt: new Date(),
};
