#!/bin/bash
# Quick test script to verify server and auth are working

echo "Testing OpenRange Server Setup"
echo "==============================="
echo ""

# Test 1: Health check
echo "1. Testing /api/health..."
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool
echo ""

# Test 2: Login
echo "2. Testing login..."
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"trader","password":"changeMe123!"}' | python3 -c "import sys, json; print(json.load(sys.stdin).get('token',''))")
echo "Token: ${TOKEN:0:50}..."
echo ""

# Test 3: Verify token
echo "3. Testing /api/auth/verify..."
curl -s http://127.0.0.1:3000/api/auth/verify \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
echo ""

# Test 4: News (no auth required)
echo "4. Testing /api/saxo/news..."
curl -s http://127.0.0.1:3000/api/saxo/news | python3 -m json.tool | head -20
echo ""

echo "All tests completed!"
