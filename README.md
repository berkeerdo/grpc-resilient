# grpc-resilient

[![npm version](https://img.shields.io/npm/v/grpc-resilient.svg)](https://www.npmjs.com/package/grpc-resilient)
[![npm downloads](https://img.shields.io/npm/dm/grpc-resilient.svg)](https://www.npmjs.com/package/grpc-resilient)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

Production-ready gRPC client for Node.js with built-in resilience patterns.

## Features

- **Lazy Connection** - Connects on first use, not at startup
- **Auto-Reconnect** - Exponential backoff reconnection strategy
- **Retry Logic** - Configurable retry with exponential backoff
- **Fallback Cache** - Graceful degradation when service is unavailable
- **Metrics** - OpenTelemetry-compatible metrics tracking
- **Health Checks** - Built-in health status reporting
- **TLS/mTLS** - Full TLS and mutual TLS support
- **TypeScript** - Full type safety with generics support
- **ESM** - Native ES modules support

## Installation

```bash
npm install grpc-resilient @grpc/grpc-js @grpc/proto-loader
```

## Quick Start

### Microservice Client

```typescript
import { ResilientGrpcClient, type GrpcLogger } from 'grpc-resilient';
import { fileURLToPath } from 'url';

const logger: GrpcLogger = console;

class UserServiceClient extends ResilientGrpcClient {
  private static instance: UserServiceClient | null = null;

  private constructor(grpcUrl: string, logger: GrpcLogger) {
    super({
      serviceName: 'UserService',
      grpcUrl,
      protoFile: 'user.proto',
      packageName: 'myapp.user',
      serviceClassName: 'UserService',
      protosPath: fileURLToPath(new URL('./protos', import.meta.url)),
      logger,
      timeoutMs: 5000,
      retryCount: 3,
      enableFallbackCache: true,
    });
  }

  static getInstance(grpcUrl: string, logger: GrpcLogger): UserServiceClient {
    if (!UserServiceClient.instance) {
      UserServiceClient.instance = new UserServiceClient(grpcUrl, logger);
    }
    return UserServiceClient.instance;
  }

  async getUser(userId: string) {
    return this.call<{ userId: string }, { id: string; name: string }>('GetUser', { userId });
  }
}

const client = UserServiceClient.getInstance('localhost:50051', logger);
const user = await client.getUser('123');
```

### Gateway Client

For API Gateways and BFF services:

```typescript
import { GatewayGrpcClient, type GatewayClientConfig, type GatewayLogger } from 'grpc-resilient/gateway';

class AuthServiceProxy extends GatewayGrpcClient {
  private static instance: AuthServiceProxy | null = null;

  private constructor(config: GatewayClientConfig, logger: GatewayLogger) {
    super(config, logger);
  }

  static getInstance(grpcUrl: string, logger: GatewayLogger): AuthServiceProxy {
    if (!AuthServiceProxy.instance) {
      AuthServiceProxy.instance = new AuthServiceProxy({
        serviceName: 'AuthService',
        grpcUrl,
        protoFile: 'auth.proto',
        packageName: 'auth',
        serviceClassName: 'AuthService',
        protosPath: '/app/protos',
        timeoutMs: 3000,
        retryCount: 2,
        useTls: true,
      }, logger);
    }
    return AuthServiceProxy.instance;
  }

  async validateToken(token: string) {
    return this.callWithRetry('ValidateToken', { token });
  }
}
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serviceName` | string | **required** | Name for logging and metrics |
| `grpcUrl` | string | **required** | gRPC server URL (host:port) |
| `protoFile` | string | **required** | Proto file name |
| `packageName` | string | **required** | Package name in proto file |
| `serviceClassName` | string | **required** | Service class name in proto |
| `protosPath` | string | **required** | Absolute path to protos directory |
| `logger` | GrpcLogger | **required** | Logger instance |
| `timeoutMs` | number | 5000 | Call timeout in milliseconds |
| `retryCount` | number | 3 | Number of retry attempts |
| `retryDelayMs` | number | 1000 | Base delay between retries |
| `maxReconnectAttempts` | number | Infinity | Max reconnection attempts |
| `maxReconnectDelayMs` | number | 30000 | Max reconnection delay |
| `initialReconnectDelayMs` | number | 1000 | Initial reconnection delay |
| `useTls` | boolean | false | Use TLS for connection |
| `enableFallbackCache` | boolean | false | Enable fallback cache |
| `fallbackCacheTtlMs` | number | 60000 | Cache TTL in milliseconds |
| `maxCacheSize` | number | 100 | Maximum cache entries |

### TLS Configuration

```typescript
// One-way TLS
{
  useTls: true,
}

// Mutual TLS (mTLS)
{
  useTls: true,
  tlsCaCertPath: '/etc/ssl/ca.pem',
  tlsClientCertPath: '/etc/ssl/client.pem',
  tlsClientKeyPath: '/etc/ssl/client.key',
}
```

## Health & Metrics

```typescript
// Get health status
const health = client.getHealth();
// {
//   state: 'CONNECTED',
//   healthy: true,
//   lastConnectedAt: Date,
//   lastErrorAt: null,
//   reconnectAttempts: 0,
//   latencyMs: 45,
//   metrics: { ... }
// }

// Get metrics for OpenTelemetry
const metrics = client.getMetrics();
// {
//   totalCalls: 150,
//   successfulCalls: 148,
//   failedCalls: 2,
//   totalRetries: 5,
//   avgLatencyMs: 42,
//   ...
// }

// Reset metrics
client.resetMetrics();
```

## Events

```typescript
client.on('connected', () => {
  console.log('gRPC client connected');
});

client.on('disconnected', () => {
  console.log('gRPC client disconnected');
});

client.on('error', (error) => {
  console.error('Connection error:', error);
});

client.on('connecting', () => {
  console.log('Connecting...');
});
```

## Call Options

```typescript
// Per-call options
const user = await client.call('GetUser', { userId: '123' }, {
  timeoutMs: 10000,        // Override timeout
  locale: 'en-US',         // Send locale in metadata
  skipRetry: true,         // Disable retry for this call
  cacheKey: 'user:123',    // Custom cache key
  skipCache: false,        // Use cache if available
});
```

## Logger Interface

Any logger that implements this interface works:

```typescript
interface GrpcLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

// Examples: pino, winston, bunyan, console
```

## Gateway Client Features

The `grpc-resilient/gateway` module provides additional features for API Gateways:

- **No Fallback Cache** - Gateways should fail fast, not serve stale data
- **TLS/mTLS Built-in** - Secure certificate handling with path validation
- **Metadata Forwarding** - Forward request context (locale, client IP, custom headers)
- **Keepalive Configuration** - Prevent idle connection drops

```typescript
import {
  GatewayGrpcClient,
  validateTlsConfig,
  type GatewayClientConfig,
  type GatewayCallOptions,
} from 'grpc-resilient/gateway';

// Validate TLS config at startup
const validation = validateTlsConfig({
  useTls: true,
  caCertPath: process.env.TLS_CA_PATH,
});

if (!validation.valid) {
  throw new Error(`TLS config error: ${validation.error}`);
}

// Forward request context
const user = await client.callWithRetry('GetUser', { userId }, {
  locale: req.headers['accept-language'],
  metadata: {
    'x-request-id': req.id,
    'x-correlation-id': req.headers['x-correlation-id'],
  },
});
```

## Requirements

- Node.js >= 18.0.0
- @grpc/grpc-js >= 1.9.0
- @grpc/proto-loader >= 0.7.0

## License

MIT © [berkeerdo](https://github.com/berkeerdo)
