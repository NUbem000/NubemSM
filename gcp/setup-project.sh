#!/bin/bash
# Script to set up NubemSM project on Google Cloud Platform

set -e

# Configuration
PROJECT_ID="nubemsm"
PROJECT_NAME="NubemSM Speed Monitor"
BILLING_ACCOUNT_ID="${BILLING_ACCOUNT_ID:-}"
REGION="us-central1"
ZONE="us-central1-a"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    log_error "gcloud CLI is not installed. Please install it first."
    exit 1
fi

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &> /dev/null; then
    log_warning "Not authenticated. Running gcloud auth login..."
    gcloud auth login
fi

# Create new project
log_info "Creating project ${PROJECT_ID}..."
if gcloud projects create ${PROJECT_ID} --name="${PROJECT_NAME}" 2>/dev/null; then
    log_success "Project created successfully"
else
    log_warning "Project might already exist, continuing..."
fi

# Set the project as active
log_info "Setting ${PROJECT_ID} as active project..."
gcloud config set project ${PROJECT_ID}

# Link billing account
if [ -n "$BILLING_ACCOUNT_ID" ]; then
    log_info "Linking billing account..."
    gcloud beta billing projects link ${PROJECT_ID} --billing-account=${BILLING_ACCOUNT_ID}
else
    log_warning "No billing account provided. Please link one manually:"
    echo "gcloud beta billing projects link ${PROJECT_ID} --billing-account=YOUR_BILLING_ACCOUNT_ID"
    
    # List available billing accounts
    log_info "Available billing accounts:"
    gcloud beta billing accounts list
fi

# Enable required APIs
log_info "Enabling required APIs..."
apis=(
    "compute.googleapis.com"
    "container.googleapis.com"
    "containerregistry.googleapis.com"
    "cloudbuild.googleapis.com"
    "run.googleapis.com"
    "sqladmin.googleapis.com"
    "secretmanager.googleapis.com"
    "cloudresourcemanager.googleapis.com"
    "redis.googleapis.com"
    "monitoring.googleapis.com"
    "logging.googleapis.com"
    "artifactregistry.googleapis.com"
    "certificatemanager.googleapis.com"
    "dns.googleapis.com"
)

for api in "${apis[@]}"; do
    log_info "Enabling $api..."
    gcloud services enable $api --project=${PROJECT_ID}
done

log_success "APIs enabled successfully"

# Set default region and zone
log_info "Setting default region and zone..."
gcloud config set compute/region ${REGION}
gcloud config set compute/zone ${ZONE}

# Create Artifact Registry repository for Docker images
log_info "Creating Artifact Registry repository..."
gcloud artifacts repositories create nubemsm-docker \
    --repository-format=docker \
    --location=${REGION} \
    --description="Docker images for NubemSM" \
    --project=${PROJECT_ID} || true

# Create service accounts
log_info "Creating service accounts..."

# Cloud Run service account
gcloud iam service-accounts create nubemsm-cloudrun \
    --display-name="NubemSM Cloud Run Service Account" \
    --project=${PROJECT_ID} || true

# Cloud Build service account
gcloud iam service-accounts create nubemsm-cloudbuild \
    --display-name="NubemSM Cloud Build Service Account" \
    --project=${PROJECT_ID} || true

# Grant necessary permissions
log_info "Granting IAM permissions..."

# Cloud Run permissions
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:nubemsm-cloudrun@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:nubemsm-cloudrun@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:nubemsm-cloudrun@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/redis.editor"

# Cloud Build permissions
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:nubemsm-cloudbuild@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/cloudbuild.builds.builder"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:nubemsm-cloudbuild@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/run.developer"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
    --member="serviceAccount:nubemsm-cloudbuild@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/artifactregistry.writer"

# Create VPC network
log_info "Creating VPC network..."
gcloud compute networks create nubemsm-network \
    --subnet-mode=auto \
    --project=${PROJECT_ID} || true

# Create firewall rules
log_info "Creating firewall rules..."
gcloud compute firewall-rules create nubemsm-allow-internal \
    --network=nubemsm-network \
    --allow=tcp,udp,icmp \
    --source-ranges=10.0.0.0/8 \
    --project=${PROJECT_ID} || true

# Output project info
echo ""
log_success "Project setup completed!"
echo ""
echo "Project ID: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo "Zone: ${ZONE}"
echo ""
echo "Next steps:"
echo "1. Link a billing account if not done already"
echo "2. Run ./setup-infrastructure.sh to create the infrastructure"
echo "3. Run ./deploy.sh to deploy the application"
echo ""
echo "To use this project:"
echo "gcloud config set project ${PROJECT_ID}"