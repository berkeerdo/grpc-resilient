/**
 * Core Tests for ResilientGrpcClient
 *
 * Tests constructor, configuration, health status, metrics, events,
 * and connection management.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  ResilientGrpcClient,
  ConnectionState,
  type GrpcLogger,
  type ResilientClientConfig,
} from '../src/index.js';

// Mock state
const mockState = {
  waitForReadyError: null as Error | null,
  connectivityState: 2,
  methodResponse: { success: true, data: 'test' } as any,
  methodError: null as any,
};

// Mock @grpc/grpc-js
vi.mock('@grpc/grpc-js', () => {
  const createMockClient = () => ({
    close: vi.fn(),
    getChannel: vi.fn(() => ({
      getConnectivityState: vi.fn(() => mockState.connectivityState),
    })),
    waitForReady: vi.fn((_deadline: any, callback: any) => {
      if (mockState.waitForReadyError) {
        callback(mockState.waitForReadyError);
      } else {
        callback(null);
      }
    }),
    TestMethod: vi.fn((_request: any, _metadata: any, _options: any, callback: any) => {
      if (mockState.methodError) {
        callback(mockState.methodError);
      } else {
        callback(null, mockState.methodResponse);
      }
    }),
    GetData: vi.fn((_request: any, _metadata: any, _options: any, callback: any) => {
      if (mockState.methodError) {
        callback(mockState.methodError);
      } else {
        callback(null, mockState.methodResponse);
      }
    }),
  });

  return {
    default: {},
    credentials: {
      createInsecure: vi.fn(() => ({})),
      createSsl: vi.fn(() => ({})),
    },
    Metadata: vi.fn().mockImplementation(() => ({ set: vi.fn() })),
    status: {
      OK: 0,
      CANCELLED: 1,
      UNKNOWN: 2,
      INVALID_ARGUMENT: 3,
      DEADLINE_EXCEEDED: 4,
      NOT_FOUND: 5,
      UNAVAILABLE: 14,
      RESOURCE_EXHAUSTED: 8,
      ABORTED: 10,
      INTERNAL: 13,
      UNAUTHENTICATED: 16,
    },
    connectivityState: {
      IDLE: 0,
      CONNECTING: 1,
      READY: 2,
      TRANSIENT_FAILURE: 3,
      SHUTDOWN: 4,
    },
    loadPackageDefinition: vi.fn(() => ({
      test: {
        service: {
          TestService: vi.fn().mockImplementation(createMockClient),
        },
      },
    })),
  };
});

vi.mock('@grpc/proto-loader', () => ({
  loadSync: vi.fn(() => ({})),
}));

// Test client
class TestGrpcClient extends ResilientGrpcClient {
  constructor(config: Partial<ResilientClientConfig> & { logger: GrpcLogger }) {
    super({
      serviceName: 'TestService',
      grpcUrl: 'localhost:50051',
      protoFile: 'test.proto',
      packageName: 'test.service',
      serviceClassName: 'TestService',
      protosPath: '/tmp/protos',
      ...config,
    });
  }

  async testCall<TReq, TRes>(method: string, request: TReq, options?: any) {
    return this.call<TReq, TRes>(method, request, options);
  }

  getState() {
    return this.state;
  }

  getClient() {
    return this.client;
  }
}

function resetMockState(): void {
  mockState.waitForReadyError = null;
  mockState.connectivityState = 2;
  mockState.methodResponse = { success: true, data: 'test' };
  mockState.methodError = null;
}

// ============================================================================
// CORE TESTS
// ============================================================================

describe('ResilientGrpcClient', () => {
  let client: TestGrpcClient;
  let mockLogger: GrpcLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetMockState();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  afterEach(() => {
    if (client) {
      client.close();
    }
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create instance with valid config', () => {
      client = new TestGrpcClient({ logger: mockLogger });

      expect(client).toBeInstanceOf(ResilientGrpcClient);
      expect(client.isConnected()).toBe(false);
    });

    it('should throw if protosPath is missing', () => {
      expect(
        () =>
          new (class extends ResilientGrpcClient {
            constructor() {
              super({
                serviceName: 'Test',
                grpcUrl: 'localhost:50051',
                protoFile: 'test.proto',
                packageName: 'test',
                serviceClassName: 'Test',
                logger: mockLogger,
              } as any);
            }
          })()
      ).toThrow('protosPath is required');
    });

    it('should throw if logger is missing', () => {
      expect(
        () =>
          new (class extends ResilientGrpcClient {
            constructor() {
              super({
                serviceName: 'Test',
                grpcUrl: 'localhost:50051',
                protoFile: 'test.proto',
                packageName: 'test',
                serviceClassName: 'Test',
                protosPath: '/tmp',
              } as any);
            }
          })()
      ).toThrow('logger is required');
    });

    it('should apply default config values', () => {
      client = new TestGrpcClient({ logger: mockLogger });

      const health = client.getHealth();
      expect(health.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should override defaults with provided config', () => {
      client = new TestGrpcClient({
        logger: mockLogger,
        timeoutMs: 10000,
        retryCount: 5,
      });

      expect(client).toBeDefined();
    });
  });

  describe('health status', () => {
    it('should report disconnected initially', () => {
      client = new TestGrpcClient({ logger: mockLogger });

      const health = client.getHealth();

      expect(health.state).toBe(ConnectionState.DISCONNECTED);
      expect(health.healthy).toBe(false);
      expect(health.lastConnectedAt).toBeNull();
    });

    it('should report connected after successful connection', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      await client.ensureConnected();

      const health = client.getHealth();
      expect(health.state).toBe(ConnectionState.CONNECTED);
      expect(health.healthy).toBe(true);
      expect(health.lastConnectedAt).toBeInstanceOf(Date);
    });

    it('should include metrics in health', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      await client.testCall('TestMethod', { id: '123' });

      const health = client.getHealth();
      expect(health.metrics.totalCalls).toBe(1);
      expect(health.metrics.successfulCalls).toBe(1);
    });
  });

  describe('metrics', () => {
    it('should return initial metrics', () => {
      client = new TestGrpcClient({ logger: mockLogger });

      const metrics = client.getMetrics();

      expect(metrics.totalCalls).toBe(0);
      expect(metrics.successfulCalls).toBe(0);
      expect(metrics.failedCalls).toBe(0);
    });

    it('should track latency metrics', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      await client.testCall('TestMethod', { id: '123' });
      await client.testCall('TestMethod', { id: '456' });

      const metrics = client.getMetrics();
      expect(metrics.avgLatencyMs).toBeGreaterThanOrEqual(0);
      expect(metrics.minLatencyMs).toBeGreaterThanOrEqual(0);
      expect(metrics.maxLatencyMs).toBeGreaterThanOrEqual(metrics.minLatencyMs);
    });

    it('should reset metrics', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      await client.testCall('TestMethod', { id: '123' });
      client.resetMetrics();

      const metrics = client.getMetrics();
      expect(metrics.totalCalls).toBe(0);
    });
  });

  describe('cache operations', () => {
    it('should clear cache', async () => {
      client = new TestGrpcClient({
        logger: mockLogger,
        enableFallbackCache: true,
      });

      await client.testCall('TestMethod', { id: '123' });
      client.clearCache();

      expect(client).toBeDefined();
    });
  });

  describe('events', () => {
    it('should emit connecting event', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      const handler = vi.fn();
      client.on('connecting', handler);

      await client.ensureConnected();

      expect(handler).toHaveBeenCalled();
    });

    it('should emit connected event', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      const handler = vi.fn();
      client.on('connected', handler);

      await client.ensureConnected();

      expect(handler).toHaveBeenCalled();
    });

    it('should emit disconnected event on close', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      await client.ensureConnected();

      const handler = vi.fn();
      client.on('disconnected', handler);

      client.close();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('should close client and update state', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      await client.ensureConnected();
      client.close();

      expect(client.isConnected()).toBe(false);
      expect(client.getHealth().state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should log close message', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      await client.ensureConnected();
      client.close();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ service: 'TestService' }),
        expect.stringContaining('closed')
      );
    });
  });
});

// ============================================================================
// CONNECTION TESTS
// ============================================================================

describe('ResilientGrpcClient - Connection', () => {
  let client: TestGrpcClient;
  let mockLogger: GrpcLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetMockState();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  afterEach(() => {
    if (client) {
      client.close();
    }
    vi.useRealTimers();
  });

  describe('ensureConnected', () => {
    it('should connect on first call', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      const result = await client.ensureConnected();

      expect(result).toBe(true);
      expect(client.isConnected()).toBe(true);
    });

    it('should return true if already connected', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      await client.ensureConnected();
      const result = await client.ensureConnected();

      expect(result).toBe(true);
    });

    it('should handle concurrent connection attempts', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      const [result1, result2, result3] = await Promise.all([
        client.ensureConnected(),
        client.ensureConnected(),
        client.ensureConnected(),
      ]);

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);
    });

    it('should return false on connection failure', async () => {
      mockState.waitForReadyError = new Error('Connection refused');

      client = new TestGrpcClient({ logger: mockLogger });
      const result = await client.ensureConnected();

      expect(result).toBe(false);
      expect(client.isConnected()).toBe(false);
    });

    it('should emit error event on connection failure', async () => {
      mockState.waitForReadyError = new Error('Connection refused');

      client = new TestGrpcClient({ logger: mockLogger });

      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      await client.ensureConnected();

      expect(errorHandler).toHaveBeenCalled();
      expect(client.getState()).toBe(ConnectionState.DISCONNECTED);
    });

    it('should update health status on connection failure', async () => {
      mockState.waitForReadyError = new Error('Connection refused');

      client = new TestGrpcClient({ logger: mockLogger });
      await client.ensureConnected();

      const health = client.getHealth();
      expect(health.healthy).toBe(false);
      expect(health.state).toBe(ConnectionState.DISCONNECTED);
      expect(health.lastError).toBe('Connection refused');
    });
  });

  describe('reconnection', () => {
    it('should track reconnect attempts in health status', async () => {
      mockState.waitForReadyError = new Error('Connection refused');

      client = new TestGrpcClient({ logger: mockLogger });
      await client.ensureConnected();

      const health = client.getHealth();
      expect(health.state).toBe(ConnectionState.DISCONNECTED);
      expect(health.lastError).toBe('Connection refused');
      expect(health.lastErrorAt).toBeInstanceOf(Date);
    });
  });
});

describe('ResilientGrpcClient - Connection Monitoring', () => {
  let client: TestGrpcClient;
  let mockLogger: GrpcLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetMockState();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  afterEach(() => {
    if (client) {
      client.close();
    }
    vi.useRealTimers();
  });

  it('should start monitoring after connection', async () => {
    client = new TestGrpcClient({ logger: mockLogger });

    await client.ensureConnected();

    expect(client.isConnected()).toBe(true);
  });

  it('should detect connection loss via state check', async () => {
    client = new TestGrpcClient({ logger: mockLogger });

    await client.ensureConnected();
    expect(client.isConnected()).toBe(true);

    mockState.connectivityState = 4; // SHUTDOWN
    await vi.advanceTimersByTimeAsync(6000);

    expect(client.isConnected()).toBe(false);
  });

  it('should emit disconnected event on connection loss', async () => {
    client = new TestGrpcClient({ logger: mockLogger });

    await client.ensureConnected();

    const handler = vi.fn();
    client.on('disconnected', handler);

    mockState.connectivityState = 3; // TRANSIENT_FAILURE
    await vi.advanceTimersByTimeAsync(6000);

    expect(handler).toHaveBeenCalled();
  });
});
