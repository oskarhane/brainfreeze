#!/bin/bash
set -e

echo "Cleaning test database..."

# Clear all data from test database
docker exec brainfreeze-neo4j cypher-shell -u neo4j -p password -d test \
  "MATCH (n) DETACH DELETE n;" 2>/dev/null || {
    echo "❌ Could not clean test database"
    echo "   Manually clean with:"
    echo "   docker exec brainfreeze-neo4j cypher-shell -u neo4j -p password -d test 'MATCH (n) DETACH DELETE n;'"
    exit 1
  }

echo "✓ Test database cleaned"
