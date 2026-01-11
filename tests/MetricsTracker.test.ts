import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsTracker } from '../src/MetricsTracker.js';

describe('MetricsTracker', () => {
  let tracker: MetricsTracker;

  beforeEach(() => {
    tracker = new MetricsTracker();
  });

  describe('recordCallStart', () => {
    it('should increment total calls', () => {
      tracker.recordCallStart();
      tracker.recordCallStart();
      tracker.recordCallStart();

      const metrics = tracker.getMetrics();
      expect(metrics.totalCalls).toBe(3);
    });
  });

  describe('recordSuccess', () => {
    it('should increment successful calls and track latency', () => {
      tracker.recordCallStart();
      tracker.recordSuccess(100);

      const metrics = tracker.getMetrics();
      expect(metrics.successfulCalls).toBe(1);
      expect(metrics.avgLatencyMs).toBe(100);
      expect(metrics.minLatencyMs).toBe(100);
      expect(metrics.maxLatencyMs).toBe(100);
    });

    it('should calculate average latency correctly', () => {
      tracker.recordCallStart();
      tracker.recordSuccess(100);
      tracker.recordCallStart();
      tracker.recordSuccess(200);
      tracker.recordCallStart();
      tracker.recordSuccess(300);

      const metrics = tracker.getMetrics();
      expect(metrics.avgLatencyMs).toBe(200);
      expect(metrics.minLatencyMs).toBe(100);
      expect(metrics.maxLatencyMs).toBe(300);
    });
  });

  describe('recordFailure', () => {
    it('should increment failed calls', () => {
      tracker.recordCallStart();
      tracker.recordFailure();
      tracker.recordCallStart();
      tracker.recordFailure();

      const metrics = tracker.getMetrics();
      expect(metrics.failedCalls).toBe(2);
    });
  });

  describe('recordRetry', () => {
    it('should increment retry count', () => {
      tracker.recordRetry();
      tracker.recordRetry();

      const metrics = tracker.getMetrics();
      expect(metrics.totalRetries).toBe(2);
    });
  });

  describe('recordCircuitBreakerTrip', () => {
    it('should increment circuit breaker trips', () => {
      tracker.recordCircuitBreakerTrip();

      const metrics = tracker.getMetrics();
      expect(metrics.circuitBreakerTrips).toBe(1);
    });
  });

  describe('recordCacheHit and recordCacheMiss', () => {
    it('should track cache hits and misses', () => {
      tracker.recordCacheHit();
      tracker.recordCacheHit();
      tracker.recordCacheMiss();

      const metrics = tracker.getMetrics();
      expect(metrics.cacheHits).toBe(2);
      expect(metrics.cacheMisses).toBe(1);
    });
  });

  describe('getSuccessRate', () => {
    it('should return 100 when no calls made', () => {
      expect(tracker.getSuccessRate()).toBe(100);
    });

    it('should calculate success rate correctly', () => {
      tracker.recordCallStart();
      tracker.recordSuccess(50);
      tracker.recordCallStart();
      tracker.recordSuccess(50);
      tracker.recordCallStart();
      tracker.recordFailure();

      // 2 successful out of 3 total = 67%
      expect(tracker.getSuccessRate()).toBe(67);
    });
  });

  describe('getCacheHitRate', () => {
    it('should return 0 when no cache access', () => {
      expect(tracker.getCacheHitRate()).toBe(0);
    });

    it('should calculate cache hit rate correctly', () => {
      tracker.recordCacheHit();
      tracker.recordCacheHit();
      tracker.recordCacheMiss();
      tracker.recordCacheMiss();

      // 2 hits out of 4 total = 50%
      expect(tracker.getCacheHitRate()).toBe(50);
    });
  });

  describe('reset', () => {
    it('should reset all metrics to defaults', () => {
      tracker.recordCallStart();
      tracker.recordSuccess(100);
      tracker.recordFailure();
      tracker.recordRetry();
      tracker.recordCacheHit();

      tracker.reset();

      const metrics = tracker.getMetrics();
      expect(metrics.totalCalls).toBe(0);
      expect(metrics.successfulCalls).toBe(0);
      expect(metrics.failedCalls).toBe(0);
      expect(metrics.totalRetries).toBe(0);
      expect(metrics.cacheHits).toBe(0);
    });
  });

  describe('getMetrics', () => {
    it('should return cached snapshot when metrics unchanged', () => {
      tracker.recordCallStart();
      tracker.recordSuccess(100);

      const metrics1 = tracker.getMetrics();
      const metrics2 = tracker.getMetrics();

      // Performance optimization: returns same cached object when unchanged
      expect(metrics1).toBe(metrics2);
      expect(metrics1).toEqual(metrics2);
    });

    it('should return new snapshot when metrics changed', () => {
      tracker.recordCallStart();
      tracker.recordSuccess(100);

      const metrics1 = tracker.getMetrics();

      tracker.recordCallStart(); // Change metrics

      const metrics2 = tracker.getMetrics();

      // Different objects after metrics changed
      expect(metrics1).not.toBe(metrics2);
      expect(metrics1.totalCalls).toBe(1);
      expect(metrics2.totalCalls).toBe(2);
    });
  });
});
