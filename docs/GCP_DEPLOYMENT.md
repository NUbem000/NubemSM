# 🚀 NubemSM - Google Cloud Platform Deployment Guide

## 📋 Prerequisites

- Google Cloud account with billing enabled
- `gcloud` CLI installed and authenticated
- Docker installed locally
- Domain name (optional, for custom domain)

## 🏗️ Architecture Overview

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Cloud CDN     │────▶│ Load Balancer│────▶│   Cloud Run     │
└─────────────────┘     └──────────────┘     │   (NubemSM)     │
                                             └─────────────────┘
                                                      │
                                    ┌─────────────────┴──────────────┐
                                    │                                │
                              ┌─────▼──────┐              ┌─────────▼────────┐
                              │ Cloud SQL  │              │  Redis Memory    │
                              │(PostgreSQL)│              │     Store        │
                              └────────────┘              └──────────────────┘
```

## 🚀 Quick Deployment

### 1. Clone and Navigate
```bash
git clone https://github.com/NUbem000/NubemSM.git
cd NubemSM
```

### 2. Run Setup Scripts
```bash
# Set up the GCP project
cd gcp
./setup-project.sh

# Create infrastructure
./setup-infrastructure.sh

# Deploy application
./deploy.sh

# (Optional) Set up CDN
./setup-cdn.sh
```

## 📝 Detailed Steps

### Step 1: Project Setup

The `setup-project.sh` script will:
- Create a new GCP project named `nubemsm`
- Enable required APIs (Cloud Run, SQL, etc.)
- Create service accounts with proper permissions
- Set up VPC networking

```bash
# If you have a billing account ID:
export BILLING_ACCOUNT_ID="XXXXXX-XXXXXX-XXXXXX"
./setup-project.sh

# Otherwise, link billing manually after running the script
```

### Step 2: Infrastructure Setup

The `setup-infrastructure.sh` script creates:
- **Cloud SQL PostgreSQL** instance (db-g1-small)
- **Redis** instance for caching/sessions
- **Secret Manager** entries for sensitive data
- **Cloud Storage** buckets for backups and static assets
- **Grafana** and **Prometheus** services

### Step 3: Application Deployment

The `deploy.sh` script:
- Builds and pushes Docker image to Artifact Registry
- Deploys to Cloud Run with auto-scaling
- Configures environment variables and secrets
- Sets up Cloud Scheduler for periodic speed tests
- Creates monitoring alerts

### Step 4: CDN Setup (Optional but Recommended)

The `setup-cdn.sh` script configures:
- Global Load Balancer with static IP
- Cloud CDN for static asset caching
- SSL certificate (auto-provisioned)
- Cloud Armor for DDoS protection
- HTTP to HTTPS redirect

## 🔧 Configuration

### Environment Variables

All sensitive data is stored in Secret Manager:
- `db-password`: PostgreSQL password
- `jwt-secret`: JWT signing key
- `admin-password`: Admin user password
- `grafana-admin-password`: Grafana admin password

### Scaling Configuration

Default Cloud Run settings:
- **CPU**: 1 vCPU
- **Memory**: 512 MB
- **Min instances**: 1 (always warm)
- **Max instances**: 20
- **Concurrency**: 100 requests per instance

### Database Configuration

Cloud SQL settings:
- **Version**: PostgreSQL 15
- **Tier**: db-g1-small (1 vCPU, 1.7 GB RAM)
- **Storage**: 10 GB SSD with auto-increase
- **Backups**: Daily at 3:00 AM UTC
- **High Availability**: Can be enabled for production

## 🌐 Domain Configuration

### Using Custom Domain

1. Update the domain in scripts:
   ```bash
   export CUSTOM_DOMAIN="speedmonitor.yourdomain.com"
   ./setup-cdn.sh
   ```

2. Add DNS A record:
   - Type: `A`
   - Name: `@` or subdomain
   - Value: IP from script output

3. Wait for SSL certificate provisioning (up to 20 minutes)

### Default URLs

Without custom domain:
- App: `https://nubemsm-HASH-uc.a.run.app`
- Grafana: `https://nubemsm-grafana-HASH-uc.a.run.app`

