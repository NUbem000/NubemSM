# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.0.x   | :white_check_mark: |
| 1.0.x   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please follow these steps:

1. **DO NOT** open a public issue
2. Email security@nubem.dev with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 5 business days
- **Resolution**: Based on severity:
  - Critical: 7 days
  - High: 14 days
  - Medium: 30 days
  - Low: 60 days

## Security Measures

### Container Security

- ✅ Non-root user execution
- ✅ Read-only root filesystem where possible
- ✅ No unnecessary packages
- ✅ Regular base image updates
- ✅ Multi-stage builds to minimize attack surface

### Application Security

- ✅ Input validation and sanitization
- ✅ Parameterized database queries
- ✅ Environment-based configuration
- ✅ No hardcoded secrets
- ✅ Secure communication between services

### Infrastructure Security

- ✅ Network isolation between services
- ✅ Resource limits to prevent DoS
- ✅ Health checks and automatic restarts
- ✅ Encrypted backups
- ✅ Audit logging

### Dependency Management

- ✅ Regular dependency updates
- ✅ Automated vulnerability scanning
- ✅ License compliance checks
- ✅ Lock files for reproducible builds

## Security Checklist

Before each release:

- [ ] Run `npm audit` and fix vulnerabilities
- [ ] Update all dependencies to latest stable versions
- [ ] Scan containers with Trivy
- [ ] Review and update security policies
- [ ] Test backup and recovery procedures
- [ ] Verify no secrets in code or logs

## Best Practices for Users

1. **Secrets Management**
   - Use strong, unique passwords
   - Store secrets in environment files
   - Never commit `.env` files
   - Rotate credentials regularly

2. **Network Security**
   - Don't expose PostgreSQL port publicly
   - Use HTTPS for production deployments
   - Implement firewall rules
   - Monitor for unusual activity

3. **Access Control**
   - Limit Grafana user permissions
   - Use read-only database users where possible
   - Enable 2FA for administrative access
   - Regular access audits

## Compliance

This project follows:
- OWASP Top 10 guidelines
- CIS Docker Benchmark
- PostgreSQL security best practices

## Security Tools

We use the following tools for security:
- **Trivy**: Container vulnerability scanning
- **npm audit**: JavaScript dependency scanning
- **OWASP Dependency Check**: Comprehensive vulnerability detection
- **GitHub Security Advisories**: Automated alerts

## Contact

- Security Email: security@nubem.dev
- PGP Key: [Download](https://nubem.dev/pgp-key.asc)