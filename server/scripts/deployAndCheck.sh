#!/bin/bash

set -euo pipefail

echo "Deploying to Railway..."
railway up

echo "Waiting for deployment..."
sleep 5

echo "Running system check..."
node scripts/checkSystem.js
