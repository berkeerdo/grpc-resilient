/**
 * Gateway gRPC Client Module
 *
 * Provides resilient gRPC client infrastructure for API Gateway/Proxy services.
 *
 * Use this module when building:
 * - API Gateways that proxy requests to microservices
 * - BFF (Backend for Frontend) services
 * - Service mesh proxies
 * - Load balancers with gRPC support
 *
 * @example
 * ```typescript
 * import {
 *   GatewayGrpcClient,
 *   type GatewayClientConfig,
 *   type GatewayCallOptions,
 *   type GatewayLogger,
 * } from 'grpc-resilient/gateway';
 *
 * class AuthServiceProxy extends GatewayGrpcClient<AuthClient> {
 *   constructor(config: GatewayClientConfig, logger: GatewayLogger) {
 *     super(config, logger);
 *   }
 *
 *   async validateToken(request: ValidateRequest) {
 *     return this.callWithRetry('ValidateToken', request);
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 * @module gateway
 */

// Main client class
export { GatewayGrpcClient } from './GatewayGrpcClient.js';

// Supporting modules
export { GatewayMetricsTracker } from './GatewayMetricsTracker.js';
export { createGatewayCredentials, validateTlsConfig } from './GatewayCredentialsProvider.js';
export {
  isRetryableError,
  isConnectionError,
  calculateBackoffDelay,
  sleep,
  getErrorDescription,
} from './GatewayRetryHandler.js';

// Types
export {
  GatewayConnectionState,
  GATEWAY_DEFAULT_CONFIG,
  GATEWAY_DEFAULT_METRICS,
  type GatewayClientConfig,
  type GatewayCallOptions,
  type GatewayServiceHealth,
  type GatewayClientMetrics,
  type GatewayLogger,
  type TlsCredentialsOptions,
} from './types.js';
