/**
 * Call Execution Tests for ResilientGrpcClient
 *
 * Tests gRPC call execution, retry logic, fallback cache,
 * error handling, circuit breaker, and service unavailable scenarios.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ResilientGrpcClient, type GrpcLogger, type ResilientClientConfig } from '../src/index.js';

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

  triggerCircuitBreaker() {
    this.incrementCircuitBreakerTrips();
  }
}

function resetMockState(): void {
  mockState.waitForReadyError = null;
  mockState.connectivityState = 2;
  mockState.methodResponse = { success: true, data: 'test' };
  mockState.methodError = null;
}

describe('ResilientGrpcClient - Call Execution', () => {
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

  describe('successful calls', () => {
    it('should execute call and return response', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      const response = await client.testCall<{ id: string }, { success: boolean }>('TestMethod', {
        id: '123',
      });

      expect(response).toEqual({ success: true, data: 'test' });
    });

    it('should track metrics on successful call', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      await client.testCall('TestMethod', { id: '123' });

      const metrics = client.getMetrics();
      expect(metrics.totalCalls).toBe(1);
      expect(metrics.successfulCalls).toBe(1);
      expect(metrics.failedCalls).toBe(0);
    });
  });

  describe('retry logic', () => {
    it('should not retry on non-retryable errors', async () => {
      mockState.methodError = { code: 3, message: 'Invalid argument' };

      client = new TestGrpcClient({
        logger: mockLogger,
        retryCount: 3,
      });

      await expect(client.testCall('TestMethod', { id: '123' })).rejects.toThrow();

      const metrics = client.getMetrics();
      expect(metrics.totalRetries).toBe(0);
    });

    it('should skip retry when skipRetry option is set', async () => {
      mockState.methodError = { code: 14, message: 'Unavailable' };

      client = new TestGrpcClient({
        logger: mockLogger,
        retryCount: 3,
      });

      await expect(
        client.testCall('TestMethod', { id: '123' }, { skipRetry: true })
      ).rejects.toThrow();

      const metrics = client.getMetrics();
      expect(metrics.totalRetries).toBe(0);
    });
  });

  describe('fallback cache', () => {
    it('should throw if no cached response available', async () => {
      mockState.methodError = { code: 14, message: 'Unavailable' };

      client = new TestGrpcClient({
        logger: mockLogger,
        enableFallbackCache: true,
        retryCount: 0,
      });

      await expect(client.testCall('TestMethod', { id: 'new' })).rejects.toThrow();

      const metrics = client.getMetrics();
      expect(metrics.cacheMisses).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should map gRPC errors correctly', async () => {
      mockState.methodError = {
        code: 3,
        message: 'Invalid argument',
        details: 'Field X is required',
      };

      client = new TestGrpcClient({ logger: mockLogger, retryCount: 0 });

      try {
        await client.testCall('TestMethod', { id: '123' });
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBe('Field X is required');
        expect(error.code).toBe(3);
        expect(error.grpcCode).toBe(3);
      }
    });

    it('should track failed calls in metrics', async () => {
      mockState.methodError = { code: 13, message: 'Internal error' };

      client = new TestGrpcClient({ logger: mockLogger, retryCount: 0 });

      await expect(client.testCall('TestMethod', { id: '123' })).rejects.toThrow();

      const metrics = client.getMetrics();
      expect(metrics.failedCalls).toBe(1);
    });
  });

  describe('call options', () => {
    it('should pass timeout option to call', async () => {
      client = new TestGrpcClient({ logger: mockLogger, timeoutMs: 5000 });

      await client.testCall('TestMethod', { id: '123' }, { timeoutMs: 10000 });

      const metrics = client.getMetrics();
      expect(metrics.successfulCalls).toBe(1);
    });

    it('should pass locale metadata', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      await client.testCall('TestMethod', { id: '123' }, { locale: 'tr-TR' });

      const metrics = client.getMetrics();
      expect(metrics.successfulCalls).toBe(1);
    });

    it('should pass clientUrl metadata', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      await client.testCall('TestMethod', { id: '123' }, { clientUrl: 'https://app.example.com' });

      const metrics = client.getMetrics();
      expect(metrics.successfulCalls).toBe(1);
    });
  });
});

describe('ResilientGrpcClient - Circuit Breaker', () => {
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

  it('should track circuit breaker trips', () => {
    client = new TestGrpcClient({ logger: mockLogger });

    client.triggerCircuitBreaker();
    client.triggerCircuitBreaker();

    const metrics = client.getMetrics();
    expect(metrics.circuitBreakerTrips).toBe(2);
  });

  it('should emit circuit breaker event', () => {
    client = new TestGrpcClient({ logger: mockLogger });

    const handler = vi.fn();
    client.on('circuitBreakerTrip', handler);

    client.triggerCircuitBreaker();

    expect(handler).toHaveBeenCalledWith('TestService');
  });

  it('should include circuit breaker trips in health', () => {
    client = new TestGrpcClient({ logger: mockLogger });

    client.triggerCircuitBreaker();

    const health = client.getHealth();
    expect(health.metrics.circuitBreakerTrips).toBe(1);
  });
});

describe('ResilientGrpcClient - Service Unavailable', () => {
  let client: TestGrpcClient;
  let mockLogger: GrpcLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetMockState();
    mockState.waitForReadyError = new Error('Connection refused');

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

  it('should throw when service is unavailable and no cache', async () => {
    client = new TestGrpcClient({
      logger: mockLogger,
      enableFallbackCache: false,
      retryCount: 0,
    });

    await expect(client.testCall('TestMethod', { id: '123' })).rejects.toThrow(
      'TestService is not available'
    );
  });
});
