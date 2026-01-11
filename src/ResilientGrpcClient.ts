/**
 * Resilient gRPC Client
 *
 * Production-ready base class for gRPC service clients with:
 * - Lazy connection (connect on first use, not at startup)
 * - Background reconnection with exponential backoff
 * - Automatic retry with exponential backoff
 * - Graceful degradation with fallback cache
 * - Metrics tracking (OpenTelemetry-compatible)
 *
 * @example
 * ```typescript
 * import { ResilientGrpcClient } from 'grpc-resilient';
 *
 * class AuthClient extends ResilientGrpcClient<AuthServiceClient> {
 *   constructor(grpcUrl: string, logger: GrpcLogger) {
 *     super({
 *       serviceName: 'AuthService',
 *       grpcUrl,
 *       protoFile: 'auth.proto',
 *       packageName: 'myapp.auth',
 *       serviceClassName: 'AuthService',
 *       protosPath: '/path/to/protos',
 *       logger,
 *     });
 *   }
 *
 *   async validateToken(token: string) {
 *     return this.call('ValidateToken', { token });
 *   }
 * }
 * ```
 */
import * as grpc from '@grpc/grpc-js';
import { EventEmitter } from 'events';

import {
  ConnectionState,
  DEFAULT_CONFIG,
  type ResilientClientConfig,
  type CallOptions,
  type ClientHealth,
  type ClientMetrics,
  type GrpcLogger,
} from './types.js';
import { FallbackCache } from './FallbackCache.js';
import { MetricsTracker } from './MetricsTracker.js';
import { ConnectionManager } from './ConnectionManager.js';
import { createGrpcClient, type ProtoConfig } from './ProtoLoader.js';
import { executeGrpcCall, isRetryableError, isConnectionError, sleep } from './CallExecutor.js';
import { generateCacheKey } from './utils.js';

/**
 * Internal config type with defaults applied
 * @internal
 */
type InternalConfig = Omit<Required<ResilientClientConfig>, 'logger' | 'protosPath'> & {
  logger: GrpcLogger;
  protosPath: string;
};

/**
 * Base class for resilient gRPC clients
 */
export abstract class ResilientGrpcClient<
  TClient extends grpc.Client = grpc.Client,
