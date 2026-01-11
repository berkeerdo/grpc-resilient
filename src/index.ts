/**
 * Resilient gRPC Client
 *
 * Production-ready gRPC client with:
 * - Lazy connection
 * - Automatic retry with exponential backoff
 * - Background reconnection
 * - Graceful degradation with fallback cache
 * - OpenTelemetry-compatible metrics
 *
 * @example
 * ```typescript
 * import { ResilientGrpcClient, type GrpcLogger, type ResilientClientConfig } from 'grpc-resilient';
 * import { fileURLToPath } from 'url';
 *
 * class MyServiceClient extends ResilientGrpcClient<MyServiceClient> {
 *   private static instance: MyServiceClient | null = null;
 *
 *   private constructor(grpcUrl: string, logger: GrpcLogger) {
 *     super({
 *       serviceName: 'MyService',
 *       grpcUrl,
 *       protoFile: 'my_service.proto',
 *       packageName: 'myapp.myservice',
 *       serviceClassName: 'MyService',
 *       protosPath: fileURLToPath(new URL('../grpc/protos', import.meta.url)),
 *       logger,
 *     });
 *   }
 *
 *   static getInstance(grpcUrl: string, logger: GrpcLogger): MyServiceClient {
 *     if (!MyServiceClient.instance) {
 *       MyServiceClient.instance = new MyServiceClient(grpcUrl, logger);
 *     }
 *     return MyServiceClient.instance;
 *   }
 *
 *   async getUser(userId: string) {
 *     return this.call('GetUser', { userId });
 *   }
 * }
 * ```
 */

// Main client
export { ResilientGrpcClient } from './ResilientGrpcClient.js';

// Supporting modules
export { FallbackCache } from './FallbackCache.js';
export { MetricsTracker } from './MetricsTracker.js';
export { ConnectionManager, type ConnectionConfig } from './ConnectionManager.js';
export { createGrpcClient, type ProtoConfig } from './ProtoLoader.js';
export {
  executeGrpcCall,
  getClientMethod,
  mapGrpcError,
  isRetryableError,
  isConnectionError,
  sleep,
  type CallConfig,
  type CallMetadata,
} from './CallExecutor.js';

// Utilities
export { fastHash, generateCacheKey } from './utils.js';

// Types
export {
  ConnectionState,
  DEFAULT_CONFIG,
  DEFAULT_METRICS,
  type GrpcLogger,
  type ResilientClientConfig,
  type CallOptions,
  type ClientHealth,
  type ClientMetrics,
  type CacheEntry,
} from './types.js';

// Gateway module (for API Gateways/Proxies)
// Import from 'grpc-resilient/gateway' for better tree-shaking
export * as gateway from './gateway/index.js';
