/**
 * Gateway gRPC Metrics Tracker
 *
 * Tracks gRPC client metrics for monitoring and OpenTelemetry integration.
 * Designed specifically for API Gateway/Proxy scenarios.
 *
 * @example
 * ```typescript
 * const tracker = new GatewayMetricsTracker();
 *
 * tracker.recordCallStart();
 * const startTime = Date.now();
 * // ... make call ...
 * tracker.recordSuccess(Date.now() - startTime);
 *
 * console.log(tracker.getMetrics());
 * console.log(`Success rate: ${tracker.getSuccessRate()}%`);
 * ```
 *
 * @packageDocumentation
 */

import type { GatewayClientMetrics } from './types.js';
import { GATEWAY_DEFAULT_METRICS } from './types.js';

/**
 * Metrics tracker for Gateway gRPC clients
 *
 * Thread-safe metrics collection with:
 * - Call counting (total, success, failure)
 * - Latency tracking (min, max, average)
 * - Retry counting
 * - Success rate calculation
 */
export class GatewayMetricsTracker {
  private metrics: GatewayClientMetrics;
  private latencySum = 0;

  constructor() {
    this.metrics = { ...GATEWAY_DEFAULT_METRICS, lastResetAt: new Date() };
  }

  /**
   * Record a call start
   *
   * Call this at the beginning of each gRPC call attempt.
   */
  recordCallStart(): void {
    this.metrics.totalCalls++;
  }

  /**
   * Record a successful call with latency
   *
   * @param latencyMs - The call latency in milliseconds
   */
  recordSuccess(latencyMs: number): void {
    this.metrics.successfulCalls++;
    this.updateLatency(latencyMs);
  }

  /**
   * Record a failed call
   *
   * Call this when a gRPC call fails after all retry attempts.
   */
  recordFailure(): void {
    this.metrics.failedCalls++;
  }

  /**
   * Record a retry attempt
   *
   * Call this for each retry attempt (not the initial attempt).
   */
  recordRetry(): void {
    this.metrics.totalRetries++;
  }

  /**
   * Update latency metrics
   */
  private updateLatency(latencyMs: number): void {
    this.latencySum += latencyMs;

    if (latencyMs > this.metrics.maxLatencyMs) {
      this.metrics.maxLatencyMs = latencyMs;
    }
    if (latencyMs < this.metrics.minLatencyMs) {
      this.metrics.minLatencyMs = latencyMs;
    }

    this.metrics.avgLatencyMs = Math.round(this.latencySum / this.metrics.successfulCalls);
  }

  /**
   * Get current metrics snapshot
   *
   * Returns a copy of the current metrics state.
   *
   * @returns Current metrics
   */
  getMetrics(): GatewayClientMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset all metrics to initial values
   *
   * Useful for periodic metric collection windows.
   */
  reset(): void {
    this.metrics = { ...GATEWAY_DEFAULT_METRICS, lastResetAt: new Date() };
    this.latencySum = 0;
  }

  /**
   * Get success rate as a percentage (0-100)
   *
   * @returns Success rate percentage
   */
  getSuccessRate(): number {
    if (this.metrics.totalCalls === 0) {
      return 100;
    }
    return Math.round((this.metrics.successfulCalls / this.metrics.totalCalls) * 100);
  }

  /**
   * Get failure rate as a percentage (0-100)
   *
   * @returns Failure rate percentage
   */
  getFailureRate(): number {
    if (this.metrics.totalCalls === 0) {
      return 0;
    }
    return Math.round((this.metrics.failedCalls / this.metrics.totalCalls) * 100);
  }

  /**
   * Check if the client is healthy based on success rate
   *
   * @param threshold - Minimum success rate to be considered healthy (default: 90)
   * @returns true if success rate is above threshold
   */
  isHealthy(threshold = 90): boolean {
    return this.getSuccessRate() >= threshold;
  }
}
