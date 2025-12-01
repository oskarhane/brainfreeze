import neo4j from 'neo4j-driver';
import type { Memory, Entity, Relationship } from '../core/types';

export class GraphClient {
  private driver: neo4j.Driver;

  constructor(uri: string, user: string, password: string) {
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }

  private normalizeEntityName(name: string): string {
    return name.toLowerCase().trim();
  }

  async initSchema(): Promise<void> {
    const session = this.driver.session();
    try {
      // Create constraints and indexes
      await session.run(`
        CREATE CONSTRAINT memory_id IF NOT EXISTS
        FOR (m:Memory) REQUIRE m.id IS UNIQUE
      `);

      await session.run(`
        CREATE CONSTRAINT entity_id IF NOT EXISTS
        FOR (e:Entity) REQUIRE e.id IS UNIQUE
      `);

      await session.run(`
        CREATE INDEX memory_timestamp IF NOT EXISTS
        FOR (m:Memory) ON (m.timestamp)
      `);

      await session.run(`
        CREATE INDEX entity_name IF NOT EXISTS
        FOR (e:Entity) ON (e.name)
      `);

      await session.run(`
        CREATE INDEX entity_normalized_name IF NOT EXISTS
        FOR (e:Entity) ON (e.normalizedName)
      `);

      // Create vector index
      try {
        await session.run(`
          CREATE VECTOR INDEX memory_embedding IF NOT EXISTS
          FOR (m:Memory) ON (m.embedding)
          OPTIONS {
            indexConfig: {
              \`vector.dimensions\`: 1536,
              \`vector.similarity_function\`: 'cosine'
            }
          }
        `);
      } catch (error: any) {
        // Vector index might already exist or not supported
        if (!error.message.includes('already exists')) {
          console.warn('Warning: Vector index creation skipped:', error.message);
        }
      }
    } finally {
      await session.close();
    }
  }

  async storeMemory(
    memory: Memory,
    entities: Array<{ name: string; type: string; context?: string }>,
    relationships: Relationship[] = []
  ): Promise<void> {
    const session = this.driver.session();
    try {
      await session.executeWrite(async (tx) => {
        // Create memory node
        await tx.run(
          `CREATE (m:Memory {
            id: $id,
            content: $content,
            summary: $summary,
            type: $type,
            timestamp: datetime($timestamp),
            embedding: $embedding
          })`,
          {
            id: memory.id,
            content: memory.content,
            summary: memory.summary,
            type: memory.type,
            timestamp: memory.timestamp.toISOString(),
            embedding: memory.embedding,
          }
        );

        // Create entities and memory-entity relationships
        for (const entity of entities) {
          const normalizedName = this.normalizeEntityName(entity.name);
          await tx.run(
            `MERGE (e:Entity {normalizedName: $normalizedName, type: $type})
             ON CREATE SET e.id = randomUUID(), e.name = $name, e.firstSeen = datetime()
             ON MATCH SET e.name = $name, e.lastSeen = datetime()
             WITH e
             MATCH (m:Memory {id: $memoryId})
             CREATE (m)-[:MENTIONS]->(e)`,
            {
              normalizedName,
              name: entity.name,
              type: entity.type,
              memoryId: memory.id,
            }
          );
        }

        // Create entity-entity relationships
        for (const rel of relationships) {
          const fromNormalized = this.normalizeEntityName(rel.from);
          const toNormalized = this.normalizeEntityName(rel.to);

          await tx.run(
            `MATCH (from:Entity {normalizedName: $fromNormalized})
             MATCH (to:Entity {normalizedName: $toNormalized})
             MERGE (from)-[r:\`${rel.type}\`]->(to)
             ON CREATE SET r.firstSeen = datetime(), r.context = $context
             ON MATCH SET r.lastSeen = datetime()`,
            {
              fromNormalized,
              toNormalized,
              context: rel.context || '',
            }
          );
        }
      });
    } finally {
      await session.close();
    }
  }

