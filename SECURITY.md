# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **Do NOT** open a public GitHub issue
2. Email security concerns to: berkeerdo@pm.me
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 1 week
- **Resolution Timeline**: Depends on severity
  - Critical: 24-48 hours
  - High: 1 week
  - Medium: 2 weeks
  - Low: Next release

### Disclosure Policy

- We will work with you to understand and resolve the issue
- We will credit you in the security advisory (unless you prefer anonymity)
- We ask that you give us reasonable time to fix the issue before public disclosure

## Security Best Practices

When using this library:

### Connection Security

```typescript
// Use TLS in production
const client = new MyServiceClient({
  grpcUrl: 'my-service.example.com:443',
  useTls: true, // Enable TLS
  // ...
});
```

### Credential Handling

- Never log sensitive data
- Use environment variables for gRPC URLs
- Rotate credentials regularly

### Network Security

- Use internal networks when possible
- Implement proper firewall rules
- Use mTLS for service-to-service auth

## Known Security Considerations

### Cache Security

The fallback cache stores responses in memory. Consider:

- Cache may contain sensitive data
- Data persists until TTL expires or service restarts
- Clear cache when handling sensitive operations

```typescript
// Clear cache after sensitive operations
client.clearCache();
```

### Logging

The library logs connection and error information. Ensure your logger:

- Does not log sensitive request/response data
- Properly sanitizes output
- Has appropriate access controls

## Dependencies

We regularly update dependencies to address security vulnerabilities. Run:

```bash
npm audit
```

To check for known vulnerabilities in dependencies.
