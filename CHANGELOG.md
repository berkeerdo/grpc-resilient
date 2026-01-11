## [1.1.0](https://github.com/berkeerdo/grpc-resilient/compare/v1.0.1...v1.1.0) (2026-01-11)

### Features

* **gateway:** add robust grpc client for api gateways ([46cf425](https://github.com/berkeerdo/grpc-resilient/commit/46cf42542e030fe9d1e0b445668c0143bad57dd9))

## [1.0.1](https://github.com/berkeerdo/grpc-resilient/compare/v1.0.0...v1.0.1) (2026-01-11)

### Bug Fixes

* update peer dependencies to support newer versions ([898aabd](https://github.com/berkeerdo/grpc-resilient/commit/898aabd94328c900021da88b7ddbc941d9049e17))

## 1.0.0 (2026-01-11)

### Features

* initial release ([e044636](https://github.com/berkeerdo/grpc-resilient/commit/e044636fbbc66e1ea351e78219eda7fbed5dcb3a))

## 1.0.0 (2026-01-11)

### Features

* resilient grpc client with retry, reconnection and fallback cache ([00c0ee1](https://github.com/berkeerdo/grpc-resilient/commit/00c0ee1015905c35656429f4a6a40147ebc3a000))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-11

### Added

- Initial release
- `ResilientGrpcClient` - Base class for resilient gRPC clients
  - Lazy connection (connect on first use)
  - Auto-reconnect with exponential backoff
  - Configurable retry with exponential backoff
  - Connection state management (CONNECTED, CONNECTING, DISCONNECTED, RECONNECTING)
  - Graceful degradation with fallback cache
  - OpenTelemetry-compatible metrics
  - Event emitter for connection state changes
- `FallbackCache` - In-memory cache for graceful degradation
- `MetricsTracker` - Metrics collection for monitoring
- Full TypeScript support with type definitions
- ESM module support
