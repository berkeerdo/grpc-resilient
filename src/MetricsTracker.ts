/**
 * Metrics Tracker
 *
 * High-performance metrics tracking for gRPC clients.
 * Optimized for minimal memory allocation and O(1) operations.
 *
 * Features:
 * - Cached snapshot pattern (avoids object allocation on every read)
 * - Direct property access (no object spread overhead)
 * - OpenTelemetry-compatible metrics structure
 */
import type { ClientMetrics } from './types.js';

export class MetricsTracker {
  // Direct properties for O(1) updates (avoid object property access overhead)
  private totalCalls = 0;
  private successfulCalls = 0;
  private failedCalls = 0;
  private totalRetries = 0;
  private circuitBreakerTrips = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private avgLatencyMs = 0;
  private maxLatencyMs = 0;
  private minLatencyMs = Infinity;
  private latencySum = 0;
  private lastResetAt: Date;

  // Cached snapshot to avoid object allocation on every getMetrics() call
  private cachedSnapshot: ClientMetrics | null = null;
  private isDirty = true;

  constructor() {
    this.lastResetAt = new Date();
  }

  /**
   * Record a call start
   */
  recordCallStart(): void {
    this.totalCalls++;
    this.isDirty = true;
  }

  /**
   * Record a successful call with latency
   */
  recordSuccess(latencyMs: number): void {
    this.successfulCalls++;
    this.updateLatency(latencyMs);
    this.isDirty = true;
  }

  /**
   * Record a failed call
   */
  recordFailure(): void {
    this.failedCalls++;
    this.isDirty = true;
  }

  /**
   * Record a retry attempt
   */
  recordRetry(): void {
    this.totalRetries++;
    this.isDirty = true;
  }

  /**
   * Record a circuit breaker trip
   */
  recordCircuitBreakerTrip(): void {
    this.circuitBreakerTrips++;
    this.isDirty = true;
  }

  /**
   * Record a cache hit
   */
  recordCacheHit(): void {
    this.cacheHits++;
    this.isDirty = true;
  }

  /**
   * Record a cache miss
   */
  recordCacheMiss(): void {
    this.cacheMisses++;
    this.isDirty = true;
  }

  /**
   * Update latency metrics
   */
  private updateLatency(latencyMs: number): void {
    this.latencySum += latencyMs;

    if (latencyMs > this.maxLatencyMs) {
      this.maxLatencyMs = latencyMs;
    }
    if (latencyMs < this.minLatencyMs) {
      this.minLatencyMs = latencyMs;
    }

    // Calculate average
    this.avgLatencyMs = Math.round(this.latencySum / this.successfulCalls);
  }

  /**
   * Get current metrics snapshot
   * Uses cached snapshot pattern - only creates new object when metrics changed
   */
  getMetrics(): ClientMetrics {
    if (!this.isDirty && this.cachedSnapshot) {
      return this.cachedSnapshot;
    }

    // Create snapshot only when dirty
    this.cachedSnapshot = {
      totalCalls: this.totalCalls,
      successfulCalls: this.successfulCalls,
      failedCalls: this.failedCalls,
      totalRetries: this.totalRetries,
      circuitBreakerTrips: this.circuitBreakerTrips,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      avgLatencyMs: this.avgLatencyMs,
      maxLatencyMs: this.maxLatencyMs,
      minLatencyMs: this.minLatencyMs === Infinity ? 0 : this.minLatencyMs,
      lastResetAt: this.lastResetAt,
    };
    this.isDirty = false;

    return this.cachedSnapshot;
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.totalCalls = 0;
    this.successfulCalls = 0;
    this.failedCalls = 0;
    this.totalRetries = 0;
    this.circuitBreakerTrips = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.avgLatencyMs = 0;
    this.maxLatencyMs = 0;
    this.minLatencyMs = Infinity;
    this.latencySum = 0;
    this.lastResetAt = new Date();
    this.cachedSnapshot = null;
    this.isDirty = true;
  }

  /**
   * Get success rate (0-100)
   */
  getSuccessRate(): number {
    if (this.totalCalls === 0) {
      return 100;
    }
    return Math.round((this.successfulCalls / this.totalCalls) * 100);
  }

  /**
   * Get cache hit rate (0-100)
   */
  getCacheHitRate(): number {
    const totalCacheAccess = this.cacheHits + this.cacheMisses;
    if (totalCacheAccess === 0) {
      return 0;
    }
    return Math.round((this.cacheHits / totalCacheAccess) * 100);
  }
}

export default MetricsTracker;
