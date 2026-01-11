import { describe, it, expect } from 'vitest';
import { fastHash, generateCacheKey } from '../src/utils.js';

describe('Utils', () => {
  describe('fastHash', () => {
    it('should return consistent hash for same input', () => {
      const hash1 = fastHash('test-string');
      const hash2 = fastHash('test-string');

      expect(hash1).toBe(hash2);
    });

    it('should return different hash for different input', () => {
      const hash1 = fastHash('string-a');
      const hash2 = fastHash('string-b');

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = fastHash('');
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should handle long strings', () => {
      const longString = 'x'.repeat(10000);
      const hash = fastHash(longString);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBeLessThan(20); // Hash should be compact
    });

    it('should return hex string', () => {
      const hash = fastHash('test');
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
    });
  });

  describe('generateCacheKey', () => {
    it('should generate key for null request', () => {
      const key = generateCacheKey('GetUser', null);
      expect(key).toBe('GetUser:null');
    });

    it('should generate key for undefined request', () => {
      const key = generateCacheKey('GetUser', undefined);
      expect(key).toBe('GetUser:null');
    });

    it('should generate key for primitive request', () => {
      const key = generateCacheKey('GetUser', 'user-123');
      expect(key).toBe('GetUser:user-123');
    });

    it('should generate key for number request', () => {
      const key = generateCacheKey('GetPage', 42);
      expect(key).toBe('GetPage:42');
    });

    it('should generate key for simple object', () => {
      const key = generateCacheKey('GetUser', { id: '123', name: 'John' });
      expect(key).toBe('GetUser:id=123&name=John');
    });

    it('should sort object keys for consistency', () => {
      const key1 = generateCacheKey('GetUser', { z: 1, a: 2, m: 3 });
      const key2 = generateCacheKey('GetUser', { a: 2, m: 3, z: 1 });

      expect(key1).toBe(key2);
    });

    it('should handle objects with null/undefined values', () => {
      const key = generateCacheKey('GetUser', { id: '123', name: null, age: undefined });
      expect(key).toContain('GetUser:');
      expect(key).toContain('id=123');
      expect(key).toContain('name=null');
      expect(key).toContain('age=undefined');
    });

    it('should use hash for complex nested objects', () => {
      const complexRequest = {
        userId: 'user-123',
        filters: {
          status: ['active', 'pending'],
          dateRange: { start: '2024-01-01', end: '2024-12-31' },
        },
      };

      const key = generateCacheKey('SearchUsers', complexRequest);
      expect(key).toMatch(/^SearchUsers:[0-9a-f]+$/);
    });

    it('should generate consistent keys for same complex object', () => {
      const request = {
        nested: { a: 1, b: 2 },
        array: [1, 2, 3],
      };

      const key1 = generateCacheKey('Method', request);
      const key2 = generateCacheKey('Method', request);

      expect(key1).toBe(key2);
    });

    it('should produce shorter keys than JSON.stringify for complex objects', () => {
      const complexRequest = {
        userId: 'user-12345678901234567890',
        filters: {
          status: ['active', 'pending', 'inactive'],
          dateRange: { start: '2024-01-01', end: '2024-12-31' },
          tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'],
        },
        metadata: {
          requestId: 'req-abc123def456ghi789',
          timestamp: 1704067200000,
        },
      };

      const generatedKey = generateCacheKey('SearchUsers', complexRequest);
      const jsonKey = `SearchUsers:${JSON.stringify(complexRequest)}`;

      // Hash-based key should be much shorter
      expect(generatedKey.length).toBeLessThan(jsonKey.length);
    });
  });
});
