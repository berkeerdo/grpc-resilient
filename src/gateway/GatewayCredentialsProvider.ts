/**
 * Gateway gRPC Credentials Provider
 *
 * Handles TLS/SSL credentials for gRPC connections in API Gateway scenarios.
 *
 * Features:
 * - One-way TLS (server verification only)
 * - Mutual TLS (mTLS) with client certificates
 * - System CA or custom CA certificates
 * - Secure certificate path validation
 *
 * @example
 * ```typescript
 * // Insecure (development only)
 * const creds = createGatewayCredentials({
 *   serviceName: 'AuthService',
 *   useTls: false,
 *   logger,
 * });
 *
 * // One-way TLS with system CA
 * const creds = createGatewayCredentials({
 *   serviceName: 'AuthService',
 *   useTls: true,
 *   logger,
 * });
 *
 * // Mutual TLS with custom CA
 * const creds = createGatewayCredentials({
 *   serviceName: 'AuthService',
 *   useTls: true,
 *   caCertPath: '/etc/certs/ca.pem',
 *   clientCertPath: '/etc/certs/client.pem',
 *   clientKeyPath: '/etc/certs/client.key',
 *   logger,
 * });
 * ```
 *
 * @packageDocumentation
 */

import * as grpc from '@grpc/grpc-js';
import { readFileSync, existsSync } from 'fs';
import { isAbsolute, normalize } from 'path';
import type { TlsCredentialsOptions } from './types.js';

/**
 * Valid certificate file extensions for security validation
 */
const CERT_EXTENSIONS = ['.pem', '.crt', '.key', '.cert', '.ca'];

/**
 * Validate certificate path for security
 *
 * Prevents path traversal attacks by:
 * - Requiring absolute paths
 * - Checking for null byte injection
 * - Validating file extensions
 *
 * @param filePath - The certificate file path
 * @returns Validated and normalized path
 * @throws Error if path is invalid or insecure
 */
function validateCertPath(filePath: string): string {
  // Normalize path to resolve any . or .. components
  const normalizedPath = normalize(filePath);

  // Validate path is absolute
  if (!isAbsolute(normalizedPath)) {
    throw new Error(`Certificate path must be absolute: ${filePath}`);
  }

  // Check for path traversal attempts (null byte injection)
  if (normalizedPath.includes('\0')) {
    throw new Error(`Invalid certificate path (null byte): ${filePath}`);
  }

  // Validate file extension
  const hasValidExtension = CERT_EXTENSIONS.some((ext) => normalizedPath.endsWith(ext));
  if (!hasValidExtension) {
    throw new Error(
      `Invalid certificate file extension. Expected one of: ${CERT_EXTENSIONS.join(', ')}`
    );
  }

  return normalizedPath;
}

/**
 * Read a certificate file safely after validation
 *
 * @param filePath - The certificate file path
 * @returns Buffer containing the certificate data
 * @throws Error if file doesn't exist or path is invalid
 */
function readCertFile(filePath: string): Buffer {
  const validatedPath = validateCertPath(filePath);

  if (!existsSync(validatedPath)) {
    throw new Error(`Certificate file not found: ${validatedPath}`);
  }

  return readFileSync(validatedPath);
}

/**
 * Create gRPC client credentials for gateway connections
 *
 * Supports:
 * - Insecure connections (development only)
 * - One-way TLS with system CA
 * - One-way TLS with custom CA
 * - Mutual TLS (mTLS)
 *
 * @param options - Credential configuration options
 * @returns gRPC channel credentials
 */
export function createGatewayCredentials(options: TlsCredentialsOptions): grpc.ChannelCredentials {
  const { serviceName, useTls, logger } = options;

  if (!useTls) {
    logger.debug({ service: serviceName }, 'gRPC TLS disabled, using insecure credentials');
    return grpc.credentials.createInsecure();
  }

  return createTlsCredentials(options);
}

/**
 * Create TLS credentials with optional mutual TLS
 *
 * @param options - TLS configuration options
 * @returns gRPC SSL channel credentials
 */
function createTlsCredentials(options: TlsCredentialsOptions): grpc.ChannelCredentials {
  const { serviceName, caCertPath, clientCertPath, clientKeyPath, logger } = options;

  try {
    // Load CA certificate if provided (for custom CA verification)
    const caCert = caCertPath ? readCertFile(caCertPath) : null;

    // Load client certificate and key if provided (for mutual TLS)
    const clientCert = clientCertPath ? readCertFile(clientCertPath) : null;
    const clientKey = clientKeyPath ? readCertFile(clientKeyPath) : null;

    // Validate mutual TLS configuration
    if ((clientCert && !clientKey) || (!clientCert && clientKey)) {
      throw new Error('Both clientCertPath and clientKeyPath must be set for mutual TLS');
    }

    const hasMutualTls = clientCert !== null && clientKey !== null;

    logger.info(
      {
        service: serviceName,
        caPath: caCertPath ?? 'system CA',
        clientCertPath: clientCertPath ?? 'not set',
        mutualTls: hasMutualTls,
      },
      'gRPC TLS enabled'
    );

    return grpc.credentials.createSsl(
      caCert, // Root CA for server verification (null uses system CA)
      clientKey, // Client private key for mutual TLS (null for one-way TLS)
      clientCert // Client certificate for mutual TLS (null for one-way TLS)
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load TLS certificates: ${message}`);
  }
}

/**
 * Check if a TLS configuration is valid
 *
 * Useful for validating configuration before creating clients.
 *
 * @param options - TLS configuration to validate
 * @returns Object with validation result and any error message
 */
export function validateTlsConfig(
  options: Pick<TlsCredentialsOptions, 'useTls' | 'caCertPath' | 'clientCertPath' | 'clientKeyPath'>
): { valid: boolean; error?: string } {
  const { useTls, caCertPath, clientCertPath, clientKeyPath } = options;

  if (!useTls) {
    return { valid: true };
  }

  try {
    // Validate CA path if provided
    if (caCertPath) {
      validateCertPath(caCertPath);
      if (!existsSync(caCertPath)) {
        return { valid: false, error: `CA certificate not found: ${caCertPath}` };
      }
    }

    // Validate client cert path if provided
    if (clientCertPath) {
      validateCertPath(clientCertPath);
      if (!existsSync(clientCertPath)) {
        return { valid: false, error: `Client certificate not found: ${clientCertPath}` };
      }
    }

    // Validate client key path if provided
    if (clientKeyPath) {
      validateCertPath(clientKeyPath);
      if (!existsSync(clientKeyPath)) {
        return { valid: false, error: `Client key not found: ${clientKeyPath}` };
      }
    }

    // Check mutual TLS consistency
    if ((clientCertPath && !clientKeyPath) || (!clientCertPath && clientKeyPath)) {
      return {
        valid: false,
        error: 'Both clientCertPath and clientKeyPath must be set for mutual TLS',
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
