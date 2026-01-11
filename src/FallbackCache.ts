/**
 * Fallback Cache
 *
 * High-performance LRU cache for graceful degradation when gRPC services are unavailable.
 * Uses lru-cache for O(1) get/set operations with proper LRU eviction.
 *
 * Features:
 * - O(1) get, set, delete operations
 * - Proper LRU eviction (least recently used items removed first)
 * - TTL-based expiration with stale-while-revalidate pattern
 * - Memory-efficient storage
 */
import { LRUCache } from 'lru-cache';
import type { GrpcLogger } from './types.js';

interface CacheValue<T = unknown> {
  data: T;
  timestamp: number;
}

// Validation constants
const MIN_CACHE_SIZE = 1;
const MAX_CACHE_SIZE = 100000;
const MIN_TTL_MS = 10; // Allow short TTLs for testing
const MAX_TTL_MS = 86400000; // 24 hours

export class FallbackCache {
  private readonly cache: LRUCache<string, CacheValue>;
  private readonly defaultTtlMs: number;
  private readonly serviceName: string;
  private readonly logger: GrpcLogger;

  constructor(serviceName: string, logger: GrpcLogger, maxSize = 100, defaultTtlMs = 60000) {
    // Validate serviceName
    if (!serviceName || typeof serviceName !== 'string' || serviceName.trim().length === 0) {
      throw new Error('serviceName must be a non-empty string');
    }

    // Validate logger
    if (!logger || typeof logger.debug !== 'function') {
      throw new Error('logger with debug method is required');
    }

    // Validate maxSize
    if (typeof maxSize !== 'number' || maxSize < MIN_CACHE_SIZE || maxSize > MAX_CACHE_SIZE) {
      throw new Error(`maxSize must be between ${MIN_CACHE_SIZE} and ${MAX_CACHE_SIZE}`);
    }

    // Validate defaultTtlMs
    if (
      typeof defaultTtlMs !== 'number' ||
      defaultTtlMs < MIN_TTL_MS ||
      defaultTtlMs > MAX_TTL_MS
    ) {
      throw new Error(`defaultTtlMs must be between ${MIN_TTL_MS} and ${MAX_TTL_MS}`);
    }

    this.serviceName = serviceName.trim();
    this.logger = logger;
    this.defaultTtlMs = Math.floor(defaultTtlMs);

    this.cache = new LRUCache<string, CacheValue>({
      max: Math.floor(maxSize),
      // Allow stale items to be returned for graceful degradation
      allowStale: true,
      // Update age on get for true LRU behavior
      updateAgeOnGet: true,
      // TTL in milliseconds
      ttl: this.defaultTtlMs,
      // Don't delete on stale get - we want graceful degradation
      noDeleteOnStaleGet: true,
    });
  }

  /**
   * Validate cache key
   */
  private validateKey(key: string): void {
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      throw new Error('Cache key must be a non-empty string');
    }
  }

  /**
   * Get value from cache
   * Returns stale data for graceful degradation (logs warning if expired)
   */
  get<T>(key: string): T | null {
    this.validateKey(key);

    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Check if stale (past TTL)
    const isStale = Date.now() - entry.timestamp > this.defaultTtlMs;
    if (isStale) {
      this.logger.debug(
        { service: this.serviceName, key },
        'Returning stale cache entry (expired but valid for degradation)'
      );
    }

    return entry.data as T;
  }

  /**
   * Set value in cache with optional TTL override
   */
  set<T>(key: string, data: T, ttlMs?: number): void {
    this.validateKey(key);

    // Validate TTL if provided
    if (ttlMs !== undefined) {
      if (typeof ttlMs !== 'number' || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
        throw new Error(`ttlMs must be between ${MIN_TTL_MS} and ${MAX_TTL_MS}`);
      }
    }

    const ttl = ttlMs ?? this.defaultTtlMs;
    this.cache.set(key, { data, timestamp: Date.now() }, { ttl: Math.floor(ttl) });
  }

  /**
   * Check if key exists in cache (regardless of expiry)
   */
  has(key: string): boolean {
    this.validateKey(key);
    return this.cache.has(key);
  }

  /**
   * Delete specific key from cache
   */
  delete(key: string): boolean {
    this.validateKey(key);
    return this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.logger.debug({ service: this.serviceName }, 'Fallback cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; keys: string[] } {
    return {
      size: this.cache.size,
      maxSize: this.cache.max,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * Remove expired entries (purge stale items)
   * Note: LRU cache handles this automatically, but this forces immediate cleanup
   */
  cleanup(): number {
    const sizeBefore = this.cache.size;
    this.cache.purgeStale();
    const removed = sizeBefore - this.cache.size;

    if (removed > 0) {
      this.logger.debug({ service: this.serviceName, removed }, 'Expired cache entries cleaned up');
    }

    return removed;
  }
}

export default FallbackCache;
