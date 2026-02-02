#!/bin/bash

# Finviz Elite Dashboard - Quick Start Script
# Double-click this file to start the proxy server

echo "============================================================"
echo "🚀 Starting Finviz Elite Proxy Server"
echo "============================================================"
echo ""
echo "Starting server on http://localhost:5000..."
echo ""
echo "⚠️  Keep this window open while trading!"
echo "⚠️  Press Ctrl+C to stop the server"
echo ""
echo "============================================================"

# Change to the directory where this script is located
cd "$(dirname "$0")"

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed"
    echo "Please install Python 3 and try again"
    exit 1
fi

# Check if required packages are installed
python3 -c "import flask, flask_cors, requests" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "📦 Installing required packages..."
    pip3 install flask flask-cors requests
    echo ""
fi

# Start the proxy server
python3 finviz_proxy.py

# Keep window open if server crashes
read -p "Press Enter to close this window..."
