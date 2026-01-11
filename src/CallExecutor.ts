/**
 * Call Executor
 *
 * Handles gRPC method execution with proper error handling.
 * Separated from main client for better testability and single responsibility.
 */
import * as grpc from '@grpc/grpc-js';

export interface CallConfig {
  serviceName: string;
  timeoutMs: number;
}

export interface CallMetadata {
  locale?: string;
  clientUrl?: string;
  timeoutMs?: number;
}

/**
 * Get method from client using type-safe lookup
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
export function getClientMethod(
  client: grpc.Client,
  methodName: string
): ((...args: any[]) => void) | undefined {
  const clientAny = client as any;
  const method = clientAny[methodName];

  if (typeof method === 'function') {
    return method.bind(client);
  }

  return undefined;
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */

/**
 * Execute a gRPC call with timeout and metadata
 */
export function executeGrpcCall<TRequest, TResponse>(
  client: grpc.Client,
  methodName: string,
  request: TRequest,
  config: CallConfig,
  metadata: CallMetadata = {}
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    const method = getClientMethod(client, methodName);

    if (!method) {
      reject(new Error(`Method ${methodName} not found on ${config.serviceName}`));
      return;
    }

    const timeout = metadata.timeoutMs ?? config.timeoutMs;
    const deadline = new Date(Date.now() + timeout);

    const grpcMetadata = new grpc.Metadata();
    if (metadata.locale) {
      grpcMetadata.set('accept-language', metadata.locale);
    }
    if (metadata.clientUrl) {
      grpcMetadata.set('x-client-url', metadata.clientUrl);
    }

    method.call(
      client,
      request,
      grpcMetadata,
      { deadline },
      (error: grpc.ServiceError | null, response: TResponse) => {
        if (error) {
          reject(mapGrpcError(error));
        } else {
          resolve(response);
        }
      }
    );
  });
}

/**
 * Map gRPC error to standard Error with code
 */
export function mapGrpcError(error: grpc.ServiceError): Error {
  const mappedError = new Error(error.details || error.message);
  (mappedError as Error & { code: number }).code = error.code;
  (mappedError as Error & { grpcCode: number }).grpcCode = error.code;
  return mappedError;
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: Error): boolean {
  const grpcError = error as grpc.ServiceError;
  const retryableCodes = [
    grpc.status.UNAVAILABLE,
    grpc.status.DEADLINE_EXCEEDED,
    grpc.status.RESOURCE_EXHAUSTED,
    grpc.status.ABORTED,
  ];
  return retryableCodes.includes(grpcError.code);
}

/**
 * Check if error indicates connection loss
 */
export function isConnectionError(error: Error): boolean {
  const grpcError = error as grpc.ServiceError;
  return grpcError.code === grpc.status.UNAVAILABLE;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