  async searchByVector(embedding: number[], limit: number): Promise<Memory[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `CALL db.index.vector.queryNodes('memory_embedding', $limit, $embedding)
         YIELD node, score
         RETURN node, score
         ORDER BY score DESC`,
        { embedding, limit: neo4j.int(limit) }
      );

      return result.records.map((record: any) => {
        const node = record.get('node');
        return this.nodeToMemory(node);
      });
    } catch (error: any) {
      // Fallback to text search if vector index not available
      if (error.message.includes('no such index')) {
        console.warn('Vector index not found, using recent memories');
        return this.getRecentMemories(limit);
      }
      throw error;
    } finally {
      await session.close();
    }
  }

  async getRecentMemories(limit: number): Promise<Memory[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (m:Memory)
         RETURN m
         ORDER BY m.timestamp DESC
         LIMIT $limit`,
        { limit: neo4j.int(limit) }
      );

      return result.records.map((record: any) => {
        const node = record.get('m');
        return this.nodeToMemory(node);
      });
    } finally {
      await session.close();
    }
  }

  async getEntitiesForMemories(memoryIds: string[]): Promise<Entity[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (m:Memory)-[:MENTIONS]->(e:Entity)
         WHERE m.id IN $memoryIds
         RETURN DISTINCT e`,
        { memoryIds }
      );

      return result.records.map((record: any) => {
        const node = record.get('e');
        return {
          id: node.properties.id,
          name: node.properties.name,
          type: node.properties.type,
        };
      });
    } finally {
      await session.close();
    }
  }

  private nodeToMemory(node: any): Memory {
    const props = node.properties;
    return {
      id: props.id,
      content: props.content,
      summary: props.summary,
      type: props.type,
      timestamp: new Date(props.timestamp),
      embedding: props.embedding || [],
      metadata: {
        location: props.location,
        activity: props.activity,
        sentiment: props.sentiment,
        timeOfDay: props.timeOfDay,
      },
    };
  }

  async getAllMemories(): Promise<Memory[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (m:Memory)
         RETURN m
         ORDER BY m.timestamp ASC`
      );

      return result.records.map((record: any) => {
        const node = record.get('m');
        return this.nodeToMemory(node);
      });
    } finally {
      await session.close();
    }
  }

  async hybridSearch(embedding: number[], limit: number): Promise<Array<Memory & { score: number }>> {
    const session = this.driver.session();
    try {
      // Step 1: Vector search for similar memories
      const vectorResults = await this.searchByVector(embedding, limit);

      // Step 2: For each memory, get connected entities and their other memories
      const expandedResults = new Map<string, { memory: Memory; score: number }>();

      for (let i = 0; i < vectorResults.length; i++) {
        const memory = vectorResults[i];
        const vectorScore = 1.0 - (i / vectorResults.length); // Higher rank = higher score

        // Add original memory
        expandedResults.set(memory.id, { memory, score: vectorScore });

        // Find related memories through entity connections
        const result = await session.run(
          `MATCH (m:Memory {id: $memoryId})-[:MENTIONS]->(e:Entity)
           MATCH (e)<-[:MENTIONS]-(related:Memory)
           WHERE related.id <> $memoryId
           RETURN DISTINCT related, count(e) as sharedEntities
           ORDER BY sharedEntities DESC
           LIMIT 5`,
          { memoryId: memory.id }
        );

        for (const record of result.records) {
          const relatedMemory = this.nodeToMemory(record.get('related'));
          const sharedCount = record.get('sharedEntities').toNumber();
          const graphScore = (sharedCount / 10) * 0.5; // Max 0.5 score from graph connections

          if (!expandedResults.has(relatedMemory.id)) {
            expandedResults.set(relatedMemory.id, {
              memory: relatedMemory,
              score: graphScore,
            });
          }
        }
      }

      // Step 3: Sort by combined score and return top results
      const scored = Array.from(expandedResults.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(item => ({ ...item.memory, score: item.score }));

      return scored;
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}
