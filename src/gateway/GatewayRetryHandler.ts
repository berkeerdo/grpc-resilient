/**
 * Gateway gRPC Retry Handler
 *
 * Handles retry logic for gRPC calls with:
 * - Exponential backoff
 * - Jitter to prevent thundering herd
 * - Retryable error detection
 * - Connection error detection
 *
 * @example
 * ```typescript
 * import {
 *   isRetryableError,
 *   isConnectionError,
 *   calculateBackoffDelay,
 *   sleep,
 * } from 'grpc-resilient/gateway';
 *
 * if (isRetryableError(error)) {
 *   const delay = calculateBackoffDelay(1000, attempt);
 *   await sleep(delay);
 *   // retry...
 * }
 * ```
 *
 * @packageDocumentation
 */

import * as grpc from '@grpc/grpc-js';

/**
 * gRPC status codes that are considered retryable
 *
 * - UNAVAILABLE: Server is temporarily unavailable
 * - DEADLINE_EXCEEDED: Call timed out
 * - RESOURCE_EXHAUSTED: Rate limiting or resource constraints
 * - ABORTED: Operation was aborted, can be retried
 */
const RETRYABLE_CODES = [
  grpc.status.UNAVAILABLE,
  grpc.status.DEADLINE_EXCEEDED,
  grpc.status.RESOURCE_EXHAUSTED,
  grpc.status.ABORTED,
];

/**
 * Check if the error is retryable based on gRPC status code
 *
 * @param error - The error to check
 * @returns true if the error is retryable
 */
export function isRetryableError(error: Error): boolean {
  const grpcError = error as grpc.ServiceError;
  return RETRYABLE_CODES.includes(grpcError.code);
}

/**
 * Check if the error indicates a connection problem
 *
 * Connection errors trigger reconnection logic in addition to retry.
 *
 * @param error - The error to check
 * @returns true if the error indicates a connection issue
 */
export function isConnectionError(error: Error): boolean {
  const grpcError = error as grpc.ServiceError;
  return grpcError.code === grpc.status.UNAVAILABLE;
}

/**
 * Calculate delay with exponential backoff and jitter
 *
 * Uses the formula: delay = baseDelay * 2^attempt + jitter
 * Where jitter is +/- 25% of the exponential delay.
 *
 * This prevents the "thundering herd" problem where many clients
 * retry at exactly the same time after a failure.
 *
 * @param baseDelayMs - Base delay in milliseconds
 * @param attempt - Current attempt number (0-indexed)
 * @param maxDelayMs - Maximum delay cap (optional, default: 30000ms)
 * @returns Calculated delay in milliseconds
 *
 * @example
 * ```typescript
 * // attempt 0: ~1000ms (base)
 * // attempt 1: ~2000ms
 * // attempt 2: ~4000ms
 * // attempt 3: ~8000ms
 * // etc. (capped at maxDelayMs)
 * const delay = calculateBackoffDelay(1000, attempt, 30000);
 * ```
 */
export function calculateBackoffDelay(
  baseDelayMs: number,
  attempt: number,
  maxDelayMs = 30000
): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  // Add jitter (+/- 25% of the delay) to prevent thundering herd
  const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
  const delay = exponentialDelay + jitter;

  return Math.min(delay, maxDelayMs);
}

/**
 * Sleep for a specified duration
 *
 * Promisified setTimeout for use with async/await.
 *
 * @param ms - Duration to sleep in milliseconds
 * @returns Promise that resolves after the specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get human-readable error description for logging
 *
 * @param error - The gRPC error
 * @returns Human-readable description
 */
export function getErrorDescription(error: Error): string {
  const grpcError = error as grpc.ServiceError;
  const codeDescriptions: Record<number, string> = {
    [grpc.status.OK]: 'OK',
    [grpc.status.CANCELLED]: 'Cancelled',
    [grpc.status.UNKNOWN]: 'Unknown error',
    [grpc.status.INVALID_ARGUMENT]: 'Invalid argument',
    [grpc.status.DEADLINE_EXCEEDED]: 'Deadline exceeded',
    [grpc.status.NOT_FOUND]: 'Not found',
    [grpc.status.ALREADY_EXISTS]: 'Already exists',
    [grpc.status.PERMISSION_DENIED]: 'Permission denied',
    [grpc.status.RESOURCE_EXHAUSTED]: 'Resource exhausted',
    [grpc.status.FAILED_PRECONDITION]: 'Failed precondition',
    [grpc.status.ABORTED]: 'Aborted',
    [grpc.status.OUT_OF_RANGE]: 'Out of range',
    [grpc.status.UNIMPLEMENTED]: 'Unimplemented',
    [grpc.status.INTERNAL]: 'Internal error',
    [grpc.status.UNAVAILABLE]: 'Service unavailable',
    [grpc.status.DATA_LOSS]: 'Data loss',
    [grpc.status.UNAUTHENTICATED]: 'Unauthenticated',
  };

  const description = codeDescriptions[grpcError.code] ?? 'Unknown';
  return `${description} (code: ${grpcError.code})`;
}
