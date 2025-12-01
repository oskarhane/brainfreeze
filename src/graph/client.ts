import neo4j from 'neo4j-driver';
import type { Memory, Entity } from '../core/types';

export class GraphClient {
  private driver: neo4j.Driver;

  constructor(uri: string, user: string, password: string) {
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
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

  async storeMemory(memory: Memory, entities: Array<{ name: string; type: string; context?: string }>): Promise<void> {
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

        // Create entities and relationships
        for (const entity of entities) {
          await tx.run(
            `MERGE (e:Entity {name: $name, type: $type})
             ON CREATE SET e.id = randomUUID(), e.firstSeen = datetime()
             ON MATCH SET e.lastSeen = datetime()
             WITH e
             MATCH (m:Memory {id: $memoryId})
             CREATE (m)-[:MENTIONS]->(e)`,
            {
              name: entity.name,
              type: entity.type,
              memoryId: memory.id,
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
        { embedding, limit }
      );

      return result.records.map((record) => {
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
        { limit }
      );

      return result.records.map((record) => {
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

      return result.records.map((record) => {
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

  async close(): Promise<void> {
    await this.driver.close();
  }
}
