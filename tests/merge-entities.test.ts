import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { GraphClient } from "../src/graph/client";
import { loadConfig } from "../src/core/config";

describe("Entity Merge", () => {
  let graph: GraphClient;
  const testDb = "test";

  beforeAll(async () => {
    const config = loadConfig();
    graph = new GraphClient(
      config.neo4j.uri,
      config.neo4j.user,
      config.neo4j.password,
      testDb,
    );

    // Clean database
    const session = graph["driver"].session({ database: testDb });
    try {
      await session.run("MATCH (n) DETACH DELETE n");
    } finally {
      await session.close();
    }

    await graph.initSchema();
  });

  afterAll(async () => {
    await graph.close();
  });

  test("merge entities moves memories and relationships", async () => {
    // Create two entities with memories
    const session = graph["driver"].session({ database: testDb });
    try {
      // Create John entity with memory
      await session.run(`
        CREATE (e1:Entity {
          id: 'john-id',
          name: 'John',
          normalizedName: 'john',
          type: 'person'
        })
        CREATE (m1:Memory {
          id: 'mem1',
          content: 'Met John yesterday',
          summary: 'Met John',
          type: 'episodic',
          timestamp: datetime(),
          embedding: []
        })
        CREATE (m1)-[:MENTIONS]->(e1)
      `);

      // Create John Doe entity with memory
      await session.run(`
        CREATE (e2:Entity {
          id: 'johndoe-id',
          name: 'John Doe',
          normalizedName: 'john doe',
          type: 'person'
        })
        CREATE (m2:Memory {
          id: 'mem2',
          content: 'John Doe called',
          summary: 'John Doe called',
          type: 'episodic',
          timestamp: datetime(),
          embedding: []
        })
        CREATE (m2)-[:MENTIONS]->(e2)
      `);

      // Create a relationship between them and another entity
      await session.run(`
        CREATE (e3:Entity {
          id: 'company-id',
          name: 'Acme Corp',
          normalizedName: 'acme corp',
          type: 'organization'
        })
        WITH e3
        MATCH (e2:Entity {id: 'johndoe-id'})
        CREATE (e2)-[:WORKS_AT]->(e3)
      `);

      // Verify initial state
      const beforeMerge = await session.run(`
        MATCH (e:Entity)
        RETURN count(e) as entityCount
      `);
      expect(beforeMerge.records[0].get("entityCount").toNumber()).toBe(3);

      const johnMemories = await session.run(`
        MATCH (m:Memory)-[:MENTIONS]->(e:Entity {id: 'john-id'})
        RETURN count(m) as count
      `);
      expect(johnMemories.records[0].get("count").toNumber()).toBe(1);

      const johnDoeMemories = await session.run(`
        MATCH (m:Memory)-[:MENTIONS]->(e:Entity {id: 'johndoe-id'})
        RETURN count(m) as count
      `);
      expect(johnDoeMemories.records[0].get("count").toNumber()).toBe(1);
    } finally {
      await session.close();
    }

    // Perform merge: keep John, remove John Doe
    await graph.mergeEntities("john-id", "johndoe-id");

    // Verify after merge
    const session2 = graph["driver"].session({ database: testDb });
    try {
      // Should only have 2 entities now (John and Acme Corp)
      const afterMerge = await session2.run(`
        MATCH (e:Entity)
        RETURN count(e) as entityCount
      `);
      expect(afterMerge.records[0].get("entityCount").toNumber()).toBe(2);

      // John should not exist anymore
      const johnDoeExists = await session2.run(`
        MATCH (e:Entity {id: 'johndoe-id'})
        RETURN count(e) as count
      `);
      expect(johnDoeExists.records[0].get("count").toNumber()).toBe(0);

      // John should have both memories now
      const johnAllMemories = await session2.run(`
        MATCH (m:Memory)-[:MENTIONS]->(e:Entity {id: 'john-id'})
        RETURN count(m) as count
      `);
      expect(johnAllMemories.records[0].get("count").toNumber()).toBe(2);

      // John should have the WORKS_AT relationship
      const johnRelationships = await session2.run(`
        MATCH (e:Entity {id: 'john-id'})-[r:WORKS_AT]->(company)
        RETURN count(r) as count, company.name as companyName
      `);
      expect(johnRelationships.records[0].get("count").toNumber()).toBe(1);
      expect(johnRelationships.records[0].get("companyName")).toBe("Acme Corp");

      // John should have "John Doe" as an alias
      const johnEntity = await session2.run(`
        MATCH (e:Entity {id: 'john-id'})
        RETURN e.aliases as aliases
      `);
      const aliases = johnEntity.records[0].get("aliases");
      expect(aliases).toContain("John Doe");
    } finally {
      await session2.close();
    }
  });
});
