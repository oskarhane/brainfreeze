#!/bin/bash
set -e

echo "Setting up test database..."
echo ""

# Check if Neo4j is running
if ! curl -s http://localhost:7474 > /dev/null; then
  echo "❌ Neo4j is not running at localhost:7474"
  echo "   Start it with: docker start brainfreeze-neo4j"
  exit 1
fi

echo "Creating 'test' database in Neo4j..."
echo ""

# Create test database using Cypher
# Note: This requires Neo4j Enterprise or uses system database to create
docker exec brainfreeze-neo4j cypher-shell -u neo4j -p password \
  "CREATE DATABASE test IF NOT EXISTS;" 2>/dev/null || {
    echo "⚠️  Could not create database (may already exist or using Community Edition)"
    echo "   Community Edition only supports 'neo4j' database"
    echo "   For testing, consider using a separate Neo4j instance"
  }

echo ""
echo "Initializing test database schema..."
export $(cat .env.test | grep -v '^#' | xargs)
bun run init

echo ""
echo "✓ Test database ready!"
echo "  Database: test"
echo "  URI: bolt://localhost:7687"
echo "  Browser: http://localhost:7474"
echo ""
echo "To clean test database:"
echo "  docker exec brainfreeze-neo4j cypher-shell -u neo4j -p password -d test 'MATCH (n) DETACH DELETE n;'"
