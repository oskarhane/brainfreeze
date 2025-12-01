# Tests

All tests use a separate `test` database in the same Neo4j instance to avoid polluting your main data.

Tests are written using [Bun's built-in test runner](https://bun.sh/docs/cli/test).

## Setup

### 1. Ensure Neo4j is Running
```bash
docker ps | grep brainfreeze-neo4j
# If not running: docker start brainfreeze-neo4j
```

### 2. Add API Keys to .env.test
```bash
# Edit .env.test and add your API keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

**Note:** Tests will automatically create the `test` database and initialize schema on first run.

### Neo4j Community vs Enterprise
- **Community Edition**: Only supports one database. Tests will warn but continue.
- **Enterprise Edition**: Supports multiple databases. Tests use separate `test` database.

## Running Tests

### All Tests
```bash
bun test
```

### Individual Test Suites
```bash
# Entity deduplication
bun test tests/dedup.test.ts
# OR
bun run test:dedup

# Relationship extraction
bun test tests/relationships.test.ts
# OR
bun run test:relationships

# Hybrid search
bun test tests/hybrid-search.test.ts
# OR
bun run test:hybrid
```

### Watch Mode
```bash
bun test --watch
# OR
bun run test:watch
```

## Test Structure

```
tests/
├── helpers.ts              # Test utilities
├── dedup.test.ts          # Entity deduplication tests
├── relationships.test.ts  # Relationship extraction tests
├── hybrid-search.test.ts  # Hybrid search tests
└── README.md              # This file
```

Each test suite:
- Sets up test database automatically
- Runs isolated tests
- Cleans up after completion

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

## What Tests Cover

### dedup.test.ts
- Entity name normalization (Sarah/sarah/SARAH → single entity)
- Original casing preservation for display
- Memory listing functionality
- Export to JSON with original text

### relationships.test.ts
- WORKS_AT relationship extraction
- KNOWS relationship extraction
- LIVES_IN relationship extraction
- Multiple entities in single memory
- Relationship counting and verification

### hybrid-search.test.ts
- Vector-only search baseline
- Hybrid search with graph expansion
- Difference between vector and hybrid results
- Person-to-activity connections via graph
- Semantic query handling

## Viewing Test Data

### Neo4j Browser
1. Open http://localhost:7474
2. Select database: `test` (dropdown in top-left, Enterprise only)
3. Run queries:
   ```cypher
   // All memories
   MATCH (m:Memory) RETURN m ORDER BY m.timestamp DESC

   // All entities
   MATCH (e:Entity) RETURN e

   // All relationships (excluding MENTIONS)
   MATCH (a)-[r]->(b)
   WHERE type(r) <> 'MENTIONS'
   RETURN a.name, type(r), b.name
   ```

### Programmatic Access
Tests expose `graph` client - you can add custom queries in test files.

## Cleaning Test Data

Tests automatically clean up after completion. To manually clean:

```bash
bash tests/teardown-test-db.sh
```

Or via Cypher:
```bash
docker exec brainfreeze-neo4j cypher-shell -u neo4j -p password -d test \
  "MATCH (n) DETACH DELETE n;"
```

## Troubleshooting

### "Neo4j is not running"
```bash
docker start brainfreeze-neo4j
# Wait a few seconds, then run tests
bun test
```

### "Could not create database"
- Using Neo4j Community Edition (single database only)
- Tests will warn but continue
- Consider Enterprise for full isolation

### Tests fail with API errors
- Check `.env.test` has valid API keys
- Verify keys work: `bun run memory "test"` (with .env.test loaded)

### Import errors in tests
- Ensure you're in project root
- Run `bun install` to ensure dependencies

## Legacy Bash Scripts

The `tests/` folder still contains bash scripts for backwards compatibility:
- `setup-test-db.sh` - Manual database setup
- `teardown-test-db.sh` - Manual cleanup
- `test-*.sh` - Original bash test scripts

These are no longer needed but kept for reference. Use `bun test` instead.
