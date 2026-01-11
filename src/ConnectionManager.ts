/**
 * Connection Manager
 *
 * Handles gRPC connection lifecycle including:
 * - Connection establishment
 * - Reconnection with exponential backoff
 * - Connection monitoring
 * - State management
 */
import * as grpc from '@grpc/grpc-js';
import { EventEmitter } from 'events';
import { ConnectionState, type GrpcLogger } from './types.js';

export interface ConnectionConfig {
  serviceName: string;
  grpcUrl: string;
  timeoutMs: number;
  maxReconnectAttempts: number;
  initialReconnectDelayMs: number;
  maxReconnectDelayMs: number;
}

export interface ConnectionEvents {
  connected: () => void;
  connecting: () => void;
  disconnected: () => void;
  error: (error: unknown) => void;
}

/**
 * Manages gRPC client connection lifecycle
 */
export class ConnectionManager<TClient extends grpc.Client> extends EventEmitter {
  private client: TClient | null = null;
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private monitorTimer: NodeJS.Timeout | null = null;
  private connectPromise: Promise<void> | null = null;
  private isShuttingDown = false;
  private lastConnectedAt: Date | null = null;
  private lastErrorAt: Date | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly config: ConnectionConfig,
    private readonly logger: GrpcLogger,
    private readonly createClient: () => TClient
  ) {
    super();
  }

  // ============================================
  // PUBLIC API
  // ============================================

  getClient(): TClient | null {
    return this.client;
  }

  getState(): ConnectionState {
    return this.state;
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  getLastConnectedAt(): Date | null {
    return this.lastConnectedAt;
  }

  getLastErrorAt(): Date | null {
    return this.lastErrorAt;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  isConnected(): boolean {
    return this.state === ConnectionState.CONNECTED && this.client !== null;
  }

  /**
   * Ensure connection is established (lazy connection)
   * Safe to call multiple times - will only connect once
   */
  async ensureConnected(): Promise<boolean> {
    if (this.state === ConnectionState.CONNECTED && this.client) {
      return true;
    }

    if (this.connectPromise) {
      try {
        await this.connectPromise;
        return this.state === ConnectionState.CONNECTED;
      } catch {
        return false;
      }
    }

    this.connectPromise = this.connect();
    try {
      await this.connectPromise;
      return this.state === ConnectionState.CONNECTED;
    } catch {
      return false;
    } finally {
      this.connectPromise = null;
    }
  }

  /**
   * Close connection and stop reconnection attempts
   */
  close(): void {
    this.isShuttingDown = true;
    this.stopReconnectTimer();
    this.stopMonitorTimer();

    if (this.client) {
      this.client.close();
      this.client = null;
    }

    this.state = ConnectionState.DISCONNECTED;
    this.emit('disconnected');
    this.removeAllListeners();

    this.logger.info({ service: this.config.serviceName }, 'gRPC connection manager closed');
  }

  /**
   * Handle connection lost (called externally when call fails)
   */
  handleConnectionLost(): void {
    if (this.state !== ConnectionState.CONNECTED) {
      return;
    }

    this.state = ConnectionState.DISCONNECTED;
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

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private async connect(): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Client is shutting down');
    }

    this.state =
      this.reconnectAttempts > 0 ? ConnectionState.RECONNECTING : ConnectionState.CONNECTING;
    this.emit('connecting');

    try {
      this.client = this.createClient();
      await this.waitForReady();
      this.handleConnectionSuccess();
    } catch (error) {
      this.handleConnectionFailure(error);
      throw error;
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

  private handleConnectionSuccess(): void {
    this.state = ConnectionState.CONNECTED;
    this.lastConnectedAt = new Date();
    this.reconnectAttempts = 0;
    this.lastError = null;
    this.emit('connected');
    this.logger.info(
      { service: this.config.serviceName, url: this.config.grpcUrl },
      'gRPC client connected'
    );
    this.monitorConnection();
  }

  private handleConnectionFailure(error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.lastErrorAt = new Date();
    this.lastError = errorMessage;
    this.state = ConnectionState.DISCONNECTED;
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
  }

  private monitorConnection(): void {
    if (!this.client) {
      return;
    }

    const channel = this.client.getChannel();
    const checkState = (): void => {
      if (this.isShuttingDown || !this.client) {
        this.monitorTimer = null;
        return;
      }

      const state = channel.getConnectivityState(false);

      if (
        state === grpc.connectivityState.TRANSIENT_FAILURE ||
        state === grpc.connectivityState.SHUTDOWN
      ) {
        this.monitorTimer = null;
        this.handleConnectionLost();
      } else if (state === grpc.connectivityState.READY) {
        this.monitorTimer = setTimeout(checkState, 5000);
      } else {
        this.monitorTimer = setTimeout(checkState, 1000);
      }
    };

    this.monitorTimer = setTimeout(checkState, 5000);
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

  private stopMonitorTimer(): void {
    if (this.monitorTimer) {
      clearTimeout(this.monitorTimer);
      this.monitorTimer = null;
    }
  }
}
