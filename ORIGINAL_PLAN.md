# Personal Memory Companion - Implementation Plan

## Technology Stack

-   **Runtime**: Bun.js
-   **Language**: TypeScript
-   **AI**: Vercel AI SDK + Anthropic Claude Sonnet 4.5
-   **Database**: Neo4j (Graph + Vector Index)
-   **Interface**: CLI

## Core Architecture

```
Input → Parse → Enrich → Store → Index → Retrieve
         ↓        ↓        ↓       ↓        ↓
      [Claude] [Claude] [Neo4j] [Vector] [Graph+Vector]
```

## Phase 1: Minimal Working Pipeline

### Goal: Text in → Graph out → Query back

#### 1.1 Basic Setup

```typescript
// Single entry point that works end-to-end
class MemorySystem {
    async remember(text: string): Promise<void>;
    async recall(query: string): Promise<Memory[]>;
}
```

#### 1.2 Neo4j Foundation

-   Simple schema: `(:Memory)`, `(:Entity)`, `[:MENTIONS]`
-   Basic vector index setup
-   Connection pooling and error handling

#### 1.3 Claude Integration

```typescript
// Single unified prompt that extracts everything at once
const MASTER_EXTRACTION_PROMPT = `
Extract from this text:
1. Core memory content
2. Entities (people, places, concepts)  
3. Memory type (episodic/semantic/todo)
4. Key metadata
Return as structured JSON...
`;
```

#### 1.4 Minimal CLI

```bash
memory "Just had lunch with Sarah at Chipotle, discussed the AI project"
memory recall "What did I discuss with Sarah?"
```

**Deliverable**: Working system that can store and retrieve memories with basic entity recognition

## Phase 2: Semantic Intelligence

### Goal: Understand meaning, not just keywords

#### 2.1 Embedding Pipeline

```typescript
class SemanticLayer {
    // Generate embeddings for memories
    async vectorize(text: string): Promise<number[]>;
    // Store in Neo4j vector index
    async indexVector(nodeId: string, vector: number[]): Promise<void>;
    // Hybrid search: graph + semantic
    async hybridSearch(query: string): Promise<Results>;
}
```

#### 2.2 Relationship Extraction

-   Second-pass Claude analysis for relationships
-   Inferred relationships from co-occurrence
-   Temporal relationships (before/after/during)
-   Causal relationships from language patterns

#### 2.3 Smart Retrieval

-   Combine Cypher queries with vector similarity
-   Implement relevance ranking
-   Context-aware result expansion

**Deliverable**: System that understands "what did we talk about regarding budgets" even if the word "budget" wasn't used

## Phase 3: Contextual Memory

### Goal: Every memory has rich, queryable context

#### 3.1 Context Extraction

```typescript
interface Context {
    temporal: { timestamp: Date; dayOfWeek: string; timeOfDay: string };
    spatial: { location?: string; locationType?: string };
    social: { people: string[]; relationships: Map<string, string> };
    activity: { action?: string; project?: string; domain?: string };
    emotional: { sentiment: number; mood?: string };
}
```

#### 3.2 Context Storage Strategy

-   Store context as node properties
-   Create context-specific indexes
-   Build context hierarchies (place → city → country)

#### 3.3 Pattern Detection

-   Identify recurring contexts
-   Detect routines and habits
-   Surface anomalies

**Deliverable**: Memories that know where, when, who, what, and why

## Phase 4: Intelligent Todos

### Goal: Todos that trigger at the right moment

#### 4.1 Todo Extraction

```typescript
class TodoExtractor {
    // Explicit: "I need to..." "Remember to..." "TODO:"
    extractExplicit(text: string): Todo[];

    // Implicit: "I'll send that tomorrow" → Todo
    extractImplicit(text: string): Todo[];

    // Commitments: "I'll get back to you on X"
    extractCommitments(text: string): Todo[];
}
```

#### 4.2 Smart Context Assignment

-   Parse natural language conditions ("next time I'm at the store")
-   Create compound triggers (person + location)
-   Infer optimal timing from patterns

#### 4.3 Todo Graph Structure

```cypher
(:Todo)-[:TRIGGERS_ON]->(:Context)
(:Todo)-[:RELATES_TO]->(:Memory)
(:Todo)-[:INVOLVES]->(:Person)
(:Todo)-[:PART_OF]->(:Project)
```

#### 4.4 Active Monitoring

-   Context matching engine
-   Priority calculation
-   Completion tracking

**Deliverable**: Todos that surface based on your current context

## Phase 5: Knowledge Graph Evolution

### Goal: Graph that grows smarter over time

#### 5.1 Entity Resolution

```typescript
class EntityResolver {
    // Merge "Sarah", "Sarah from work", "Sarah Chen" → same node
    mergeEntities(entities: Entity[]): Entity;

    // Evolve understanding: "the project" → specific project
    resolveReferences(text: string, context: Context): Entity[];

    // Build entity profiles over time
    enrichEntity(entity: Entity, newInfo: Map): Entity;
}
```

#### 5.2 Relationship Discovery

-   Infer relationships from interaction patterns
-   Discover hierarchies and groupings
-   Identify relationship changes over time

#### 5.3 Knowledge Synthesis

-   Connect disparate pieces of information
-   Build topic clusters
-   Create knowledge maps

**Deliverable**: Self-organizing knowledge structure

## Phase 6: Temporal Intelligence

### Goal: Understand how things change over time

#### 6.1 Timeline Construction

-   Event sequences and causality
-   Parallel timeline tracking
-   Duration and frequency analysis

#### 6.2 Temporal Queries

```typescript
// "What was I working on last month?"
// "How has my relationship with X evolved?"
// "What usually happens after Y?"
```

