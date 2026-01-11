import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FallbackCache } from '../src/FallbackCache.js';
import type { GrpcLogger } from '../src/types.js';

describe('FallbackCache', () => {
  let cache: FallbackCache;
  let mockLogger: GrpcLogger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    cache = new FallbackCache('TestService', mockLogger, 10, 1000);
  });

  describe('set and get', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', { data: 'test' });
      const result = cache.get<{ data: string }>('key1');
      expect(result).toEqual({ data: 'test' });
    });

    it('should return null for non-existent keys', () => {
      const result = cache.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should return stale data after TTL expires', async () => {
      cache = new FallbackCache('TestService', mockLogger, 10, 50); // 50ms TTL
      cache.set('key1', { data: 'test' });

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = cache.get<{ data: string }>('key1');
      expect(result).toEqual({ data: 'test' }); // Still returns stale data
      expect(mockLogger.debug).toHaveBeenCalled();
    });
  });

  describe('has', () => {
    it('should return true for existing keys', () => {
      cache.set('key1', 'value');
      expect(cache.has('key1')).toBe(true);
    });

    it('should return false for non-existent keys', () => {
      expect(cache.has('nonexistent')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should remove a key from cache', () => {
      cache.set('key1', 'value');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.has('key1')).toBe(false);
    });

    it('should return false when deleting non-existent key', () => {
      expect(cache.delete('nonexistent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();

      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalled();
    });
  });

  describe('max size enforcement', () => {
    it('should evict oldest entry when max size is reached', () => {
      cache = new FallbackCache('TestService', mockLogger, 3, 1000);

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      cache.set('key4', 'value4'); // Should evict key1

      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(true);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(10);
      expect(stats.keys).toContain('key1');
      expect(stats.keys).toContain('key2');
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      cache = new FallbackCache('TestService', mockLogger, 10, 50);
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      await new Promise((resolve) => setTimeout(resolve, 100));

      const removed = cache.cleanup();
      expect(removed).toBe(2);
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
    });
  });

  describe('input validation', () => {
    describe('constructor validation', () => {
      it('should throw when serviceName is empty', () => {
        expect(() => new FallbackCache('', mockLogger)).toThrow(
          'serviceName must be a non-empty string'
        );
      });

      it('should throw when serviceName is whitespace only', () => {
        expect(() => new FallbackCache('   ', mockLogger)).toThrow(
          'serviceName must be a non-empty string'
        );
      });

      it('should throw when logger is missing', () => {
        expect(() => new FallbackCache('Test', null as any)).toThrow(
          'logger with debug method is required'
        );
      });

      it('should throw when logger is missing debug method', () => {
        const badLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
        expect(() => new FallbackCache('Test', badLogger)).toThrow(
          'logger with debug method is required'
        );
      });

      it('should throw when maxSize is zero', () => {
        expect(() => new FallbackCache('Test', mockLogger, 0)).toThrow(
          'maxSize must be between 1 and 100000'
        );
      });

      it('should throw when maxSize is negative', () => {
        expect(() => new FallbackCache('Test', mockLogger, -1)).toThrow(
          'maxSize must be between 1 and 100000'
        );
      });

      it('should throw when maxSize exceeds maximum', () => {
        expect(() => new FallbackCache('Test', mockLogger, 100001)).toThrow(
          'maxSize must be between 1 and 100000'
        );
      });

      it('should throw when defaultTtlMs is too low', () => {
        expect(() => new FallbackCache('Test', mockLogger, 100, 5)).toThrow(
          'defaultTtlMs must be between 10 and 86400000'
        );
      });

      it('should throw when defaultTtlMs exceeds maximum', () => {
        expect(() => new FallbackCache('Test', mockLogger, 100, 86400001)).toThrow(
          'defaultTtlMs must be between 10 and 86400000'
        );
      });

      it('should trim serviceName', () => {
        const cache = new FallbackCache('  TestService  ', mockLogger);
        const stats = cache.getStats();
        expect(stats.maxSize).toBe(100); // Default maxSize
      });

      it('should floor fractional values', () => {
        const cache = new FallbackCache('Test', mockLogger, 10.9, 1000.5);
        const stats = cache.getStats();
        expect(stats.maxSize).toBe(10);
      });
    });

    describe('key validation', () => {
      it('should throw when get key is empty', () => {
        expect(() => cache.get('')).toThrow('Cache key must be a non-empty string');
      });

      it('should throw when get key is whitespace only', () => {
        expect(() => cache.get('   ')).toThrow('Cache key must be a non-empty string');
      });

      it('should throw when set key is empty', () => {
        expect(() => cache.set('', 'value')).toThrow('Cache key must be a non-empty string');
      });

      it('should throw when has key is empty', () => {
        expect(() => cache.has('')).toThrow('Cache key must be a non-empty string');
      });

      it('should throw when delete key is empty', () => {
        expect(() => cache.delete('')).toThrow('Cache key must be a non-empty string');
      });
    });

    describe('TTL validation on set', () => {
      it('should throw when ttlMs is too low', () => {
        expect(() => cache.set('key', 'value', 5)).toThrow('ttlMs must be between 10 and 86400000');
      });

      it('should throw when ttlMs exceeds maximum', () => {
        expect(() => cache.set('key', 'value', 86400001)).toThrow(
          'ttlMs must be between 10 and 86400000'
        );
      });

      it('should accept valid custom ttlMs', () => {
        expect(() => cache.set('key', 'value', 5000)).not.toThrow();
        expect(cache.get('key')).toBe('value');
      });
    });
  });
});
