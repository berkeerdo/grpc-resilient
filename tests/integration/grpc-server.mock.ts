/**
 * Mock gRPC Server for Integration Tests
 *
 * Provides a controllable gRPC server for testing connection,
 * retry, and failover scenarios.
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync } from 'fs';

// Proto content for testing
const TEST_PROTO = `
syntax = "proto3";

package test.service;

service TestService {
  rpc GetData (GetDataRequest) returns (GetDataResponse);
  rpc CreateData (CreateDataRequest) returns (CreateDataResponse);
  rpc SlowMethod (SlowRequest) returns (SlowResponse);
  rpc FailingMethod (FailRequest) returns (FailResponse);
}

message GetDataRequest {
  string id = 1;
}

message GetDataResponse {
  string id = 1;
  string name = 2;
  bool success = 3;
}

message CreateDataRequest {
  string name = 1;
}

message CreateDataResponse {
  string id = 1;
  bool success = 2;
}

message SlowRequest {
  int32 delay_ms = 1;
}

message SlowResponse {
  bool success = 1;
}

message FailRequest {
  int32 fail_count = 1;
}

message FailResponse {
  bool success = 1;
}
`;

export interface MockServerOptions {
  port?: number;
  failureRate?: number; // 0-1, probability of failure
  latencyMs?: number; // Artificial latency
}

export class MockGrpcServer {
  private server: grpc.Server | null = null;
  private protoDir: string;
  private protoPath: string;
  private callCount = 0;
  private failuresRemaining = 0;

  constructor(private options: MockServerOptions = {}) {
    this.protoDir = join('/tmp', 'test-protos-' + Date.now());
    this.protoPath = join(this.protoDir, 'test.proto');
  }

  /**
   * Start the mock server
   */
  async start(): Promise<number> {
    // Create proto file
    mkdirSync(this.protoDir, { recursive: true });
    writeFileSync(this.protoPath, TEST_PROTO);

    // Load proto
    const packageDefinition = protoLoader.loadSync(this.protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(packageDefinition) as any;

    // Create server
    this.server = new grpc.Server();

    // Add service implementation
    this.server.addService(proto.test.service.TestService.service, {
      GetData: this.handleGetData.bind(this),
      CreateData: this.handleCreateData.bind(this),
      SlowMethod: this.handleSlowMethod.bind(this),
      FailingMethod: this.handleFailingMethod.bind(this),
    });

    // Bind to port
    const port = this.options.port || 0; // 0 = random available port
    return new Promise((resolve, reject) => {
      this.server!.bindAsync(
        `127.0.0.1:${port}`,
        grpc.ServerCredentials.createInsecure(),
        (err, boundPort) => {
          if (err) {
            reject(err);
          } else {
            resolve(boundPort);
          }
        }
      );
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.tryShutdown(() => {
          this.server = null;
          // Cleanup proto files
          try {
            rmSync(this.protoDir, { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get the proto directory path
   */
  getProtoDir(): string {
    return this.protoDir;
  }

  /**
   * Set number of failures before success
   */
  setFailuresBeforeSuccess(count: number): void {
    this.failuresRemaining = count;
  }

  /**
   * Get total call count
   */
  getCallCount(): number {
    return this.callCount;
  }

  /**
   * Reset call count
   */
  resetCallCount(): void {
    this.callCount = 0;
  }

  // Handler implementations
  private async handleGetData(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ) {
    this.callCount++;
    await this.applyLatency();

    if (this.shouldFail()) {
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Service temporarily unavailable',
      });
      return;
    }

    callback(null, {
      id: call.request.id,
      name: `Test Data ${call.request.id}`,
      success: true,
    });
  }

  private async handleCreateData(
    _call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ) {
    this.callCount++;
    await this.applyLatency();

    if (this.shouldFail()) {
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Service temporarily unavailable',
      });
      return;
    }

    callback(null, {
      id: `new-${Date.now()}`,
      success: true,
    });
  }

  private async handleSlowMethod(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ) {
    this.callCount++;
    const delay = call.request.delay_ms || 5000;
    await new Promise((resolve) => setTimeout(resolve, delay));

    callback(null, { success: true });
  }

  private async handleFailingMethod(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ) {
    this.callCount++;
    const failCount = call.request.fail_count || 0;

    if (this.callCount <= failCount) {
      callback({
        code: grpc.status.UNAVAILABLE,
        message: `Intentional failure ${this.callCount}/${failCount}`,
      });
      return;
    }

    callback(null, { success: true });
  }

  private shouldFail(): boolean {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      return true;
    }

    if (this.options.failureRate && this.options.failureRate > 0) {
      return Math.random() < this.options.failureRate;
    }

    return false;
  }

  private async applyLatency(): Promise<void> {
    if (this.options.latencyMs && this.options.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.latencyMs));
    }
  }
}
