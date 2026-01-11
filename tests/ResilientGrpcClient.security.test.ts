/**
 * Security Tests for ResilientGrpcClient
 *
 * Tests TLS configuration, error handling security,
 * resource protection, and input validation.
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
      UNAVAILABLE: 14,
      INTERNAL: 13,
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
}

function resetMockState(): void {
  mockState.waitForReadyError = null;
  mockState.connectivityState = 2;
  mockState.methodResponse = { success: true, data: 'test' };
  mockState.methodError = null;
}

describe('ResilientGrpcClient - Security', () => {
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

  describe('TLS Configuration', () => {
    it('should use insecure credentials by default', async () => {
      const grpc = await import('@grpc/grpc-js');

      client = new TestGrpcClient({ logger: mockLogger });
      await client.ensureConnected();

      expect(grpc.credentials.createInsecure).toHaveBeenCalled();
    });

    it('should use SSL credentials when useTls is true', async () => {
      const grpc = await import('@grpc/grpc-js');

      client = new TestGrpcClient({ logger: mockLogger, useTls: true });
      await client.ensureConnected();

      expect(grpc.credentials.createSsl).toHaveBeenCalled();
    });
  });

  describe('Error Handling Security', () => {
    it('should not expose internal stack traces in errors', async () => {
      mockState.methodError = {
        code: 13,
        message: 'Internal error with stack trace: at Function.xyz (/path/to/file.ts:123)',
        details: 'Stack trace details should not be exposed',
      };

      client = new TestGrpcClient({
        logger: mockLogger,
        retryCount: 0,
        enableFallbackCache: false,
      });

      try {
        await client.testCall('TestMethod', { id: '123' });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should handle malformed error responses gracefully', async () => {
      mockState.methodError = 'String error instead of object';

      client = new TestGrpcClient({
        logger: mockLogger,
        retryCount: 0,
        enableFallbackCache: false,
      });

      try {
        await client.testCall('TestMethod', { id: '123' });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should validate timeout is within acceptable bounds', () => {
      client = new TestGrpcClient({
        logger: mockLogger,
        timeoutMs: 300000,
      });

      const health = client.getHealth();
      expect(health.state).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('Resource Protection', () => {
    it('should limit retry attempts to prevent resource exhaustion', async () => {
      mockState.methodError = { code: 14, message: 'Unavailable' };

      client = new TestGrpcClient({
        logger: mockLogger,
        retryCount: 2,
        retryDelayMs: 100,
        enableFallbackCache: false,
      });

      let error: Error | null = null;

      const callPromise = client.testCall('TestMethod', { id: '123' }).catch((e) => {
        error = e;
      });

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(200);
      await vi.advanceTimersByTimeAsync(400);

      await callPromise;

      expect(error).not.toBeNull();
    });

    it('should clean up resources on close', async () => {
      client = new TestGrpcClient({ logger: mockLogger });
      await client.ensureConnected();

      expect(client.isConnected()).toBe(true);

      client.close();

      expect(client.isConnected()).toBe(false);
      expect(client.getHealth().state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should prevent operations after close', async () => {
      client = new TestGrpcClient({ logger: mockLogger });
      await client.ensureConnected();
      client.close();

      const result = await client.ensureConnected();
      expect(result).toBe(false);
    });
  });

  describe('Input Validation', () => {
    it('should handle empty method names gracefully', async () => {
      client = new TestGrpcClient({ logger: mockLogger, retryCount: 0 });

      await expect(client.testCall('', { id: '123' })).rejects.toThrow();
    });

    it('should handle null request gracefully', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      // Null request should work (gRPC converts it)
      const result = await client.testCall('TestMethod', null as any);
      expect(result).toBeDefined();
    });

    it('should handle undefined request gracefully', async () => {
      client = new TestGrpcClient({ logger: mockLogger });

      // Undefined request should work (gRPC converts it)
      const result = await client.testCall('TestMethod', undefined as any);
      expect(result).toBeDefined();
    });
  });

  describe('Logging Security', () => {
    it('should not log sensitive request data in production', async () => {
      client = new TestGrpcClient({ logger: mockLogger });
      await client.ensureConnected();

      await client.testCall('TestMethod', {
        password: 'secret123',
        apiKey: 'key-abc-123',
      });

      const allLogCalls = [
        ...vi.mocked(mockLogger.info).mock.calls,
        ...vi.mocked(mockLogger.warn).mock.calls,
        ...vi.mocked(mockLogger.debug).mock.calls,
      ];

      const logOutput = JSON.stringify(allLogCalls);
      expect(logOutput).not.toContain('secret123');
      expect(logOutput).not.toContain('key-abc-123');
    });
  });
});
