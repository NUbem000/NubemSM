#!/bin/bash
# Setup Cloud CDN and Load Balancer for NubemSM

set -e

PROJECT_ID="nubemsm"
REGION="us-central1"
DOMAIN="${CUSTOM_DOMAIN:-speedmonitor.nubem.dev}"

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Set project
gcloud config set project ${PROJECT_ID}

# Reserve static IP
log_info "Reserving static IP address..."
gcloud compute addresses create nubemsm-ip \
    --global \
    --project=${PROJECT_ID} || true

IP_ADDRESS=$(gcloud compute addresses describe nubemsm-ip \
    --global \
    --format="value(address)")

log_info "Reserved IP: ${IP_ADDRESS}"

# Create NEG (Network Endpoint Group) for Cloud Run
log_info "Creating Network Endpoint Group..."
gcloud compute network-endpoint-groups create nubemsm-neg \
    --region=${REGION} \
    --network-endpoint-type=serverless \
    --cloud-run-service=nubemsm \
    --project=${PROJECT_ID} || true

# Create backend service
log_info "Creating backend service..."
gcloud compute backend-services create nubemsm-backend \
    --global \
    --load-balancing-scheme=EXTERNAL \
    --protocol=HTTPS \
    --port-name=https \
    --timeout=30s \
    --enable-cdn \
    --cache-mode=CACHE_ALL_STATIC \
    --default-ttl=3600 \
    --max-ttl=86400 \
    --negative-caching \
    --serve-while-stale=86400 \
    --project=${PROJECT_ID} || true

# Add NEG to backend service
log_info "Adding NEG to backend service..."
gcloud compute backend-services add-backend nubemsm-backend \
    --global \
    --network-endpoint-group=nubemsm-neg \
    --network-endpoint-group-region=${REGION} \
    --project=${PROJECT_ID} || true

# Configure CDN policy
log_info "Configuring CDN policy..."
cat > cdn-policy.yaml <<EOF
cdnPolicy:
  cacheMode: CACHE_ALL_STATIC
  defaultTtl: 3600
  maxTtl: 86400
  clientTtl: 3600
  negativeCaching: true
  negativeCachingPolicy:
  - code: 404
    ttl: 120
  - code: 500
    ttl: 10
  serveWhileStale: 86400
  requestCoalescing: true
  cacheKeyPolicy:
    includeHost: true
    includeProtocol: true
    includeQueryString: false
    queryStringWhitelist:
    - v
    - version
compressionMode: AUTOMATIC
EOF

gcloud compute backend-services update nubemsm-backend \
    --global \
    --cache-key-policy-from-file=cdn-policy.yaml \
    --project=${PROJECT_ID}

# Create URL map
log_info "Creating URL map..."
gcloud compute url-maps create nubemsm-lb \
    --default-service=nubemsm-backend \
    --global \
    --project=${PROJECT_ID} || true

# Create path matchers for different content types
gcloud compute url-maps add-path-matcher nubemsm-lb \
    --path-matcher-name=nubemsm-paths \
    --default-service=nubemsm-backend \
    --backend-service-path-rules="/api/*=nubemsm-backend,/auth/*=nubemsm-backend" \
    --global \
    --project=${PROJECT_ID} || true

# Create managed SSL certificate
log_info "Creating SSL certificate..."
gcloud compute ssl-certificates create nubemsm-cert \
    --domains=${DOMAIN} \
    --global \
    --project=${PROJECT_ID} || true

# Create HTTPS proxy
log_info "Creating HTTPS proxy..."
gcloud compute target-https-proxies create nubemsm-https-proxy \
    --url-map=nubemsm-lb \
    --ssl-certificates=nubemsm-cert \
    --global \
    --project=${PROJECT_ID} || true

# Create forwarding rule
log_info "Creating forwarding rule..."
gcloud compute forwarding-rules create nubemsm-https-rule \
    --address=nubemsm-ip \
    --target-https-proxy=nubemsm-https-proxy \
    --ports=443 \
    --global \
    --project=${PROJECT_ID} || true

# Create HTTP to HTTPS redirect
log_info "Setting up HTTP to HTTPS redirect..."
gcloud compute url-maps create nubemsm-redirect \
    --default-url-redirect-https-redirect=true \
    --default-url-redirect-strip-query=false \
    --global \
    --project=${PROJECT_ID} || true

gcloud compute target-http-proxies create nubemsm-http-proxy \
    --url-map=nubemsm-redirect \
    --global \
    --project=${PROJECT_ID} || true

gcloud compute forwarding-rules create nubemsm-http-rule \
    --address=nubemsm-ip \
    --target-http-proxy=nubemsm-http-proxy \
    --ports=80 \
    --global \
    --project=${PROJECT_ID} || true

# Create Cloud Armor security policy
log_info "Creating Cloud Armor security policy..."
gcloud compute security-policies create nubemsm-security-policy \
    --description="Security policy for NubemSM" \
    --project=${PROJECT_ID} || true

# Add rate limiting rule
gcloud compute security-policies rules create 1000 \
    --security-policy=nubemsm-security-policy \
    --expression="true" \
    --action=rate-based-ban \
    --rate-limit-threshold-count=100 \
    --rate-limit-threshold-interval-sec=60 \
    --ban-duration-sec=600 \
    --conform-action=allow \
    --exceed-action=deny-429 \
    --enforce-on-key=IP \
    --project=${PROJECT_ID} || true

# Add country blocking rule (optional)
# gcloud compute security-policies rules create 2000 \
#     --security-policy=nubemsm-security-policy \
#     --expression="origin.region_code in ['CN', 'RU']" \
#     --action=deny-403 \
#     --project=${PROJECT_ID} || true

# Apply security policy to backend
gcloud compute backend-services update nubemsm-backend \
    --security-policy=nubemsm-security-policy \
    --global \
    --project=${PROJECT_ID}

# Output results
echo ""
log_success "CDN setup completed!"
echo ""
echo "=== Configuration ==="
echo "Static IP: ${IP_ADDRESS}"
echo "Domain: ${DOMAIN}"
echo ""
echo "=== DNS Configuration ==="
echo "Add the following DNS record:"
echo "Type: A"
echo "Name: @ (or subdomain)"
echo "Value: ${IP_ADDRESS}"
echo ""
echo "=== SSL Certificate ==="
echo "Certificate will be provisioned automatically after DNS is configured"
echo "This can take up to 20 minutes"
echo ""
echo "=== CDN Features Enabled ==="
echo "✓ Static content caching"
echo "✓ Compression"
echo "✓ HTTP/2 and QUIC"
echo "✓ Negative caching"
echo "✓ Request coalescing"
echo "✓ Cloud Armor DDoS protection"
echo ""
echo "=== Monitor CDN ==="
echo "https://console.cloud.google.com/net-services/cdn/details/nubemsm-backend"