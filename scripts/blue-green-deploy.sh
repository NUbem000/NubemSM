#!/bin/bash
# Blue-Green Deployment Script

set -e

# Configuration
NAMESPACE="speedmonitor"
APP_NAME="speedmonitor"
HEALTH_CHECK_URL="http://speedmonitor-green/health"
ROLLBACK_ON_FAILURE=true

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

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

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed"
        exit 1
    fi
    
    if ! kubectl get namespace $NAMESPACE &> /dev/null; then
        log_error "Namespace $NAMESPACE does not exist"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Get current active deployment
get_active_deployment() {
    local service_selector=$(kubectl get service speedmonitor-active -n $NAMESPACE -o jsonpath='{.spec.selector.version}')
    echo $service_selector
}

# Get inactive deployment
get_inactive_deployment() {
    local active=$1
    if [ "$active" == "blue" ]; then
        echo "green"
    else
        echo "blue"
    fi
}

# Scale deployment
scale_deployment() {
    local deployment=$1
    local replicas=$2
    
    log_info "Scaling $deployment to $replicas replicas..."
    kubectl scale deployment speedmonitor-$deployment -n $NAMESPACE --replicas=$replicas
    
    # Wait for rollout to complete
    kubectl rollout status deployment speedmonitor-$deployment -n $NAMESPACE --timeout=300s
}

# Update deployment image
update_deployment() {
    local deployment=$1
    local image=$2
    
    log_info "Updating $deployment deployment with image: $image"
    kubectl set image deployment/speedmonitor-$deployment speedmonitor=$image -n $NAMESPACE
    
    # Wait for rollout to complete
    kubectl rollout status deployment speedmonitor-$deployment -n $NAMESPACE --timeout=300s
}

# Health check
health_check() {
    local deployment=$1
    local max_attempts=30
    local attempt=1
    
    log_info "Running health checks for $deployment deployment..."
    
    while [ $attempt -le $max_attempts ]; do
        # Check pod readiness
        local ready_pods=$(kubectl get pods -n $NAMESPACE -l app=speedmonitor,version=$deployment -o jsonpath='{.items[?(@.status.conditions[?(@.type=="Ready")].status=="True")].metadata.name}' | wc -w)
        local total_pods=$(kubectl get pods -n $NAMESPACE -l app=speedmonitor,version=$deployment -o jsonpath='{.items[*].metadata.name}' | wc -w)
        
        if [ $ready_pods -eq $total_pods ] && [ $ready_pods -gt 0 ]; then
            log_success "All $ready_pods pods are ready"
            
            # Additional health check via service
            if kubectl exec -n $NAMESPACE deployment/speedmonitor-$deployment -- curl -f -s http://localhost:3000/health > /dev/null; then
                log_success "Health check passed"
                return 0
            fi
        fi
        
        log_info "Attempt $attempt/$max_attempts: $ready_pods/$total_pods pods ready"
        sleep 10
        ((attempt++))
    done
    
    log_error "Health check failed after $max_attempts attempts"
    return 1
}

# Switch traffic
switch_traffic() {
    local new_active=$1
    
    log_info "Switching traffic to $new_active deployment..."
    kubectl patch service speedmonitor-active -n $NAMESPACE -p '{"spec":{"selector":{"version":"'$new_active'"}}}'
    
    log_success "Traffic switched to $new_active"
}

# Rollback
rollback() {
    local previous_active=$1
    
    log_warning "Rolling back to $previous_active deployment..."
    switch_traffic $previous_active
    
    # Scale down failed deployment
    local failed=$(get_inactive_deployment $previous_active)
    scale_deployment $failed 0
    
    log_success "Rollback completed"
}

# Main deployment process
main() {
    local new_image=${1:-}
    
    if [ -z "$new_image" ]; then
        log_error "Usage: $0 <new-image>"
        echo "Example: $0 ghcr.io/nubem000/nubemssm:v2.0.0"
        exit 1
    fi
    
    log_info "Starting Blue-Green deployment process..."
    
    # Check prerequisites
    check_prerequisites
    
    # Get current state
    local active_deployment=$(get_active_deployment)
    local inactive_deployment=$(get_inactive_deployment $active_deployment)
    
    log_info "Current active deployment: $active_deployment"
    log_info "Target deployment: $inactive_deployment"
    
    # Save current state for rollback
    local previous_replicas=$(kubectl get deployment speedmonitor-$active_deployment -n $NAMESPACE -o jsonpath='{.spec.replicas}')
    
    # Update inactive deployment
    update_deployment $inactive_deployment $new_image
    
    # Scale up inactive deployment
    scale_deployment $inactive_deployment $previous_replicas
    
    # Run health checks
    if health_check $inactive_deployment; then
        # Switch traffic
        switch_traffic $inactive_deployment
        
        # Verify traffic switch
        sleep 5
        if health_check $inactive_deployment; then
            log_success "Deployment successful!"
            
            # Scale down old deployment
            log_info "Scaling down previous deployment..."
            scale_deployment $active_deployment 0
            
            log_success "Blue-Green deployment completed successfully"
            
            # Show deployment status
            echo ""
            log_info "Deployment Status:"
            kubectl get deployments -n $NAMESPACE -l app=speedmonitor
            echo ""
            kubectl get pods -n $NAMESPACE -l app=speedmonitor
        else
            log_error "Post-switch health check failed"
            if [ "$ROLLBACK_ON_FAILURE" = true ]; then
                rollback $active_deployment
            fi
            exit 1
        fi
    else
        log_error "Pre-switch health check failed"
        if [ "$ROLLBACK_ON_FAILURE" = true ]; then
            # Scale down failed deployment
            scale_deployment $inactive_deployment 0
        fi
        exit 1
    fi
}

# Run main function
main "$@"