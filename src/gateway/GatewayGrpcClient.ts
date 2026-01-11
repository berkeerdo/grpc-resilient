/**
 * Gateway gRPC Client
 *
 * Abstract base class for API Gateway/Proxy gRPC clients.
 * Designed for services that act as reverse proxies to multiple backend services.
 *
 * Features:
 * - Lazy connection (connects on first call)
 * - Automatic reconnection with exponential backoff
 * - Retry logic with jitter
 * - TLS/SSL support (including mutual TLS)
 * - Connection health monitoring
 * - OpenTelemetry-compatible metrics
 *
 * @example
 * ```typescript
 * import { GatewayGrpcClient, type GatewayLogger, type GatewayClientConfig } from 'grpc-resilient/gateway';
 * import * as grpc from '@grpc/grpc-js';
 *
 * interface AuthServiceClient extends grpc.Client {
 *   ValidateToken: grpc.MethodDefinition<ValidateRequest, ValidateResponse>;
 * }
 *
 * class AuthServiceProxy extends GatewayGrpcClient<AuthServiceClient> {
 *   constructor(config: GatewayClientConfig, logger: GatewayLogger) {
 *     super(config, logger);
 *   }
 *
 *   async validateToken(request: ValidateRequest, options?: GatewayCallOptions) {
 *     return this.callWithRetry<ValidateRequest, ValidateResponse>(
 *       'ValidateToken',
 *       request,
 *       options
 *     );
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';
import { EventEmitter } from 'events';
import {
  GatewayConnectionState,
  GATEWAY_DEFAULT_CONFIG,
  type GatewayClientConfig,
  type GatewayCallOptions,
  type GatewayServiceHealth,
  type GatewayClientMetrics,
  type GatewayLogger,
} from './types.js';
import { GatewayMetricsTracker } from './GatewayMetricsTracker.js';
import { createGatewayCredentials } from './GatewayCredentialsProvider.js';
import {
  isRetryableError,
  isConnectionError,
  calculateBackoffDelay,
  sleep,
} from './GatewayRetryHandler.js';

/**
 * Default proto loader options for gateway clients
 */
const DEFAULT_PROTO_OPTIONS: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

/**
 * Abstract base class for Gateway gRPC clients
 *
 * Extend this class to create service-specific proxy clients.
 * Each client manages its own connection to a backend service.
 *
 * @typeParam TClient - The typed gRPC client interface
 */
export abstract class GatewayGrpcClient<
  TClient extends grpc.Client = grpc.Client,
