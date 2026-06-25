#!/bin/bash
# Production deployment script for AIOS v1

set -e

echo "🚀 Starting AIOS v1 production deployment..."

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo "❌ Error: .env.production file not found!"
    echo "Please copy .env.production.example to .env.production and fill in the values."
    exit 1
fi

# Load environment variables
source .env.production

# Build and deploy
echo "📦 Building Docker images..."
docker compose -f docker-compose.production.yml build

echo "🗄️ Running database migrations..."
docker compose -f docker-compose.production.yml run --rm app npx prisma migrate deploy

echo "🚀 Starting services..."
docker compose -f docker-compose.production.yml up -d

echo "✅ Deployment complete!"
echo "🌐 Application is running at http://localhost:3000"
echo "📊 Health check: http://localhost:3000/api/health"
