#!/bin/bash
set -e

echo "Testing entity deduplication and export/import..."

# Clear any existing data (you may want to backup first!)
# docker restart brainfreeze-neo4j
# sleep 5

echo ""
echo "1. Storing memories with same entities (different case)..."
bun run memory "Met Sarah at the cafe"
bun run memory "sarah suggested a new book"
bun run memory "Had coffee with SARAH yesterday"

echo ""
echo "2. Listing memories..."
bun run memory list -l 5

echo ""
echo "3. Exporting to test-export.json..."
bun run memory export test-export.json

echo ""
echo "4. Contents of export file:"
cat test-export.json | head -30

echo ""
echo "Done! Check Neo4j browser to see if Sarah/sarah/SARAH merged into one entity."
echo "Visit: http://localhost:7474"
echo "Run: MATCH (e:Entity {type: 'person'}) RETURN e"
