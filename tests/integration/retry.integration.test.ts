/**
 * Integration Tests - Retry Scenarios
 *
 * Tests retry logic with controlled failures.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { MockGrpcServer } from './grpc-server.mock.js';
import { ResilientGrpcClient, type GrpcLogger } from '../../src/index.js';

// Client with configurable retry
class RetryTestClient extends ResilientGrpcClient {
  constructor(grpcUrl: string, protosPath: string, logger: GrpcLogger, retryCount: number = 3) {
    super({
      serviceName: 'TestService',
      grpcUrl,
      protoFile: 'test.proto',
      packageName: 'test.service',
      serviceClassName: 'TestService',
      protosPath,
      logger,
      timeoutMs: 2000,
      retryCount,
      retryDelayMs: 50,
    });
  }

  async failingMethod(failCount: number) {
    return this.call<{ fail_count: number }, { success: boolean }>('FailingMethod', {
      fail_count: failCount,
    });
  }

  async getData(id: string) {
    return this.call<{ id: string }, { id: string; name: string; success: boolean }>('GetData', {
      id,
    });
  }
}

describe.skip('Integration: Retry', () => {
  let server: MockGrpcServer;
  let serverPort: number;
  let client: RetryTestClient;
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
    server.setFailuresBeforeSuccess(0);
  });

  describe('Retry on Transient Failure', () => {
    it('should retry and succeed after transient failures', async () => {
      server.setFailuresBeforeSuccess(2); // Fail first 2 calls

      client = new RetryTestClient(
        `127.0.0.1:${serverPort}`,
        server.getProtoDir(),
        logger,
        3 // Allow 3 retries
      );

      const result = await client.getData('test-1');

      expect(result.success).toBe(true);
      expect(server.getCallCount()).toBe(3); // 2 failures + 1 success

      const metrics = client.getMetrics();
      expect(metrics.totalRetries).toBeGreaterThan(0);
    });

    it('should fail after exhausting retries', async () => {
      server.setFailuresBeforeSuccess(10); // Always fail

      client = new RetryTestClient(
        `127.0.0.1:${serverPort}`,
        server.getProtoDir(),
        logger,
        2 // Only 2 retries
      );

      await expect(client.getData('test-1')).rejects.toThrow();

      // 1 initial + 2 retries = 3 calls
      expect(server.getCallCount()).toBe(3);

      const metrics = client.getMetrics();
      expect(metrics.failedCalls).toBe(1);
    });
  });

  describe('Retry Metrics', () => {
    it('should track retry count', async () => {
      server.setFailuresBeforeSuccess(1);

      client = new RetryTestClient(`127.0.0.1:${serverPort}`, server.getProtoDir(), logger, 3);

      await client.getData('test-1');

      const metrics = client.getMetrics();
      expect(metrics.totalRetries).toBe(1);
    });

    it('should log retry attempts', async () => {
      server.setFailuresBeforeSuccess(1);

      client = new RetryTestClient(`127.0.0.1:${serverPort}`, server.getProtoDir(), logger, 3);

      await client.getData('test-1');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'TestService',
          method: 'GetData',
        }),
        expect.stringContaining('retrying')
      );
    });
  });
});
