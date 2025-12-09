# BrainFreeze

Personal memory system using AI + graph database. Stores memories as a knowledge graph, extracts entities/relationships automatically, enables semantic + graph-based retrieval.

## Key Concepts

**Memory Types**
- `episodic` - events, experiences, conversations
- `semantic` - facts, knowledge
- `todo` - tasks, commitments
- `reflection` - thoughts, opinions

**Entities** - Named concepts (person, place, organization, concept) with:
- Properties (versioned - tracks history)
- Aliases (alternative names)
- Relationships to other entities

**Relationships** - KNOWS, WORKS_AT, LIVES_IN, VISITED, RELATED_TO, PART_OF, MENTIONED_WITH, LIKES, DISLIKES, PREFERS

**Hypothetical Questions** - Auto-generated questions that might retrieve a memory, stored with embeddings to improve recall.

## Lifecycle

### Storing a Memory

```
Input: "Had coffee with Sarah at Blue Bottle yesterday"
                    ↓
        Claude extracts:
        - entities: Sarah (person), Blue Bottle (place)
        - relationships: Sarah → VISITED → Blue Bottle
        - type: episodic
        - hypothetical questions
                    ↓
        OpenAI generates embeddings
                    ↓
        Neo4j stores:
        - Memory node (with embedding)
        - Entity nodes (normalized names)
        - Relationship edges
        - HypotheticalQuestion nodes
```

### Retrieving Memories

```
Query: "Where did I have coffee?"
                    ↓
        Embed query (OpenAI)
                    ↓
        Hybrid search:
        - Vector similarity on memories + hypothetical questions
        - Graph expansion through shared entities
                    ↓
        Claude synthesizes answer from relevant memories
```

### Entity Resolution

Ambiguous entities during storage prompt user selection or create new. `resolve` command finds similar entities and merges duplicates.

### Entity Versioning

Property updates create version snapshots linked in a chain, preserving history.

## Setup

```bash
bun install
cp .env.example .env  # configure NEO4J_*, ANTHROPIC_API_KEY, OPENAI_API_KEY
docker compose up -d
bun run memory init
```

## Usage

```bash
# store
bun run memory "Met John at the conference"

# recall (search)
bun run memory recall "conference"

# answer (synthesized)
bun run memory answer "Who did I meet recently?"

# interactive chat
bun run memory chat

# list recent
bun run memory list

# resolve duplicates
bun run memory resolve

# export/import
bun run memory export backup.json
bun run memory import backup.json
```

## MCP Server

For Claude integration:

```bash
bun run mcp
```

Tools: `remember`, `answer`, `get_entity_history`

## Architecture

```
CLI/MCP Interface
        ↓
    MemorySystem (orchestration)
        ↓
┌───────┼───────┐
│       │       │
Neo4j  Claude  OpenAI
(graph) (LLM)  (embeddings)
```

## Tech Stack

- Bun + TypeScript
- Neo4j (graph + vector indexes)
- Claude Sonnet 4.5 (extraction/synthesis)
- OpenAI text-embedding-3-small
- MCP protocol

## Testing

```bash
bun test
bun test --watch
```