> extends EventEmitter {
  protected client: TClient | null = null;
  protected config: Required<
    Omit<
      GatewayClientConfig,
      'protoOptions' | 'tlsCaCertPath' | 'tlsClientCertPath' | 'tlsClientKeyPath'
    >
  > &
    Pick<
      GatewayClientConfig,
      'protoOptions' | 'tlsCaCertPath' | 'tlsClientCertPath' | 'tlsClientKeyPath'
    >;
  protected logger: GatewayLogger;
  protected state: GatewayConnectionState = GatewayConnectionState.DISCONNECTED;
  protected reconnectAttempts = 0;
  protected reconnectTimer: NodeJS.Timeout | null = null;
  protected lastConnectedAt: Date | null = null;
  protected lastErrorAt: Date | null = null;
  protected lastError: string | null = null;
  protected lastLatencyMs = 0;
  protected connectPromise: Promise<void> | null = null;
  protected isShuttingDown = false;
  protected readonly metricsTracker: GatewayMetricsTracker;

  constructor(clientConfig: GatewayClientConfig, logger: GatewayLogger) {
    super();
    this.config = {
      ...GATEWAY_DEFAULT_CONFIG,
      ...clientConfig,
    } as typeof this.config;
    this.logger = logger;
    this.metricsTracker = new GatewayMetricsTracker();
  }

  /**
   * Ensure connection is established (lazy connection)
   *
   * This method is called automatically before each gRPC call.
   * It's safe to call multiple times - it will only connect once.
   *
   * @returns true if connected, false otherwise
   */
  async ensureConnected(): Promise<boolean> {
    if (this.state === GatewayConnectionState.CONNECTED && this.client) {
      return true;
    }

    if (this.connectPromise) {
      try {
        await this.connectPromise;
        return this.state === GatewayConnectionState.CONNECTED;
      } catch {
        return false;
      }
    }

    this.connectPromise = this.connect();
    try {
      await this.connectPromise;
      return this.state === GatewayConnectionState.CONNECTED;
    } catch {
      return false;
    } finally {
      this.connectPromise = null;
    }
  }

  /**
   * Execute a gRPC call with automatic retry
   *
   * This is the main method for making gRPC calls through the gateway.
   * Handles connection management, retry logic, and metrics.
   *
   * @param methodName - The gRPC method name to call
   * @param request - The request object
   * @param options - Optional call settings (timeout, locale, etc.)
   * @returns The response from the backend service
   */
  public async callWithRetry<TRequest, TResponse>(
    methodName: string,
    request: TRequest,
    options?: GatewayCallOptions | string
  ): Promise<TResponse> {
    const callOptions: GatewayCallOptions =
      typeof options === 'string' ? { locale: options } : options || {};
    const { timeoutMs, locale, clientUrl, skipRetry, metadata } = callOptions;
    const maxAttempts = skipRetry ? 1 : this.config.retryCount + 1;
    let lastError: Error | null = null;

    this.metricsTracker.recordCallStart();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const connected = await this.ensureConnected();
        if (!connected) {
          throw new Error(`${this.config.serviceName} is not available`);
        }

        const startTime = Date.now();
        const response = await this.executeCall<TRequest, TResponse>(
          methodName,
          request,
          locale,
          timeoutMs,
          clientUrl,
          metadata
        );
        this.lastLatencyMs = Date.now() - startTime;
        this.metricsTracker.recordSuccess(this.lastLatencyMs);
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const shouldRetry = await this.handleRetryError(
          lastError,
          methodName,
          attempt,
          maxAttempts
        );
        if (!shouldRetry) {
          break;
        }
      }
    }

    this.metricsTracker.recordFailure();
    throw lastError ?? new Error('Unknown gRPC error');
  }

  /**
   * Get the current health status with metrics
   *
   * Use this for health checks and monitoring dashboards.
   *
   * @returns Health status including connection state and metrics
   */
  getHealth(): GatewayServiceHealth {
    return {
      state: this.state,
      healthy: this.state === GatewayConnectionState.CONNECTED,
      latencyMs: this.lastLatencyMs,
      lastCheck: new Date(),
      lastConnectedAt: this.lastConnectedAt,
      lastErrorAt: this.lastErrorAt,
      error: this.lastError ?? undefined,
      reconnectAttempts: this.reconnectAttempts,
      metrics: this.metricsTracker.getMetrics(),
    };
  }

  /**
   * Get metrics only (without health status)
   *
   * @returns Current metrics snapshot
   */
  getMetrics(): GatewayClientMetrics {
    return this.metricsTracker.getMetrics();
  }

  /**
   * Reset all metrics to initial values
   */
  resetMetrics(): void {
    this.metricsTracker.reset();
  }

  /**
   * Check if the client is currently connected
   *
   * @returns true if connected, false otherwise
   */
  isConnected(): boolean {
    return this.state === GatewayConnectionState.CONNECTED && this.client !== null;
  }

  /**
   * Close the gRPC client connection
   *
   * Call this during graceful shutdown to clean up resources.
   */
  close(): void {
    this.isShuttingDown = true;
    this.stopReconnectTimer();

    if (this.client) {
      this.client.close();
      this.client = null;
    }

    this.state = GatewayConnectionState.DISCONNECTED;
    this.emit('disconnected');
    this.logger.info({ service: this.config.serviceName }, 'gRPC client closed');
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private async handleRetryError(
    error: Error,
    methodName: string,
    attempt: number,
    maxAttempts: number
  ): Promise<boolean> {
    this.lastErrorAt = new Date();
    this.lastError = error.message;

    if (attempt > 0) {
      this.metricsTracker.recordRetry();
    }
    if (!isRetryableError(error) || attempt >= maxAttempts - 1) {
      return false;
    }
    if (isConnectionError(error)) {
      this.handleConnectionLost();
    }

    const delay = calculateBackoffDelay(this.config.retryDelayMs, attempt);
    this.logger.warn(
      {
        service: this.config.serviceName,
        method: methodName,
        attempt: attempt + 1,
        maxAttempts,
        delay: Math.round(delay),
        error: error.message,
      },
      'gRPC call failed, retrying...'
    );
    await sleep(delay);
    return true;
  }

  private createGrpcClient(): TClient {
    const protoPath = join(this.config.protosPath, this.config.protoFile);
    const options: protoLoader.Options = {
      ...DEFAULT_PROTO_OPTIONS,
      ...this.config.protoOptions,
      includeDirs: [this.config.protosPath],
    };
    const packageDefinition = protoLoader.loadSync(protoPath, options);
    const proto = grpc.loadPackageDefinition(packageDefinition);

    const packageParts = this.config.packageName.split('.');
    let current: grpc.GrpcObject = proto;
    for (const part of packageParts) {
      const next = this.safeGetProperty<grpc.GrpcObject>(current as Record<string, unknown>, part);
      if (!next) {
        throw new Error(`Package part '${part}' not found in proto`);
      }
      current = next;
    }

    const ServiceClass = this.safeGetProperty<grpc.ServiceClientConstructor>(
      current as Record<string, unknown>,
      this.config.serviceClassName
    );
    if (!ServiceClass) {
      const availableInPackage = Object.keys(current);
      throw new Error(
        `Service class '${this.config.serviceClassName}' not found. Available: ${availableInPackage.join(', ')}`
      );
    }

    const credentials = createGatewayCredentials({
      serviceName: this.config.serviceName,
      useTls: this.config.useTls,
      caCertPath: this.config.tlsCaCertPath,
      clientCertPath: this.config.tlsClientCertPath,
      clientKeyPath: this.config.tlsClientKeyPath,
      logger: this.logger,
    });

    return new ServiceClass(
      this.config.grpcUrl,
      credentials,
      this.createChannelOptions()
    ) as unknown as TClient;
  }

  private safeGetProperty<T>(obj: Record<string, unknown>, key: string): T | undefined {
    const entry = Object.entries(obj).find(([k]) => k === key);
    return entry ? (entry[1] as T) : undefined;
  }

  private createChannelOptions(): grpc.ChannelOptions {
    const maxMessageSize = 5 * 1024 * 1024; // 5MB
    return {
      'grpc.max_receive_message_length': maxMessageSize,
      'grpc.max_send_message_length': maxMessageSize,
      'grpc.keepalive_time_ms': this.config.keepaliveTimeMs,
      'grpc.keepalive_timeout_ms': this.config.keepaliveTimeoutMs,
      'grpc.keepalive_permit_without_calls': 1,
      'grpc.max_concurrent_streams': 100,
      'grpc.initial_reconnect_backoff_ms': 1000,
      'grpc.max_reconnect_backoff_ms': 10000,
      'grpc.dns_min_time_between_resolutions_ms': 10000,
      'grpc.http2.min_time_between_pings_ms': 10000,
      'grpc.http2.max_pings_without_data': 0,
    };
  }

  private handleConnectError(error: unknown): never {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.lastErrorAt = new Date();
    this.lastError = errorMessage;
    this.state = GatewayConnectionState.DISCONNECTED;
    this.emit('error', error);
    this.logger.warn(
      {
        service: this.config.serviceName,
        url: this.config.grpcUrl,
        error: errorMessage,
        reconnectAttempts: this.reconnectAttempts,
      },
      'gRPC client connection failed, will retry in background'
    );
    this.scheduleReconnect();
    throw error;
  }

  private async connect(): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Client is shutting down');
    }

    this.state =
      this.reconnectAttempts > 0
        ? GatewayConnectionState.RECONNECTING
        : GatewayConnectionState.CONNECTING;
    this.emit('connecting');

    try {
      this.client = this.createGrpcClient();
      await this.waitForReady();

      this.state = GatewayConnectionState.CONNECTED;
      this.lastConnectedAt = new Date();
      this.reconnectAttempts = 0;
      this.lastError = null;
      this.emit('connected');
      this.logger.info(
        { service: this.config.serviceName, url: this.config.grpcUrl },
        'gRPC client connected'
      );
      this.monitorConnection();
    } catch (error) {
      this.handleConnectError(error);
    }
  }

  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Client not initialized'));
        return;
      }

      const deadline = new Date(Date.now() + this.config.timeoutMs);
      this.client.waitForReady(deadline, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private monitorConnection(): void {
    if (!this.client) {
      return;
    }

    const channel = this.client.getChannel();
    const checkState = (): void => {
      if (this.isShuttingDown || !this.client) {
        return;
      }

      const state = channel.getConnectivityState(false);

      if (
        state === grpc.connectivityState.TRANSIENT_FAILURE ||
        state === grpc.connectivityState.SHUTDOWN
      ) {
        this.handleConnectionLost();
      } else if (state === grpc.connectivityState.READY) {
        setTimeout(checkState, 5000);
      } else {
        setTimeout(checkState, 1000);
      }
    };

    setTimeout(checkState, 5000);
  }

  private handleConnectionLost(): void {
    if (this.state !== GatewayConnectionState.CONNECTED) {
      return;
    }

    this.state = GatewayConnectionState.DISCONNECTED;
    this.emit('disconnected');
    this.logger.warn({ service: this.config.serviceName }, 'gRPC connection lost, reconnecting...');

    if (this.client) {
      try {
        this.client.close();
      } catch {
        // Ignore close errors
      }
      this.client = null;
    }

    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.isShuttingDown || this.reconnectTimer) {
      return;
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.logger.error(
        { service: this.config.serviceName, attempts: this.reconnectAttempts },
        'Max reconnect attempts reached, giving up'
      );
      return;
    }

    const baseDelay = this.config.initialReconnectDelayMs * Math.pow(2, this.reconnectAttempts);
    const jitter = Math.random() * 1000;
    const delay = Math.min(baseDelay + jitter, this.config.maxReconnectDelayMs);

    this.reconnectAttempts++;

    this.logger.debug(
      {
        service: this.config.serviceName,
        attempt: this.reconnectAttempts,
        delayMs: Math.round(delay),
      },
      'Scheduling reconnect'
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // connect() will schedule another reconnect on failure
      });
    }, delay);
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private executeCall<TRequest, TResponse>(
    methodName: string,
    request: TRequest,
    locale?: string,
    timeoutMs?: number,
    clientUrl?: string,
    additionalMetadata?: Record<string, string>
  ): Promise<TResponse> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error(`${this.config.serviceName} client not connected`));
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clientObj = this.client as unknown as Record<string, (...args: any[]) => void>;
      const method = clientObj[methodName];

      if (typeof method !== 'function') {
        reject(new Error(`Method ${methodName} not found on ${this.config.serviceName}`));
        return;
      }

      const metadata = this.createGrpcMetadata(locale, clientUrl, additionalMetadata);
      const deadline = new Date(Date.now() + (timeoutMs ?? this.config.timeoutMs));

      method.call(
        this.client,
        request,
        metadata,
        { deadline },
        (error: grpc.ServiceError | null, response: TResponse) => {
          if (error) {
            reject(this.mapGrpcError(error));
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  private createGrpcMetadata(
    locale?: string,
    clientUrl?: string,
    additionalMetadata?: Record<string, string>
  ): grpc.Metadata {
    const metadata = new grpc.Metadata();
    if (locale) {
      metadata.set('accept-language', locale);
    }
    if (clientUrl) {
      metadata.set('x-client-url', clientUrl);
    }
    if (additionalMetadata) {
      for (const [key, value] of Object.entries(additionalMetadata)) {
        metadata.set(key, value);
      }
    }
    return metadata;
  }

  private mapGrpcError(error: grpc.ServiceError): Error {
    const errorMessage = error.details || error.message || 'Unknown gRPC error';
    const mappedError = new Error(errorMessage);
    (mappedError as Error & { code: number }).code = error.code;
    (mappedError as Error & { grpcCode: number }).grpcCode = error.code;
    return mappedError;
  }
}