> extends EventEmitter {
  protected readonly config: InternalConfig;
  protected readonly logger: GrpcLogger;
  protected readonly metricsTracker: MetricsTracker;
  protected readonly fallbackCache: FallbackCache;
  protected readonly connectionManager: ConnectionManager<TClient>;

  // Expose state for subclasses
  protected get client(): TClient | null {
    return this.connectionManager.getClient();
  }

  protected get state(): ConnectionState {
    return this.connectionManager.getState();
  }

  constructor(config: ResilientClientConfig) {
    super();

    if (!config.protosPath) {
      throw new Error('protosPath is required - provide absolute path to protos directory');
    }
    if (!config.logger) {
      throw new Error('logger is required');
    }

    this.logger = config.logger;
    this.config = { ...DEFAULT_CONFIG, ...config } as InternalConfig;
    this.metricsTracker = new MetricsTracker();
    this.fallbackCache = new FallbackCache(
      config.serviceName,
      this.logger,
      this.config.maxCacheSize,
      this.config.fallbackCacheTtlMs
    );

    // Create proto config
    const protoConfig: ProtoConfig = {
      protosPath: this.config.protosPath,
      protoFile: this.config.protoFile,
      packageName: this.config.packageName,
      serviceClassName: this.config.serviceClassName,
      grpcUrl: this.config.grpcUrl,
      useTls: this.config.useTls,
      keepaliveTimeMs: this.config.keepaliveTimeMs,
      keepaliveTimeoutMs: this.config.keepaliveTimeoutMs,
    };

    // Create connection manager with client factory
    this.connectionManager = new ConnectionManager<TClient>(
      {
        serviceName: this.config.serviceName,
        grpcUrl: this.config.grpcUrl,
        timeoutMs: this.config.timeoutMs,
        maxReconnectAttempts: this.config.maxReconnectAttempts,
        initialReconnectDelayMs: this.config.initialReconnectDelayMs,
        maxReconnectDelayMs: this.config.maxReconnectDelayMs,
      },
      this.logger,
      () => createGrpcClient<TClient>(protoConfig)
    );

    // Forward events from connection manager
    this.connectionManager.on('connected', () => this.emit('connected'));
    this.connectionManager.on('connecting', () => this.emit('connecting'));
    this.connectionManager.on('disconnected', () => this.emit('disconnected'));
    this.connectionManager.on('error', (err) => this.emit('error', err));
  }

  // ============================================
  // PUBLIC API
  // ============================================

  async ensureConnected(): Promise<boolean> {
    return this.connectionManager.ensureConnected();
  }

  getHealth(): ClientHealth {
    return {
      state: this.connectionManager.getState(),
      healthy: this.connectionManager.isConnected(),
      lastConnectedAt: this.connectionManager.getLastConnectedAt(),
      lastErrorAt: this.connectionManager.getLastErrorAt(),
      lastError: this.connectionManager.getLastError(),
      reconnectAttempts: this.connectionManager.getReconnectAttempts(),
      latencyMs: this.metricsTracker.getMetrics().avgLatencyMs,
      metrics: this.metricsTracker.getMetrics(),
    };
  }

  getMetrics(): ClientMetrics {
    return this.metricsTracker.getMetrics();
  }

  resetMetrics(): void {
    this.metricsTracker.reset();
  }

  clearCache(): void {
    this.fallbackCache.clear();
  }

  isConnected(): boolean {
    return this.connectionManager.isConnected();
  }

  close(): void {
    this.connectionManager.close();
    this.fallbackCache.clear();
    this.removeAllListeners();
    this.logger.info({ service: this.config.serviceName }, 'gRPC client closed');
  }

  // ============================================
  // PROTECTED CALL API
  // ============================================

  /**
   * Make a gRPC call with automatic connection and retry
   */
  protected async call<TRequest, TResponse>(
    methodName: string,
    request: TRequest,
    options?: CallOptions
  ): Promise<TResponse> {
    const { skipRetry, cacheKey, skipCache } = options || {};
    const maxAttempts = skipRetry ? 1 : this.config.retryCount + 1;
    const effectiveCacheKey = cacheKey || generateCacheKey(methodName, request);
    const useCache = this.config.enableFallbackCache && !skipCache;
    let lastError: Error | null = null;

    this.metricsTracker.recordCallStart();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.executeCallAttempt<TRequest, TResponse>(
          methodName,
          request,
          options || {},
          effectiveCacheKey,
          useCache
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const shouldRetry = await this.handleRetryAttempt(
          attempt,
          lastError,
          maxAttempts,
          methodName
        );
        if (!shouldRetry) {
          break;
        }
      }
    }

    this.metricsTracker.recordFailure();
    const cached = this.tryFallbackCache<TResponse>(
      methodName,
      effectiveCacheKey,
      useCache,
      lastError
    );
    if (cached !== null) {
      return cached;
    }

    throw lastError ?? new Error('Unknown gRPC error');
  }

  /**
   * Increment circuit breaker trip count (call from subclass)
   */
  protected incrementCircuitBreakerTrips(): void {
    this.metricsTracker.recordCircuitBreakerTrip();
    this.emit('circuitBreakerTrip', this.config.serviceName);
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  private async executeCallAttempt<TRequest, TResponse>(
    methodName: string,
    request: TRequest,
    options: CallOptions,
    effectiveCacheKey: string,
    useCache: boolean
  ): Promise<TResponse> {
    const connected = await this.connectionManager.ensureConnected();
    if (!connected) {
      return this.handleServiceUnavailable<TResponse>(methodName, effectiveCacheKey, useCache);
    }

    const client = this.connectionManager.getClient();
    if (!client) {
      throw new Error(`${this.config.serviceName} client not connected`);
    }

    const startTime = Date.now();
    const response = await executeGrpcCall<TRequest, TResponse>(
      client,
      methodName,
      request,
      { serviceName: this.config.serviceName, timeoutMs: this.config.timeoutMs },
      { timeoutMs: options.timeoutMs, locale: options.locale, clientUrl: options.clientUrl }
    );

    const latency = Date.now() - startTime;
    this.metricsTracker.recordSuccess(latency);

    if (useCache) {
      this.fallbackCache.set(effectiveCacheKey, response);
    }
    return response;
  }

  private async handleRetryAttempt(
    attempt: number,
    lastError: Error,
    maxAttempts: number,
    methodName: string
  ): Promise<boolean> {
    if (attempt > 0) {
      this.metricsTracker.recordRetry();
    }
    if (!isRetryableError(lastError) || attempt >= maxAttempts - 1) {
      return false;
    }

    if (isConnectionError(lastError)) {
      this.connectionManager.handleConnectionLost();
    }

    const delay = this.config.retryDelayMs * Math.pow(2, attempt);
    this.logger.warn(
      {
        service: this.config.serviceName,
        method: methodName,
        attempt: attempt + 1,
        maxAttempts,
        delay,
        error: lastError.message,
      },
      'gRPC call failed, retrying...'
    );
    await sleep(delay);
    return true;
  }

  private tryFallbackCache<TResponse>(
    methodName: string,
    cacheKey: string,
    useCache: boolean,
    lastError: Error | null
  ): TResponse | null {
    if (!useCache) {
      return null;
    }
    const cached = this.fallbackCache.get<TResponse>(cacheKey);
    if (cached !== null) {
      this.metricsTracker.recordCacheHit();
      this.logger.warn(
        { service: this.config.serviceName, method: methodName, error: lastError?.message },
        'Call failed, returning stale cached response'
      );
      return cached;
    }
    this.metricsTracker.recordCacheMiss();
    return null;
  }

  private handleServiceUnavailable<TResponse>(
    methodName: string,
    cacheKey: string,
    useCache: boolean
  ): TResponse {
    if (useCache) {
      const cached = this.fallbackCache.get<TResponse>(cacheKey);
      if (cached !== null) {
        this.metricsTracker.recordCacheHit();
        this.logger.info(
          { service: this.config.serviceName, method: methodName },
          'Service unavailable, returning cached response'
        );
        return cached;
      }
      this.metricsTracker.recordCacheMiss();
    }
    throw new Error(`${this.config.serviceName} is not available`);
  }
}

export default ResilientGrpcClient;
