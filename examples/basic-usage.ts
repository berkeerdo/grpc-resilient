/**
 * Basic Usage Example
 *
 * This example shows how to create a resilient gRPC client
 * for a hypothetical UserService.
 */

import { ResilientGrpcClient, type GrpcLogger } from '../src/index.js';
import { fileURLToPath } from 'url';

// Simple console logger that implements GrpcLogger
const logger: GrpcLogger = {
  info: (obj, msg) => console.log('[INFO]', msg, obj),
  warn: (obj, msg) => console.warn('[WARN]', msg, obj),
  error: (obj, msg) => console.error('[ERROR]', msg, obj),
  debug: (obj, msg) => console.debug('[DEBUG]', msg, obj),
};

// Type definitions for our service
interface User {
  id: string;
  name: string;
  email: string;
}

interface GetUserRequest {
  userId: string;
}

interface CreateUserRequest {
  name: string;
  email: string;
}

/**
 * UserService gRPC Client
 *
 * Demonstrates:
 * - Singleton pattern
 * - Type-safe method calls
 * - Event handling
 * - Health monitoring
 */
class UserServiceClient extends ResilientGrpcClient {
  private static instance: UserServiceClient | null = null;

  private constructor(grpcUrl: string, logger: GrpcLogger) {
    super({
      serviceName: 'UserService',
      grpcUrl,
      protoFile: 'user.proto',
      packageName: 'example.user',
      serviceClassName: 'UserService',
      protosPath: fileURLToPath(new URL('./protos', import.meta.url)),
      logger,
      // Resilience configuration
      timeoutMs: 5000,
      retryCount: 3,
      retryDelayMs: 500,
      maxReconnectAttempts: 10,
      // Enable fallback cache for read operations
      enableFallbackCache: true,
      fallbackCacheTtlMs: 30000,
    });

    // Set up event handlers
    this.on('connected', () => {
      logger.info({}, 'UserService connected');
    });

    this.on('disconnected', () => {
      logger.warn({}, 'UserService disconnected');
    });

    this.on('error', (error) => {
      logger.error({ error }, 'UserService error');
    });
  }

  /**
   * Get singleton instance
   */
  static getInstance(grpcUrl: string, logger: GrpcLogger): UserServiceClient {
    if (!UserServiceClient.instance) {
      UserServiceClient.instance = new UserServiceClient(grpcUrl, logger);
    }
    return UserServiceClient.instance;
  }

  /**
   * Get user by ID
   */
  async getUser(userId: string): Promise<User> {
    return this.call<GetUserRequest, User>('GetUser', { userId }, {
      cacheKey: `user:${userId}`, // Enable caching for this call
    });
  }

  /**
   * Create a new user
   */
  async createUser(name: string, email: string): Promise<User> {
    return this.call<CreateUserRequest, User>('CreateUser', { name, email }, {
      skipCache: true, // Don't cache write operations
    });
  }

  /**
   * List all users
   */
  async listUsers(): Promise<User[]> {
    return this.call<Record<string, never>, User[]>('ListUsers', {});
  }
}

// Example usage
async function main() {
  const client = UserServiceClient.getInstance('localhost:50051', logger);

  try {
    // Get health status
    const health = client.getHealth();
    console.log('Health:', health);

    // Make a call (will connect lazily)
    const user = await client.getUser('user-123');
    console.log('User:', user);

    // Create a user
    const newUser = await client.createUser('John Doe', 'john@example.com');
    console.log('Created:', newUser);

    // Get metrics
    const metrics = client.getMetrics();
    console.log('Metrics:', metrics);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Cleanup
    client.close();
  }
}

// Run if executed directly
main().catch(console.error);
