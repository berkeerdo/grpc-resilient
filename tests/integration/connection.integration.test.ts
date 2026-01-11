/**
 * Integration Tests - Connection Scenarios
 *
 * Tests real gRPC connection, disconnection, and reconnection scenarios.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { MockGrpcServer } from './grpc-server.mock.js';
import { ResilientGrpcClient, ConnectionState, type GrpcLogger } from '../../src/index.js';

// Concrete client for testing
class TestClient extends ResilientGrpcClient {
  constructor(grpcUrl: string, protosPath: string, logger: GrpcLogger) {
    super({
      serviceName: 'TestService',
      grpcUrl,
      protoFile: 'test.proto',
      packageName: 'test.service',
      serviceClassName: 'TestService',
      protosPath,
      logger,
      timeoutMs: 5000,
      retryCount: 2,
      retryDelayMs: 100,
    });
  }

  async getData(id: string) {
    return this.call<{ id: string }, { id: string; name: string; success: boolean }>('GetData', {
      id,
    });
  }

  async createData(name: string) {
    return this.call<{ name: string }, { id: string; success: boolean }>('CreateData', { name });
  }
}

describe.skip('Integration: Connection', () => {
  let server: MockGrpcServer;
  let serverPort: number;
  let client: TestClient;
  let logger: GrpcLogger;

  beforeAll(async () => {
    server = new MockGrpcServer();
    serverPort = await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    logger = {
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
    server.resetCallCount();
  });

  describe('Lazy Connection', () => {
    it('should not connect until first call', async () => {
      client = new TestClient(`127.0.0.1:${serverPort}`, server.getProtoDir(), logger);

      // Should be disconnected initially
      expect(client.isConnected()).toBe(false);
      expect(client.getHealth().state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should connect on first call', async () => {
      client = new TestClient(`127.0.0.1:${serverPort}`, server.getProtoDir(), logger);

      // Make a call - should connect
      const result = await client.getData('test-1');

      expect(result.success).toBe(true);
      expect(client.isConnected()).toBe(true);
    });

    it('should emit connected event after connection', async () => {
      client = new TestClient(`127.0.0.1:${serverPort}`, server.getProtoDir(), logger);

      const connectedPromise = new Promise<void>((resolve) => {
        client.on('connected', () => resolve());
      });

      // Trigger connection
      await client.ensureConnected();
      await connectedPromise;

      expect(client.isConnected()).toBe(true);
    });
  });

  describe('Health Status', () => {
    it('should report healthy when connected', async () => {
      client = new TestClient(`127.0.0.1:${serverPort}`, server.getProtoDir(), logger);

      await client.ensureConnected();
      const health = client.getHealth();

      expect(health.healthy).toBe(true);
      expect(health.state).toBe(ConnectionState.CONNECTED);
      expect(health.lastConnectedAt).toBeInstanceOf(Date);
    });

    it('should track latency', async () => {
      client = new TestClient(`127.0.0.1:${serverPort}`, server.getProtoDir(), logger);

      await client.getData('test-1');
      const health = client.getHealth();

      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Metrics', () => {
    it('should track successful calls', async () => {
      client = new TestClient(`127.0.0.1:${serverPort}`, server.getProtoDir(), logger);

      await client.getData('test-1');
      await client.getData('test-2');
      await client.createData('new-item');

      const metrics = client.getMetrics();

      expect(metrics.totalCalls).toBe(3);
      expect(metrics.successfulCalls).toBe(3);
      expect(metrics.failedCalls).toBe(0);
    });

    it('should calculate average latency', async () => {
      client = new TestClient(`127.0.0.1:${serverPort}`, server.getProtoDir(), logger);

      await client.getData('test-1');
      await client.getData('test-2');

      const metrics = client.getMetrics();

      expect(metrics.avgLatencyMs).toBeGreaterThan(0);
      expect(metrics.minLatencyMs).toBeGreaterThan(0);
      expect(metrics.maxLatencyMs).toBeGreaterThanOrEqual(metrics.minLatencyMs);
    });
  });

  describe('Graceful Shutdown', () => {
    it('should close cleanly', async () => {
      client = new TestClient(`127.0.0.1:${serverPort}`, server.getProtoDir(), logger);

      await client.ensureConnected();
      expect(client.isConnected()).toBe(true);

      client.close();

      expect(client.isConnected()).toBe(false);
      expect(client.getHealth().state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should emit disconnected event on close', async () => {
      client = new TestClient(`127.0.0.1:${serverPort}`, server.getProtoDir(), logger);

      await client.ensureConnected();

      const disconnectedPromise = new Promise<void>((resolve) => {
        client.on('disconnected', () => resolve());
      });

      client.close();
      await disconnectedPromise;

      expect(client.isConnected()).toBe(false);
    });
  });
});
