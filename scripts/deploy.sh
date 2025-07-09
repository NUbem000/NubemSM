#!/bin/bash
# Production deployment script

set -e

echo "🚀 Starting NubemSM deployment..."

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "❌ Docker is required but not installed. Aborting." >&2; exit 1; }
command -v docker-compose >/dev/null 2>&1 || { echo "❌ Docker Compose is required but not installed. Aborting." >&2; exit 1; }

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found. Creating from example..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your configuration and run this script again."
    exit 1
fi

# Validate required environment variables
required_vars=("DB_PASSWORD" "GF_ADMIN_PASSWORD")
for var in "${required_vars[@]}"; do
    if ! grep -q "^${var}=" .env || grep -q "^${var}=your_" .env; then
        echo "❌ ${var} is not properly configured in .env file"
        exit 1
    fi
done

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p logs backups grafana/provisioning/dashboards grafana/provisioning/datasources

# Create Grafana datasource provisioning
cat > grafana/provisioning/datasources/postgres.yml << EOF
apiVersion: 1

datasources:
  - name: PostgreSQL
    type: postgres
    access: proxy
    url: db:5432
    database: \${DB_NAME}
    user: \${DB_USER}
    secureJsonData:
      password: \${DB_PASSWORD}
    jsonData:
      sslmode: 'disable'
      maxOpenConns: 0
      maxIdleConns: 2
      connMaxLifetime: 14400
      postgresVersion: 1500
      timescaledb: false
EOF

# Create Grafana dashboard provisioning
cat > grafana/provisioning/dashboards/dashboard.yml << EOF
apiVersion: 1

providers:
  - name: 'default'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 30
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards
EOF

# Copy dashboard if exists
if [ -f grafana/dashboard.json ]; then
    cp grafana/dashboard.json grafana/dashboards/
fi

# Pull latest images
echo "🐳 Pulling Docker images..."
docker-compose -f docker-compose.prod.yml pull

# Stop existing containers
echo "🛑 Stopping existing containers..."
docker-compose -f docker-compose.prod.yml down

# Start services
echo "🚀 Starting services..."
docker-compose -f docker-compose.prod.yml up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Check health
echo "🏥 Checking service health..."
if curl -f http://localhost:3000/health >/dev/null 2>&1; then
    echo "✅ Speed monitor is healthy"
else
    echo "❌ Speed monitor health check failed"
    docker-compose -f docker-compose.prod.yml logs app
    exit 1
fi

# Run database migrations
echo "🗄️ Running database migrations..."
docker-compose -f docker-compose.prod.yml exec -T db psql -U \${DB_USER} -d \${DB_NAME} < db/migrations/001_add_server_info.sql || true

echo "✅ Deployment complete!"
echo ""
echo "📊 Access points:"
echo "   - Grafana: http://localhost:3001 (admin/\${GF_ADMIN_PASSWORD})"
echo "   - Prometheus: http://localhost:9090"
echo "   - Health API: http://localhost:3000/health"
echo "   - Metrics: http://localhost:3000/metrics"
echo ""
echo "📝 Next steps:"
echo "   1. Configure Grafana dashboards"
echo "   2. Set up alerting rules"
echo "   3. Configure backup retention"
echo "   4. Monitor logs: docker-compose -f docker-compose.prod.yml logs -f"