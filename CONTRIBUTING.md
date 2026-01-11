# Contributing to grpc-resilient

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/berkeerdo/grpc-resilient/issues)
2. If not, create a new issue with:
   - Clear, descriptive title
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (Node.js version, OS, etc.)
   - Code samples if applicable

### Suggesting Features

1. Check existing issues for similar suggestions
2. Create a new issue with:
   - Clear description of the feature
   - Use case / motivation
   - Proposed API (if applicable)

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Write/update tests
5. Ensure all tests pass: `npm test`
6. Ensure linting passes: `npm run lint`
7. Commit using conventional commits
8. Push and create a Pull Request

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/grpc-resilient.git
cd grpc-resilient

# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run linter
npm run lint

# Build
npm run build
```

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting (no code change)
- `refactor`: Code refactoring
- `perf`: Performance improvement
- `test`: Adding/updating tests
- `build`: Build system changes
- `ci`: CI configuration
- `chore`: Other changes

### Examples

```
feat(client): add connection pooling support
fix(retry): handle deadline exceeded errors correctly
docs(readme): add fallback cache example
test(metrics): add coverage for edge cases
```

## Code Style

- Use TypeScript
- Follow ESLint rules
- Use Prettier for formatting
- Write descriptive variable/function names
- Add JSDoc comments for public APIs
- Keep functions small and focused

## Testing

- Write unit tests for new features
- Write integration tests for complex scenarios
- Maintain >80% code coverage
- Test edge cases and error scenarios

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- tests/FallbackCache.test.ts

# Watch mode
npm run test:watch
```

## Documentation

- Update README.md for user-facing changes
- Update CHANGELOG.md following [Keep a Changelog](https://keepachangelog.com/)
- Add JSDoc comments for new public APIs
- Include code examples where helpful

## Release Process

Releases are automated via GitHub Actions when changes are merged to `main`:

1. Commits are analyzed for version bump
2. CHANGELOG is updated automatically
3. Package is published to npm
4. GitHub release is created

## Questions?

Feel free to open an issue for any questions or concerns.

Thank you for contributing! 🎉
