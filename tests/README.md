# Tests

All test scripts use a separate `test` database in the same Neo4j instance to avoid polluting your main data.

## Setup

### 1. Ensure Neo4j is Running
```bash
docker ps | grep brainfreeze-neo4j
# If not running: docker start brainfreeze-neo4j
```

### 2. Create Test Database
```bash
bash tests/setup-test-db.sh
```

This will:
- Create a `test` database in Neo4j
- Initialize the schema on test database
- Use `.env.test` configuration

**Note:** Neo4j Community Edition only supports one database. If you're using Community Edition, the setup script will warn you. Consider using:
- A separate Docker container for testing
- Neo4j Enterprise (supports multiple databases)
- Manually clean your main database between tests

## Running Tests

### Individual Tests

```bash
# Test entity deduplication
bash tests/test-dedup.sh

# Test relationships
bash tests/test-relationships.sh

# Test hybrid search
bash tests/test-hybrid-search.sh
```

All tests automatically use the `test` database via `.env.test`.

### NPM Scripts (coming soon)

```bash
bun run test:setup        # Create test database
bun run test:dedup        # Run dedup test
bun run test:relationships # Run relationship test
bun run test:hybrid       # Run hybrid search test
bun run test:teardown     # Clean test database
```

## Configuration

Test environment is configured in `.env.test`:

```bash
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password
NEO4J_DATABASE=test        # Uses 'test' database
```

## Cleaning Test Data

### Option 1: Clear all data (keeps schema)
```bash
bash tests/teardown-test-db.sh
```

### Option 2: Manual cleanup
```bash
docker exec brainfreeze-neo4j cypher-shell -u neo4j -p password -d test \
  "MATCH (n) DETACH DELETE n;"
```

### Option 3: Drop and recreate (Enterprise only)
```bash
docker exec brainfreeze-neo4j cypher-shell -u neo4j -p password \
  "DROP DATABASE test IF EXISTS; CREATE DATABASE test;"
bash tests/setup-test-db.sh
```

## Test Descriptions

### test-dedup.sh
Tests entity name normalization:
- Stores memories with "Sarah", "sarah", "SARAH"
- Verifies they merge into single entity
- Exports data for inspection

### test-relationships.sh
Tests relationship extraction:
- Stores memories with entity relationships
- Verifies KNOWS, WORKS_AT, LIVES_IN edges created
- Shows Cypher queries to inspect results

### test-hybrid-search.sh
Tests hybrid vs vector search:
- Stores related memories
- Compares vector-only vs hybrid (vector + graph) results
- Shows how graph connections expand results

## Neo4j Browser

View test data:
1. Open http://localhost:7474
2. Select database: `test` (dropdown in top-left)
3. Run queries:
   ```cypher
   // All memories in test db
   MATCH (m:Memory) RETURN m ORDER BY m.timestamp DESC

   // All entities
   MATCH (e:Entity) RETURN e

   // All relationships (excluding MENTIONS)
   MATCH (a)-[r]->(b)
   WHERE type(r) <> 'MENTIONS'
   RETURN a.name, type(r), b.name
   ```

## Troubleshooting

### "Could not create database"
- You're using Neo4j Community Edition (single database only)
- Workaround: Manually clean main database between tests or use separate container

### "Neo4j is not running"
```bash
docker start brainfreeze-neo4j
# Wait a few seconds
bash tests/setup-test-db.sh
```

### Tests use main database instead of test
- Check `.env.test` is being loaded
- Each test script has `export $(cat .env.test | grep -v '^#' | xargs)`
- Verify with: `echo $NEO4J_DATABASE` (should be "test")

### Can't see test database in browser
- Neo4j Community Edition: only "neo4j" database available
- Neo4j Enterprise: use database dropdown in browser