#### 6.3 Predictive Patterns

-   Identify cycles and routines
-   Predict likely next events
-   Surface breaking patterns

**Deliverable**: Memory system with temporal awareness

## Phase 7: Advanced Retrieval

### Goal: Natural, powerful query capabilities

#### 7.1 Query Understanding

```typescript
class QueryEngine {
    // Parse complex natural language
    async understand(query: string): ParsedQuery;

    // Generate optimal Cypher + vector search strategy
    async plan(parsed: ParsedQuery): QueryPlan;

    // Execute hybrid retrieval
    async execute(plan: QueryPlan): Results;

    // Generate natural language response
    async synthesize(results: Results): string;
}
```

#### 7.2 Query Types

-   Factual: "When did I last see John?"
-   Analytical: "How much time do I spend in meetings?"
-   Exploratory: "What connections exist between X and Y?"
-   Hypothetical: "What would happen if..."

#### 7.3 Conversational Memory

-   Multi-turn query sessions
-   Context preservation across queries
-   Clarification and refinement

**Deliverable**: ChatGPT-like interface to your memories

## Phase 8: Proactive Intelligence

### Goal: System that anticipates needs

#### 8.1 Insight Generation

-   Daily/weekly summaries
-   Trend identification
-   Anomaly detection
-   Relationship insights

#### 8.2 Proactive Surfacing

```typescript
class ProactiveAgent {
    // "You're about to meet John. Last time you discussed..."
    surfaceRelevantMemories(currentContext: Context): Memory[];

    // "You mentioned wanting to read about X. Here's what you know..."
    connectKnowledge(topic: string): KnowledgeGraph;

    // "This contradicts what you said on Tuesday"
    detectInconsistencies(): Contradiction[];
}
```

#### 8.3 Learning Optimization

-   Track what you forget vs remember
-   Identify knowledge gaps
-   Suggest review schedules

**Deliverable**: AI assistant that knows what you need before you ask

## Implementation Strategy

### Core Principles

1. **Iterative**: Each phase produces a working system
2. **Test-Driven**: Build test scenarios before implementation
3. **User-Driven**: Use the CLI yourself daily, iterate based on pain points
4. **Performance-Aware**: Monitor and optimize bottlenecks early
5. **Cost-Conscious**: Track AI API usage, implement caching

### Data Flow Architecture

```
Input Pipeline:
Text → Enrichment → Claude Analysis → Graph Construction → Vector Generation

Storage Layer:
Neo4j: Nodes (Memory, Entity, Context, Todo)
       Edges (Relationships, Triggers, Temporal Links)
       Indexes (Vector, Text, Temporal)

Retrieval Pipeline:
Query → Understanding → Hybrid Search → Ranking → Synthesis
```

### Key Design Decisions

#### Why Single Claude Call per Memory?

-   Reduces latency (one API call vs many)
-   Maintains context across extraction tasks
-   Cheaper than multiple calls
-   Can always add specialized calls later

#### Why Neo4j for Everything?

-   Single source of truth
-   Graph + Vector in one system
-   ACID compliance for consistency
-   Powerful Cypher query language
-   Scalable to millions of nodes

#### Why Embeddings + Graph?

-   Embeddings catch semantic similarity
-   Graph captures explicit relationships
-   Together they enable both precise and fuzzy search

### Project Structure

```
src/
├── core/
│   ├── memory-system.ts    # Main orchestrator
│   ├── types.ts            # Shared TypeScript types
│   └── config.ts           # Configuration
├── ai/
│   ├── claude.ts           # AI SDK wrapper
│   ├── prompts.ts          # Prompt templates
│   └── embeddings.ts       # Vector generation
├── graph/
│   ├── client.ts           # Neo4j connection
│   ├── schema.ts           # Graph schema
│   ├── queries.ts          # Cypher queries
│   └── vectors.ts          # Vector operations
├── pipeline/
│   ├── ingestion.ts        # Input processing
│   ├── enrichment.ts       # Context extraction
│   └── storage.ts          # Persistence layer
├── retrieval/
│   ├── search.ts           # Search strategies
│   ├── synthesis.ts        # Response generation
│   └── ranking.ts          # Result ranking
├── todos/
│   ├── extraction.ts       # Todo detection
│   ├── triggers.ts         # Context matching
│   └── manager.ts          # Todo lifecycle
├── intelligence/
│   ├── patterns.ts         # Pattern recognition
│   ├── insights.ts         # Insight generation
│   └── proactive.ts        # Proactive surfacing
└── cli/
    ├── index.ts            # CLI entry point
    ├── commands.ts         # Command handlers
    └── interactive.ts      # REPL mode
```

### Testing Strategy

Each phase should include:

1. **Unit tests**: Individual function behavior
2. **Integration tests**: Component interaction
3. **Scenario tests**: Real-world usage patterns
4. **Performance tests**: Latency and throughput
5. **Cost tests**: AI API usage tracking

### Performance Targets

-   Memory ingestion: <1s including AI processing
-   Simple recall: <200ms
-   Semantic search: <500ms
-   Complex graph traversal: <1s
-   Todo context matching: <100ms

### Scaling Considerations

1. **Batch Operations**: Process multiple memories together
2. **Caching Layer**: Redis for frequent queries
3. **Async Processing**: Queue for non-urgent enrichment
4. **Index Optimization**: Regular graph statistics update
5. **Embedding Optimization**: Dimension reduction if needed

## Next Steps

1. Set up Neo4j locally with vector index enabled
2. Create basic Bun project with TypeScript
3. Implement Phase 1 minimal pipeline
4. Start using it daily with real memories
5. Iterate based on actual usage patterns
