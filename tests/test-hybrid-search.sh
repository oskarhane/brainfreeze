#!/bin/bash
set -e

# Load test environment
export $(cat .env.test | grep -v '^#' | xargs)

echo "Testing hybrid search vs regular search..."
echo "Using test database: $NEO4J_URI"
echo ""

echo "1. Adding test memories..."
bun run memory "John works at Google on AI projects"
bun run memory "Sarah is a data scientist at Microsoft"
bun run memory "Met John for coffee to discuss machine learning"
bun run memory "Sarah presented at the AI conference last week"
bun run memory "Google announced new AI model"

echo ""
echo "2. Regular vector search for 'AI technology':"
bun run memory recall "AI technology" -l 3

echo ""
echo "3. Hybrid search for 'AI technology' (should find more related via graph):"
bun run memory recall "AI technology" -l 3 --hybrid

echo ""
echo "Done! Hybrid should include memories connected through entities even if not semantically similar."
