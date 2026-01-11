/**
 * Proto Loader
 *
 * Handles loading protobuf definitions and creating gRPC client instances.
 * Separated from main client for better testability and single responsibility.
 */
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';

// Proto loader options
const PROTO_OPTIONS: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

export interface ProtoConfig {
  protosPath: string;
  protoFile: string;
  packageName: string;
  serviceClassName: string;
  grpcUrl: string;
  useTls: boolean;
  keepaliveTimeMs: number;
  keepaliveTimeoutMs: number;
}

/**
 * Type-safe getter for grpc object property
 * Uses Object.entries to avoid object injection warnings
 */
function getGrpcProperty(obj: grpc.GrpcObject, key: string): grpc.GrpcObject | undefined {
  const entry = Object.entries(obj).find(([k]) => k === key);
  return entry ? (entry[1] as grpc.GrpcObject) : undefined;
}

/**
 * Create gRPC client instance from proto definition
 */
export function createGrpcClient<TClient extends grpc.Client>(config: ProtoConfig): TClient {
  const protoPath = join(config.protosPath, config.protoFile);
  const packageDefinition = protoLoader.loadSync(protoPath, PROTO_OPTIONS);
  const proto = grpc.loadPackageDefinition(packageDefinition);

  // Navigate to the package
  let current: grpc.GrpcObject = proto;
  for (const part of config.packageName.split('.')) {
    const next = getGrpcProperty(current, part);
    if (!next) {
      throw new Error(`Package part "${part}" not found in proto definition`);
    }
    current = next;
  }

  // Get service class
  const serviceObj = getGrpcProperty(current, config.serviceClassName);
  if (!serviceObj) {
    throw new Error(`Service "${config.serviceClassName}" not found in proto definition`);
  }

  const ServiceClass = serviceObj as unknown as grpc.ServiceClientConstructor;
  const credentials = config.useTls
    ? grpc.credentials.createSsl()
    : grpc.credentials.createInsecure();

  return new ServiceClass(config.grpcUrl, credentials, {
    'grpc.keepalive_time_ms': config.keepaliveTimeMs,
    'grpc.keepalive_timeout_ms': config.keepaliveTimeoutMs,
    'grpc.keepalive_permit_without_calls': 1,
  }) as unknown as TClient;
}
