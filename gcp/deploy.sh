#!/bin/bash
# Deploy NubemSM to Google Cloud Platform

set -e

# Configuration
PROJECT_ID="nubemsm"
REGION="us-central1"
GITHUB_REPO="https://github.com/NUbem000/NubemSM"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Set project
gcloud config set project ${PROJECT_ID}

# Check if infrastructure is ready
log_info "Checking infrastructure status..."

# Check Cloud SQL
if ! gcloud sql instances describe nubemsm-postgres --project=${PROJECT_ID} &>/dev/null; then
    log_error "Cloud SQL instance not found. Run ./setup-infrastructure.sh first"
    exit 1
fi

# Check Redis
if ! gcloud redis instances describe nubemsm-redis --region=${REGION} --project=${PROJECT_ID} &>/dev/null; then
    log_error "Redis instance not found. Run ./setup-infrastructure.sh first"
    exit 1
fi

# Get database connection details
log_info "Getting database connection details..."
DB_CONNECTION_NAME=$(gcloud sql instances describe nubemsm-postgres \
    --project=${PROJECT_ID} \
    --format="value(connectionName)")

# Get Redis connection details
REDIS_HOST=$(gcloud redis instances describe nubemsm-redis \
    --region=${REGION} \
    --project=${PROJECT_ID} \
    --format="value(host)")

REDIS_PORT=$(gcloud redis instances describe nubemsm-redis \
    --region=${REGION} \
    --project=${PROJECT_ID} \
    --format="value(port)")

# Create environment configuration
log_info "Creating environment configuration..."
cat > .env.production <<EOF
# Database
DB_HOST=/cloudsql/${DB_CONNECTION_NAME}
DB_USER=speedmonitor
DB_NAME=speedmonitor
DB_PORT=5432

# Redis
REDIS_HOST=${REDIS_HOST}
REDIS_PORT=${REDIS_PORT}

# Application
NODE_ENV=production
SPEEDTEST_INTERVAL=300000
LOG_LEVEL=info
PORT=8080

# URLs
GF_SERVER_ROOT_URL=https://grafana-${PROJECT_ID}.run.app

# Features
ENABLE_RATE_LIMIT=true
ENABLE_AUTH=true
EOF

# Build and push Docker image
log_info "Building Docker image..."
docker build -f Dockerfile.prod -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/nubemsm-docker/speedmonitor:latest .

log_info "Authenticating Docker..."
gcloud auth configure-docker ${REGION}-docker.pkg.dev

log_info "Pushing Docker image..."
docker push ${REGION}-docker.pkg.dev/${PROJECT_ID}/nubemsm-docker/speedmonitor:latest

# Deploy main application
log_info "Deploying Speed Monitor application..."
gcloud run deploy nubemsm \
    --image=${REGION}-docker.pkg.dev/${PROJECT_ID}/nubemsm-docker/speedmonitor:latest \
    --platform=managed \
    --region=${REGION} \
    --allow-unauthenticated \
    --service-account=nubemsm-cloudrun@${PROJECT_ID}.iam.gserviceaccount.com \
    --add-cloudsql-instances=${DB_CONNECTION_NAME} \
    --update-env-vars="$(cat .env.production | grep -v '^#' | grep -v '^$' | tr '\n' ',')" \
    --update-secrets="DB_PASSWORD=db-password:latest,JWT_SECRET=jwt-secret:latest,ADMIN_PASSWORD=admin-password:latest" \
    --cpu=1 \
    --memory=512Mi \
    --min-instances=1 \
    --max-instances=20 \
    --concurrency=100 \
    --timeout=300 \
    --project=${PROJECT_ID}

# Get service URLs
APP_URL=$(gcloud run services describe nubemsm --region=${REGION} --format='value(status.url)')
GRAFANA_URL=$(gcloud run services describe nubemsm-grafana --region=${REGION} --format='value(status.url)' 2>/dev/null || echo "Not deployed")
PROMETHEUS_URL=$(gcloud run services describe nubemsm-prometheus --region=${REGION} --format='value(status.url)' 2>/dev/null || echo "Not deployed")

# Configure Grafana datasource
log_info "Configuring Grafana..."
cat > grafana-datasource.json <<EOF
{
  "name": "PostgreSQL",
  "type": "postgres",
  "url": "${DB_CONNECTION_NAME}",
  "database": "speedmonitor",
  "user": "speedmonitor",
  "secureJsonData": {
    "password": "$(gcloud secrets versions access latest --secret=db-password)"
  },
  "jsonData": {
    "sslmode": "require",
    "postgresVersion": 1500,
    "timescaledb": false
  }
}
EOF

# Set up Cloud Scheduler for regular speedtests
log_info "Setting up Cloud Scheduler..."
gcloud scheduler jobs create http speedtest-trigger \
    --location=${REGION} \
    --schedule="*/5 * * * *" \
    --uri="${APP_URL}/api/test/trigger" \
    --http-method=POST \
    --headers="Authorization=Bearer $(gcloud secrets versions access latest --secret=jwt-secret)" \
    --project=${PROJECT_ID} || true

# Set up monitoring alerts
log_info "Setting up monitoring alerts..."
cat > alert-policy.yaml <<EOF
displayName: "NubemSM - High Error Rate"
conditions:
  - displayName: "Error rate above 5%"
    conditionThreshold:
      filter: |
        resource.type="cloud_run_revision"
        resource.labels.service_name="nubemsm"
        metric.type="run.googleapis.com/request_count"
        metric.labels.response_code_class!="2xx"
      comparison: COMPARISON_GT
      thresholdValue: 0.05
      duration: 300s
      aggregations:
        - alignmentPeriod: 60s
          perSeriesAligner: ALIGN_RATE
notificationChannels: []
alertStrategy:
  autoClose: 1800s
EOF

gcloud alpha monitoring policies create --policy-from-file=alert-policy.yaml --project=${PROJECT_ID} || true

# Create custom domain mapping (optional)
if [ -n "$CUSTOM_DOMAIN" ]; then
    log_info "Setting up custom domain ${CUSTOM_DOMAIN}..."
    gcloud run domain-mappings create \
        --service=nubemsm \
        --domain=${CUSTOM_DOMAIN} \
        --region=${REGION} \
        --project=${PROJECT_ID}
fi

# Output deployment information
echo ""
log_success "Deployment completed successfully!"
echo ""
echo "=== Service URLs ==="
echo "Speed Monitor: ${APP_URL}"
echo "Grafana: ${GRAFANA_URL}"
echo "Prometheus: ${PROMETHEUS_URL}"
echo ""
echo "=== Access Credentials ==="
echo "Admin Username: admin"
echo "Admin Password: $(gcloud secrets versions access latest --secret=admin-password)"
echo "Grafana Password: $(gcloud secrets versions access latest --secret=grafana-admin-password)"
echo ""
echo "=== API Access ==="
echo "Get auth token:"
echo "curl -X POST ${APP_URL}/auth/login \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"username\":\"admin\",\"password\":\"<admin-password>\"}'"
echo ""
echo "=== Next Steps ==="
echo "1. Access Grafana and import dashboards"
echo "2. Configure alerting endpoints"
echo "3. Set up custom domain (optional)"
echo "4. Enable Cloud CDN for static assets"
echo ""
echo "=== Monitoring ==="
echo "View logs: gcloud run logs read --service=nubemsm --region=${REGION}"
echo "View metrics: https://console.cloud.google.com/run/detail/${REGION}/nubemsm/metrics"