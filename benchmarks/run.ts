/**
 * Performance Benchmarks
 *
 * Run with: npm run bench
 *
 * Measures performance of critical paths:
 * - FallbackCache operations (LRU)
 * - MetricsTracker operations
 * - Cache key generation
 */

import { FallbackCache } from '../src/FallbackCache.js';
import { MetricsTracker } from '../src/MetricsTracker.js';
import { generateCacheKey, fastHash } from '../src/utils.js';
import type { GrpcLogger } from '../src/types.js';

// Mock logger
const mockLogger: GrpcLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

interface BenchmarkResult {
  name: string;
  ops: number;
  opsPerSec: number;
  avgTimeNs: number;
}

/**
 * Run a benchmark function
 */
function bench(name: string, fn: () => void, iterations = 100000): BenchmarkResult {
  // Warmup
  for (let i = 0; i < 1000; i++) {
    fn();
  }

  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = process.hrtime.bigint();

  const totalNs = Number(end - start);
  const avgTimeNs = totalNs / iterations;
  const opsPerSec = Math.round(1_000_000_000 / avgTimeNs);

  return {
    name,
    ops: iterations,
    opsPerSec,
    avgTimeNs: Math.round(avgTimeNs),
  };
}

/**
 * Format benchmark results
 */
function formatResult(result: BenchmarkResult): string {
  const opsFormatted = result.opsPerSec.toLocaleString();
  return `${result.name.padEnd(45)} ${opsFormatted.padStart(12)} ops/sec  (${result.avgTimeNs} ns/op)`;
}

/**
 * Run all benchmarks
 */
async function main() {
  console.log('='.repeat(80));
  console.log('Resilient gRPC Client - Performance Benchmarks');
  console.log('='.repeat(80));
  console.log();

  const results: BenchmarkResult[] = [];

  // ============================================
  // FallbackCache Benchmarks
  // ============================================
  console.log('FallbackCache (LRU)');
  console.log('-'.repeat(80));

  const cache = new FallbackCache('TestService', mockLogger, 1000, 60000);

  // Pre-fill cache
  for (let i = 0; i < 500; i++) {
    cache.set(`key-${i}`, { data: `value-${i}`, nested: { a: i, b: `str-${i}` } });
  }

  let cacheIdx = 0;
  results.push(
    bench('FallbackCache.set() - new entry', () => {
      cache.set(`new-key-${cacheIdx++}`, { data: 'value' });
    })
  );

  results.push(
    bench('FallbackCache.get() - existing entry', () => {
      cache.get(`key-${Math.floor(Math.random() * 500)}`);
    })
  );

  results.push(
    bench('FallbackCache.get() - missing entry', () => {
      cache.get('non-existent-key');
    })
  );

  results.push(
    bench('FallbackCache.has()', () => {
      cache.has(`key-${Math.floor(Math.random() * 500)}`);
    })
  );

  console.log();

  // ============================================
  // MetricsTracker Benchmarks
  // ============================================
  console.log('MetricsTracker (Cached Snapshot)');
  console.log('-'.repeat(80));

  const metrics = new MetricsTracker();

  results.push(
    bench('MetricsTracker.recordCallStart()', () => {
      metrics.recordCallStart();
    })
  );

  results.push(
    bench('MetricsTracker.recordSuccess()', () => {
      metrics.recordSuccess(Math.random() * 100);
    })
  );

  results.push(
    bench('MetricsTracker.recordFailure()', () => {
      metrics.recordFailure();
    })
  );

  results.push(
    bench('MetricsTracker.getMetrics() - first call', () => {
      metrics.recordCallStart(); // Make dirty
      metrics.getMetrics();
    })
  );

  // Pre-call to warm up cache
  metrics.getMetrics();
  results.push(
    bench('MetricsTracker.getMetrics() - cached', () => {
      metrics.getMetrics(); // Should return cached
    })
  );

  results.push(
    bench('MetricsTracker.getSuccessRate()', () => {
      metrics.getSuccessRate();
    })
  );

  console.log();

  // ============================================
  // Cache Key Generation Benchmarks
  // ============================================
  console.log('Cache Key Generation');
  console.log('-'.repeat(80));

  const simpleRequest = { id: '12345', action: 'get' };
  const complexRequest = {
    userId: 'user-12345',
    filters: {
      status: ['active', 'pending'],
      dateRange: { start: '2024-01-01', end: '2024-12-31' },
    },
    pagination: { page: 1, limit: 50 },
    metadata: { requestId: 'req-abc123', timestamp: Date.now() },
  };

  results.push(
    bench('generateCacheKey() - simple object', () => {
      generateCacheKey('GetUser', simpleRequest);
    })
  );

  results.push(
    bench('generateCacheKey() - complex object', () => {
      generateCacheKey('SearchUsers', complexRequest);
    })
  );

  results.push(
    bench('JSON.stringify() - simple object (baseline)', () => {
      void `GetUser:${JSON.stringify(simpleRequest)}`;
    })
  );

  results.push(
    bench('JSON.stringify() - complex object (baseline)', () => {
      void `SearchUsers:${JSON.stringify(complexRequest)}`;
    })
  );

  results.push(
    bench('fastHash() - short string', () => {
      fastHash('short-string');
    })
  );

  results.push(
    bench('fastHash() - long string (1KB)', () => {
      fastHash('x'.repeat(1024));
    })
  );

  console.log();

  // ============================================
  // Summary
  // ============================================
  console.log('Summary');
  console.log('='.repeat(80));
  console.log();

  for (const result of results) {
    console.log(formatResult(result));
  }

  console.log();
  console.log('='.repeat(80));

  // Performance assertions
  const cacheSetResult = results.find((r) => r.name.includes('FallbackCache.set()'));
  const cacheGetResult = results.find((r) => r.name.includes('FallbackCache.get() - existing'));
  const metricsGetResult = results.find((r) => r.name.includes('getMetrics() - cached'));

  console.log('Performance Targets:');

  if (cacheSetResult && cacheSetResult.opsPerSec > 100000) {
    console.log('  ✓ FallbackCache.set() > 100k ops/sec');
  } else {
    console.log('  ✗ FallbackCache.set() < 100k ops/sec (FAILED)');
  }

  if (cacheGetResult && cacheGetResult.opsPerSec > 500000) {
    console.log('  ✓ FallbackCache.get() > 500k ops/sec');
  } else {
    console.log('  ✗ FallbackCache.get() < 500k ops/sec (FAILED)');
  }

  if (metricsGetResult && metricsGetResult.opsPerSec > 1000000) {
    console.log('  ✓ MetricsTracker.getMetrics() (cached) > 1M ops/sec');
  } else {
    console.log('  ✗ MetricsTracker.getMetrics() (cached) < 1M ops/sec (FAILED)');
  }

  console.log();
}

main().catch(console.error);