## 📊 Monitoring & Logs

### View Logs
```bash
# Application logs
gcloud run logs read --service=nubemsm --region=us-central1

# Follow logs in real-time
gcloud run logs tail --service=nubemsm --region=us-central1
```

### Access Metrics
- Cloud Run metrics: [Console](https://console.cloud.google.com/run)
- Custom dashboards: Access Grafana with admin credentials
- Alerts: Configured in Cloud Monitoring

### Health Checks
```bash
# Check service health
curl https://YOUR-SERVICE-URL/health

# Check metrics endpoint
curl https://YOUR-SERVICE-URL/metrics
```

## 💰 Cost Optimization

### Estimated Monthly Costs

| Service | Configuration | Est. Cost |
|---------|--------------|-----------|
| Cloud Run | 1-20 instances | $10-50 |
| Cloud SQL | db-g1-small | $25 |
| Redis | 1GB Basic | $35 |
| Load Balancer | With CDN | $18 |
| **Total** | **Basic usage** | **~$88/month** |

### Cost Saving Tips

1. **Cloud Run**: Set min instances to 0 for dev/test
2. **Cloud SQL**: Use db-f1-micro for testing
3. **Redis**: Not required for basic functionality
4. **CDN**: Only needed for high traffic

## 🛠️ Maintenance

### Database Backups
- Automatic daily backups retained for 7 days
- On-demand backup:
  ```bash
  gcloud sql backups create --instance=nubemsm-postgres
  ```

### Updates and Rollbacks

1. **Update application**:
   ```bash
   git pull
   ./deploy.sh
   ```

2. **Rollback**:
   ```bash
   gcloud run revisions list --service=nubemsm --region=us-central1
   gcloud run services update-traffic nubemsm \
     --to-revisions=REVISION_NAME=100 --region=us-central1
   ```

### Scaling

```bash
# Update scaling limits
gcloud run services update nubemsm \
  --min-instances=2 \
  --max-instances=50 \
  --region=us-central1

# Update resources
gcloud run services update nubemsm \
  --cpu=2 \
  --memory=1Gi \
  --region=us-central1
```

## 🚨 Troubleshooting

### Common Issues

1. **"Permission denied" errors**
   - Ensure billing is enabled
   - Check service account permissions
   - Run `gcloud auth application-default login`

2. **Database connection issues**
   - Verify Cloud SQL proxy is enabled
   - Check firewall rules
   - Ensure correct connection string

3. **High latency**
   - Enable Cloud CDN
   - Increase min instances
   - Check region proximity

4. **SSL certificate pending**
   - Verify DNS records
   - Wait up to 20 minutes
   - Check domain ownership

### Debug Commands

```bash
# Check service status
gcloud run services describe nubemsm --region=us-central1

# View recent errors
gcloud logging read "severity>=ERROR" --limit=50

# Check Cloud SQL status
gcloud sql instances describe nubemsm-postgres

# Test database connection
gcloud sql connect nubemsm-postgres --user=speedmonitor
```

## 🔒 Security Best Practices

1. **Secrets Management**
   - All secrets in Secret Manager
   - Rotate credentials regularly
   - Use service accounts, not user credentials

2. **Network Security**
   - Cloud SQL uses private IP
   - Redis not exposed publicly
   - Cloud Armor DDoS protection

3. **Access Control**
   - IAM roles follow least privilege
   - API requires authentication
   - Admin endpoints protected

4. **Monitoring**
   - Security Command Center enabled
   - Audit logs configured
   - Vulnerability scanning active

## 📞 Support

- **Documentation**: [GitHub Wiki](https://github.com/NUbem000/NubemSM/wiki)
- **Issues**: [GitHub Issues](https://github.com/NUbem000/NubemSM/issues)
- **GCP Support**: [Cloud Console](https://console.cloud.google.com/support)

---

**Note**: This deployment is production-ready but always test thoroughly in a staging environment first.