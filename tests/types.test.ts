import { describe, it, expect } from 'vitest';
import { ConnectionState, DEFAULT_CONFIG, DEFAULT_METRICS } from '../src/types.js';

describe('types', () => {
  describe('ConnectionState', () => {
    it('should have correct enum values', () => {
      expect(ConnectionState.DISCONNECTED).toBe('DISCONNECTED');
      expect(ConnectionState.CONNECTING).toBe('CONNECTING');
      expect(ConnectionState.CONNECTED).toBe('CONNECTED');
      expect(ConnectionState.RECONNECTING).toBe('RECONNECTING');
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_CONFIG.timeoutMs).toBe(5000);
      expect(DEFAULT_CONFIG.retryCount).toBe(3);
      expect(DEFAULT_CONFIG.retryDelayMs).toBe(1000);
      expect(DEFAULT_CONFIG.maxReconnectAttempts).toBe(Infinity);
      expect(DEFAULT_CONFIG.maxReconnectDelayMs).toBe(30000);
      expect(DEFAULT_CONFIG.initialReconnectDelayMs).toBe(1000);
      expect(DEFAULT_CONFIG.useTls).toBe(false);
      expect(DEFAULT_CONFIG.keepaliveTimeMs).toBe(30000);
      expect(DEFAULT_CONFIG.keepaliveTimeoutMs).toBe(10000);
      expect(DEFAULT_CONFIG.enableFallbackCache).toBe(false);
      expect(DEFAULT_CONFIG.fallbackCacheTtlMs).toBe(60000);
      expect(DEFAULT_CONFIG.maxCacheSize).toBe(100);
    });
  });

  describe('DEFAULT_METRICS', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_METRICS.totalCalls).toBe(0);
      expect(DEFAULT_METRICS.successfulCalls).toBe(0);
      expect(DEFAULT_METRICS.failedCalls).toBe(0);
      expect(DEFAULT_METRICS.totalRetries).toBe(0);
      expect(DEFAULT_METRICS.circuitBreakerTrips).toBe(0);
      expect(DEFAULT_METRICS.cacheHits).toBe(0);
      expect(DEFAULT_METRICS.cacheMisses).toBe(0);
      expect(DEFAULT_METRICS.avgLatencyMs).toBe(0);
      expect(DEFAULT_METRICS.maxLatencyMs).toBe(0);
      expect(DEFAULT_METRICS.minLatencyMs).toBe(Infinity);
    });
  });
});
