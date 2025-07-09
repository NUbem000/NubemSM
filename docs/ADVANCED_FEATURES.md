# Advanced Features Documentation

## 🚨 Alerting System

### Grafana Alerts Configuration

The system includes pre-configured alerts for:

1. **Connection Loss Alert**
   - Triggers when no speed tests complete in 15 minutes
   - Severity: Critical
   - Auto-resolves when tests resume

2. **Speed Degradation Alert**
   - Triggers when download speed drops >50% from baseline
   - Severity: Warning
   - Compares last hour vs 7-day average

3. **High Latency Alert**
   - Triggers when ping >100ms for 5+ minutes
   - Severity: Warning
   - Useful for real-time applications

4. **Upload Speed Critical**
   - Triggers when upload <5 Mbps for 10+ minutes
   - Severity: Critical
   - Important for video calls/streaming

### Alert Notifications

Configure in `.env`:
```bash
ALERT_WEBHOOK_URL=https://your-webhook-url
GF_SMTP_HOST=smtp.gmail.com
GF_SMTP_USER=your-email@gmail.com
GF_SMTP_PASSWORD=your-app-password
GF_SMTP_FROM_ADDRESS=alerts@nubem.dev
```

## 🔒 Authentication & Security

### API Authentication

Two methods supported:

1. **JWT Tokens**
   ```bash
   curl -X POST http://localhost:3000/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"your-password"}'
   
   # Use token
   curl http://localhost:3000/api/status \
     -H "Authorization: Bearer YOUR_JWT_TOKEN"
   ```

2. **API Keys**
   ```bash
   # Generate API key (requires admin role)
   curl -X POST http://localhost:3000/api/keys \
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name":"monitoring-tool","permissions":{"read":true}}'
   
   # Use API key
   curl http://localhost:3000/api/status \
     -H "X-API-Key: sm_your_api_key"
   ```

### Default Credentials

Change these immediately in production:
- Username: `admin`
- Password: Set via `ADMIN_PASSWORD` env var
- Email: Set via `ADMIN_EMAIL` env var

### Role-Based Access Control

Three roles available:
- `admin`: Full access
- `user`: Read/write access  
- `viewer`: Read-only access

## 🚦 Rate Limiting

Configured limits per endpoint:

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/health` | 60/min | 1 minute |
| `/metrics` | 30/5min | 5 minutes |
| `/api/*` | 100/15min | 15 minutes |
| `/auth/*` | 10/15min | 15 minutes |
| Global | 1000/15min | 15 minutes |

### Redis Backend

For distributed rate limiting:
```yaml
redis:
  host: redis
  port: 6379
  password: ${REDIS_PASSWORD}
```

## 🌐 CDN Configuration

### Static Assets Optimization

1. **Cloudflare Integration**
   - Automatic image optimization (WebP/AVIF)
   - Edge caching for 30 days
   - Brotli compression
   - HTTP/3 support

2. **Nginx Configuration**
   - Gzip compression level 6
   - Cache headers for immutable assets
   - CORS headers for CDN compatibility

3. **Image Optimization Worker**
   - On-the-fly resizing: `/optimize/image.jpg?w=800&h=600`
   - Quality adjustment: `?q=85`
   - Format conversion: `?f=webp`

### Cache Strategy

```nginx
# Static assets (1 year)
location /static/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}

# Images (30 days)
location /images/ {
    expires 30d;
    add_header Cache-Control "public, no-transform";
}
```

## 🔄 Blue-Green Deployment

### Docker Compose Method

1. **Deploy to Green**
   ```bash
   docker-compose -f docker-compose.blue-green.yml up -d app-green
   ```

2. **Test Green**
   ```bash
   curl http://localhost/test/green/health
   ```

3. **Switch Traffic**
   ```bash
   curl http://localhost/switch/green
   ```

4. **Rollback if Needed**
   ```bash
   curl http://localhost/switch/blue
   ```

### Kubernetes Method

1. **Deploy New Version**
   ```bash
   ./scripts/blue-green-deploy.sh ghcr.io/nubem000/nubemssm:v2.1.0
   ```

2. **Automatic Process**
   - Updates inactive deployment
   - Runs health checks
   - Switches traffic
   - Scales down old version

3. **Manual Rollback**
   ```bash
   kubectl patch service speedmonitor-active -n speedmonitor \
     -p '{"spec":{"selector":{"version":"blue"}}}'
   ```

### Zero-Downtime Guarantees

- Health checks before switch
- Gradual rollout support
- Automatic rollback on failure
- Session affinity during transition

## 📊 API Endpoints

### Public Endpoints

- `GET /health` - Health check
- `GET /metrics` - Prometheus metrics

### Protected Endpoints

- `GET /api/status` - Current status and statistics
- `GET /api/history?hours=24&limit=100` - Historical data
- `POST /api/test/trigger` - Manually trigger speed test (admin only)
- `POST /api/keys` - Generate API key (admin only)

### Authentication Endpoints

- `POST /auth/login` - Login with username/password
- `POST /auth/refresh` - Refresh JWT token
- `POST /auth/logout` - Logout and invalidate token

## 🔧 Environment Variables

### Security
```bash
JWT_SECRET=your-super-secret-key
JWT_EXPIRY=24h
ADMIN_PASSWORD=strong-password
ADMIN_EMAIL=admin@example.com
```

### CDN/Proxy
```bash
ALLOWED_ORIGINS=https://app.example.com,https://example.com
TRUSTED_PROXIES=10.0.0.0/8,172.16.0.0/12
```

### Redis
```bash
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=redis-password
```

### Monitoring
```bash
SENTRY_DSN=https://xxx@sentry.io/xxx
LOG_LEVEL=info
```

## 🚀 Performance Optimizations

1. **Connection Pooling**
   - PostgreSQL: 20 connections max
   - Redis: Connection reuse
   - HTTP Keep-Alive enabled

2. **Resource Limits**
   - CPU: 0.5 cores max
   - Memory: 512MB max
   - Automatic scaling 2-10 replicas

3. **Caching Strategy**
   - Static assets: 1 year
   - API responses: No cache
   - Database queries: Prepared statements

## 🔍 Troubleshooting

### Check Logs
```bash
# Application logs
docker-compose logs -f app

# Nginx logs
docker-compose logs -f nginx

# All services
docker-compose logs -f
```

### Health Checks
```bash
# Service health
curl http://localhost:3000/health

# Database connection
docker-compose exec app npm run db:test

# Redis connection
docker-compose exec redis redis-cli ping
```

### Common Issues

1. **Rate Limit Exceeded**
   - Check `X-RateLimit-Remaining` header
   - Wait for `X-RateLimit-Reset`

2. **Authentication Failed**
   - Verify JWT not expired
   - Check role permissions

3. **CDN Not Caching**
   - Verify cache headers
   - Check Cloudflare settings

4. **Blue-Green Switch Failed**
   - Check health endpoints
   - Verify both deployments running
   - Review nginx logs