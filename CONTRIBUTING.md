# Contributing to NubemSM

First off, thank you for considering contributing to NubemSM! It's people like you that make NubemSM such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

* Use a clear and descriptive title
* Describe the exact steps to reproduce the problem
* Provide specific examples to demonstrate the steps
* Describe the behavior you observed after following the steps
* Explain which behavior you expected to see instead and why
* Include logs and screenshots if possible

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

* Use a clear and descriptive title
* Provide a step-by-step description of the suggested enhancement
* Provide specific examples to demonstrate the steps
* Describe the current behavior and explain which behavior you expected to see instead
* Explain why this enhancement would be useful

### Pull Requests

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes
5. Make sure your code lints
6. Issue that pull request!

## Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/NubemSM.git
   cd NubemSM
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your test database credentials
   ```

4. **Run tests**
   ```bash
   npm test
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

## Styleguides

### Git Commit Messages

* Use the present tense ("Add feature" not "Added feature")
* Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
* Limit the first line to 72 characters or less
* Reference issues and pull requests liberally after the first line

### JavaScript Styleguide

* Use ESLint configuration provided
* Prefer const over let, never use var
* Use meaningful variable names
* Add JSDoc comments for functions
* Keep functions small and focused

### Testing

* Write tests for any new functionality
* Ensure all tests pass before submitting PR
* Aim for >80% code coverage
* Include both positive and negative test cases

## Project Structure

```
NubemSM/
├── src/              # Application source code
├── tests/            # Test files
├── docs/             # Documentation
├── scripts/          # Utility scripts
├── grafana/          # Grafana configurations
├── prometheus/       # Prometheus configurations
└── db/               # Database schemas and migrations
```

## Pull Request Process

1. Update the README.md with details of changes to the interface
2. Update the version numbers in any examples files and the README.md
3. The PR will be merged once you have the sign-off of two other developers

## Recognition

Contributors will be recognized in our README.md file. Thank you for your contributions!