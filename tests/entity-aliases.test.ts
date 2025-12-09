import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { GraphClient } from "../src/graph/client";
import { loadConfig } from "../src/core/config";
import type { Memory } from "../src/core/types";

describe("Entity Aliases", () => {
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

  test("entity with alias should match when storing memory", async () => {
    // Manually create an entity with an alias
    const session = graph["driver"].session({ database: testDb });
    try {
      await session.run(`
        CREATE (e:Entity {
          id: 'user-id',
          name: 'User',
          normalizedName: 'user',
          type: 'person',
          aliases: ['Oskar', 'Oskar Hane']
        })
      `);
    } finally {
      await session.close();
    }

    // Store a memory that mentions "Oskar" (which is an alias)
    const memory: Memory = {
      id: "mem1",
      content: "Oskar had coffee",
      summary: "Oskar had coffee",
      type: "episodic",
      timestamp: new Date(),
      embedding: [],
      metadata: {},
    };

    const entities = [
      {
        name: "Oskar",
        type: "person",
      },
    ];

    await graph.storeMemory(memory, entities);

    // Verify that no new "Oskar" entity was created
    const session2 = graph["driver"].session({ database: testDb });
    try {
      const result = await session2.run(`
        MATCH (e:Entity)
        RETURN count(e) as entityCount
      `);
      expect(result.records[0].get("entityCount").toNumber()).toBe(1);

      // Verify the memory is linked to the User entity
      const memoryLink = await session2.run(`
        MATCH (m:Memory {id: 'mem1'})-[:MENTIONS]->(e:Entity)
        RETURN e.id as entityId, e.name as entityName
      `);
      expect(memoryLink.records[0].get("entityId")).toBe("user-id");
      expect(memoryLink.records[0].get("entityName")).toBe("User");
    } finally {
      await session2.close();
    }
  });

  test("normalized alias should match case-insensitively", async () => {
    // Clean database
    const cleanSession = graph["driver"].session({ database: testDb });
    try {
      await cleanSession.run("MATCH (n) DETACH DELETE n");
    } finally {
      await cleanSession.close();
    }

    // Create entity with mixed-case alias
    const session = graph["driver"].session({ database: testDb });
    try {
      await session.run(`
        CREATE (e:Entity {
          id: 'john-id',
          name: 'John Smith',
          normalizedName: 'john smith',
          type: 'person',
          aliases: ['Johnny', 'John']
        })
      `);
    } finally {
      await session.close();
    }

    // Store memory with lowercase version of alias
    const memory: Memory = {
      id: "mem2",
      content: "johnny called",
      summary: "johnny called",
      type: "episodic",
      timestamp: new Date(),
      embedding: [],
      metadata: {},
    };

    const entities = [
      {
        name: "johnny",
        type: "person",
      },
    ];

    await graph.storeMemory(memory, entities);

    // Verify it matched the existing entity
    const session2 = graph["driver"].session({ database: testDb });
    try {
      const result = await session2.run(`
        MATCH (e:Entity)
        RETURN count(e) as entityCount
      `);
      expect(result.records[0].get("entityCount").toNumber()).toBe(1);

      const memoryLink = await session2.run(`
        MATCH (m:Memory {id: 'mem2'})-[:MENTIONS]->(e:Entity)
        RETURN e.id as entityId, e.name as entityName
      `);
      expect(memoryLink.records[0].get("entityId")).toBe("john-id");
      expect(memoryLink.records[0].get("entityName")).toBe("John Smith");
    } finally {
      await session2.close();
    }
  });

  test("non-matching name should create new entity", async () => {
    // Clean database
    const cleanSession = graph["driver"].session({ database: testDb });
    try {
      await cleanSession.run("MATCH (n) DETACH DELETE n");
    } finally {
      await cleanSession.close();
    }

    // Create entity with aliases
    const session = graph["driver"].session({ database: testDb });
    try {
      await session.run(`
        CREATE (e:Entity {
          id: 'bob-id',
          name: 'Bob',
          normalizedName: 'bob',
          type: 'person',
          aliases: ['Bobby']
        })
      `);
    } finally {
      await session.close();
    }

    // Store memory with a different name
    const memory: Memory = {
      id: "mem3",
      content: "Alice arrived",
      summary: "Alice arrived",
      type: "episodic",
      timestamp: new Date(),
      embedding: [],
      metadata: {},
    };

    const entities = [
      {
        name: "Alice",
        type: "person",
      },
    ];

    await graph.storeMemory(memory, entities);

    // Verify a new entity was created
    const session2 = graph["driver"].session({ database: testDb });
    try {
      const result = await session2.run(`
        MATCH (e:Entity)
        RETURN count(e) as entityCount
      `);
      expect(result.records[0].get("entityCount").toNumber()).toBe(2);

      const aliceEntity = await session2.run(`
        MATCH (e:Entity {normalizedName: 'alice'})
        RETURN e.id as entityId, e.name as entityName
      `);
      expect(aliceEntity.records.length).toBe(1);
      expect(aliceEntity.records[0].get("entityName")).toBe("Alice");
    } finally {
      await session2.close();
    }
  });
});
