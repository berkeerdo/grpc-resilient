/**
 * Utility Functions
 *
 * High-performance utilities for the resilient gRPC client.
 */

/**
 * Fast hash function using djb2 algorithm
 * O(n) where n is the string length, much faster than JSON.stringify for cache keys
 *
 * @param str - String to hash
 * @returns A 32-bit hash as hex string
 */
export function fastHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  // Convert to unsigned 32-bit integer and then to hex
  return (hash >>> 0).toString(16);
}

/**
 * Generate cache key from method name and request object
 * Uses fast hashing instead of full JSON stringification
 *
 * For simple objects: serializes key-value pairs in a predictable order
 * For complex objects: falls back to JSON.stringify with hash
 *
 * @param methodName - gRPC method name
 * @param request - Request object
 * @returns Cache key string
 */
export function generateCacheKey(methodName: string, request: unknown): string {
  if (request === null || request === undefined) {
    return `${methodName}:null`;
  }

  // Handle primitives directly
  if (typeof request === 'string') {
    return `${methodName}:${request}`;
  }
  if (typeof request === 'number' || typeof request === 'boolean') {
    return `${methodName}:${request.toString()}`;
  }
  if (typeof request !== 'object') {
    // For symbols, bigints, functions - use type as identifier
    return `${methodName}:${typeof request}`;
  }

  // For objects, try to create a deterministic string representation
  const obj = request as Record<string, unknown>;
  const keys = Object.keys(obj).sort();

  // For simple flat objects with primitive values, use fast serialization
  if (keys.length <= 10) {
    const isSimple = keys.every((key) => {
      const value = obj[key];
      return (
        value === null ||
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      );
    });

    if (isSimple) {
      const parts = keys.map((key) => `${key}=${String(obj[key])}`);
      return `${methodName}:${parts.join('&')}`;
    }
  }

  // For complex objects, hash the JSON representation
  const json = JSON.stringify(request);
  return `${methodName}:${fastHash(json)}`;
}

export default { fastHash, generateCacheKey };
