#!/bin/bash

echo "🧹 Killing running dev servers..."
pkill -f "next" || true
pkill -f "node" || true

echo "📁 Switching to trading-os..."
cd "$(dirname "$0")/../trading-os" || exit

echo "🔥 Removing build artifacts..."
rm -rf .next
rm -rf node_modules
rm -rf package-lock.json

echo "📦 Installing dependencies..."
npm install

echo "📦 Ensuring tailwind-merge is installed..."
npm install tailwind-merge

echo "🚀 Starting dev server..."
npm run dev
