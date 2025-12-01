#!/bin/bash
set -e

# Load test environment
export $(cat .env.test | grep -v '^#' | xargs)

echo "Testing relationship extraction..."
echo "Using test database: $NEO4J_URI"
echo ""

echo "1. Storing memories with relationships..."
bun run memory "John works at Google in San Francisco"
bun run memory "Sarah lives in Brooklyn and knows John from college"
bun run memory "Met John and Sarah at Chipotle yesterday"

echo ""
echo "2. Check Neo4j browser for relationships:"
echo "   http://localhost:7475 (test database)"
echo ""
echo "3. Run these queries:"
echo "   MATCH (p:Entity)-[r:WORKS_AT]->(o:Entity) RETURN p, r, o"
echo "   MATCH (p1:Entity)-[r:KNOWS]->(p2:Entity) RETURN p1, r, p2"
echo "   MATCH (p:Entity)-[r:VISITED]->(place:Entity) RETURN p, r, place"
echo ""
echo "4. See all relationships:"
echo "   MATCH (a)-[r]->(b) WHERE type(r) <> 'MENTIONS' RETURN a.name, type(r), b.name"
