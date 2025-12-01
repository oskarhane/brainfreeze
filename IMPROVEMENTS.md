# Phase 1 Improvements

## Implemented

### 1. Entity Deduplication
- Entities normalized to lowercase for matching
- "Sarah", "sarah", "SARAH" → all merge into single entity node
- Original casing preserved for display
- New `normalizedName` property on Entity nodes
- New index: `entity_normalized_name`

**Files modified:**
- `src/graph/client.ts`: Added `normalizeEntityName()` method
- Schema updated: MERGE on `normalizedName` instead of `name`

### 2. Export/Import Memories
Export format (JSON):
```json
{
  "version": "1.0",
  "exportDate": "2025-12-01T...",
  "count": 10,
  "memories": [
    {
      "id": "uuid",
      "originalText": "raw input text",
      "summary": "extracted summary",
      "type": "episodic",
      "timestamp": "ISO date",
      "metadata": {...}
    }
  ]
}
```

**Use cases:**
- Backup memories before experimentation
- Test extraction improvements (re-extract with `--re-extract`)
- Share anonymized dataset
- Migrate between instances

**Commands:**
```bash
# Export all memories
bun run memory export backup.json

# Import memories (uses stored extraction)
bun run memory import backup.json

# Import and re-extract with current prompts
bun run memory import backup.json --re-extract
```

### 3. List Command
View recent memories chronologically:
```bash
bun run memory list           # Show last 10
bun run memory list -l 20     # Show last 20
```

## New CLI Commands Summary

```bash
# Store memory (unchanged)
bun run memory "text to remember"

# Search memories (unchanged)
bun run memory recall "query"

# NEW: List recent memories
bun run memory list [-l <limit>]

# NEW: Export to JSON
bun run memory export <file>

# NEW: Import from JSON
bun run memory import <file> [--re-extract]

# Initialize schema (unchanged)
bun run init
```

## Testing Entity Dedup

Run included test script:
```bash
./test-dedup.sh
```

Or manually:
```bash
bun run memory "Met Sarah at cafe"
bun run memory "sarah suggested a book"
bun run memory "Talked to SARAH yesterday"
```

Then check Neo4j browser (http://localhost:7474):
```cypher
MATCH (e:Entity {type: 'person'})
RETURN e.name, e.normalizedName, count{(e)<-[:MENTIONS]-()} as mentions
```

Should show single entity "sarah" with 3+ mentions.

## Benefits for Eval/Testing

1. **Export original text** → Can re-run extraction with different prompts
2. **Compare extractions** → Export before/after prompt changes
3. **Regression testing** → Keep golden dataset of test inputs
4. **Prompt iteration** → Import + `--re-extract` to test new prompts
5. **Entity consistency** → Dedup ensures same person/place tracked across variations

## Future Improvements

- [ ] Export entities separately with merge history
- [ ] Diff two exports to see extraction changes
- [ ] Import with conflict resolution (merge vs replace)
- [ ] Export filters (by date, type, entity)
- [ ] Batch import with progress tracking
