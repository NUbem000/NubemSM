#!/bin/bash
# Script to set up infrastructure for NubemSM on GCP

set -e

# Configuration
PROJECT_ID="nubemsm"
REGION="us-central1"
ZONE="us-central1-a"
DB_INSTANCE_NAME="nubemsm-postgres"
DB_VERSION="POSTGRES_15"
DB_TIER="db-g1-small"
REDIS_INSTANCE_NAME="nubemsm-redis"
REDIS_TIER="basic"
REDIS_SIZE_GB="1"

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

# Create Cloud SQL PostgreSQL instance
log_info "Creating Cloud SQL PostgreSQL instance..."
gcloud sql instances create ${DB_INSTANCE_NAME} \
    --database-version=${DB_VERSION} \
    --tier=${DB_TIER} \
    --region=${REGION} \
    --network=projects/${PROJECT_ID}/global/networks/nubemsm-network \
    --no-assign-ip \
    --backup \
    --backup-start-time=03:00 \
    --maintenance-window-day=SUN \
    --maintenance-window-hour=4 \
    --maintenance-window-duration=1 \
    --database-flags=shared_preload_libraries=pg_stat_statements \
    --storage-type=SSD \
    --storage-size=10GB \
    --storage-auto-increase \
    --storage-auto-increase-limit=100 \
    --project=${PROJECT_ID} || true

# Create database and user
log_info "Creating database and user..."
gcloud sql databases create speedmonitor \
    --instance=${DB_INSTANCE_NAME} \
    --project=${PROJECT_ID} || true

# Generate secure password
DB_PASSWORD=$(openssl rand -base64 32)

gcloud sql users create speedmonitor \
    --instance=${DB_INSTANCE_NAME} \
    --password=${DB_PASSWORD} \
    --project=${PROJECT_ID} || true

# Create Redis instance
log_info "Creating Redis instance..."
gcloud redis instances create ${REDIS_INSTANCE_NAME} \
    --size=${REDIS_SIZE_GB} \
    --region=${REGION} \
    --tier=${REDIS_TIER} \
    --redis-version=redis_7_0 \
    --network=projects/${PROJECT_ID}/global/networks/nubemsm-network \
    --project=${PROJECT_ID} || true

# Create secrets in Secret Manager
log_info "Creating secrets..."

# Database password
echo -n "${DB_PASSWORD}" | gcloud secrets create db-password \
    --data-file=- \
    --replication-policy="automatic" \
    --project=${PROJECT_ID} || true

# JWT secret
JWT_SECRET=$(openssl rand -base64 64)
echo -n "${JWT_SECRET}" | gcloud secrets create jwt-secret \
    --data-file=- \
    --replication-policy="automatic" \
    --project=${PROJECT_ID} || true

# Admin password
ADMIN_PASSWORD=$(openssl rand -base64 32)
echo -n "${ADMIN_PASSWORD}" | gcloud secrets create admin-password \
    --data-file=- \
    --replication-policy="automatic" \
    --project=${PROJECT_ID} || true

# Grafana admin password
GRAFANA_PASSWORD=$(openssl rand -base64 32)
echo -n "${GRAFANA_PASSWORD}" | gcloud secrets create grafana-admin-password \
    --data-file=- \
    --replication-policy="automatic" \
    --project=${PROJECT_ID} || true

# Create Cloud Storage buckets
log_info "Creating Cloud Storage buckets..."

# Bucket for backups
gsutil mb -p ${PROJECT_ID} -c STANDARD -l ${REGION} gs://${PROJECT_ID}-backups/ || true
gsutil lifecycle set gcp/bucket-lifecycle.json gs://${PROJECT_ID}-backups/ || true

# Bucket for static assets
gsutil mb -p ${PROJECT_ID} -c STANDARD -l ${REGION} gs://${PROJECT_ID}-static/ || true
gsutil iam ch allUsers:objectViewer gs://${PROJECT_ID}-static/ || true

# Create Grafana Cloud Run service
log_info "Creating Grafana service..."
gcloud run deploy nubemsm-grafana \
    --image=grafana/grafana:10-ubuntu \
    --platform=managed \
    --region=${REGION} \
    --allow-unauthenticated \
    --service-account=nubemsm-cloudrun@${PROJECT_ID}.iam.gserviceaccount.com \
    --set-env-vars="GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}" \
    --set-env-vars="GF_INSTALL_PLUGINS=grafana-clock-panel,grafana-simple-json-datasource" \
    --set-env-vars="GF_SERVER_ROOT_URL=https://grafana-nubemsm.run.app" \
    --cpu=1 \
    --memory=512Mi \
    --min-instances=0 \
    --max-instances=10 \
    --project=${PROJECT_ID} || true

# Create Prometheus Cloud Run service
log_info "Creating Prometheus service..."
gcloud run deploy nubemsm-prometheus \
    --image=prom/prometheus:latest \
    --platform=managed \
    --region=${REGION} \
    --no-allow-unauthenticated \
    --service-account=nubemsm-cloudrun@${PROJECT_ID}.iam.gserviceaccount.com \
    --cpu=1 \
    --memory=1Gi \
    --min-instances=1 \
    --max-instances=5 \
    --project=${PROJECT_ID} || true

# Output connection details
echo ""
log_success "Infrastructure setup completed!"
echo ""
echo "=== Connection Details ==="
echo "Project ID: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo ""
echo "=== Database ==="
echo "Cloud SQL Instance: ${DB_INSTANCE_NAME}"
echo "Database Name: speedmonitor"
echo "Database User: speedmonitor"
echo "Database Password: Stored in Secret Manager (db-password)"
echo ""
echo "=== Redis ==="
echo "Redis Instance: ${REDIS_INSTANCE_NAME}"
echo ""
echo "=== Secrets ==="
echo "DB Password: gcloud secrets versions access latest --secret=db-password"
echo "JWT Secret: gcloud secrets versions access latest --secret=jwt-secret"
echo "Admin Password: gcloud secrets versions access latest --secret=admin-password"
echo "Grafana Password: gcloud secrets versions access latest --secret=grafana-admin-password"
echo ""
echo "=== Next Steps ==="
echo "1. Update the Cloud Build configuration with these values"
echo "2. Run ./deploy.sh to deploy the application"