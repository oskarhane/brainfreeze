import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  setDefaultTimeout,
} from "bun:test";

setDefaultTimeout(30000); // 30 seconds for API calls
import {
  loadTestEnv,
  createTestMemorySystem,
  setupTestDatabase,
  cleanTestDatabase,
  waitForMemoryStorage,
} from "./helpers";
import { loadConfig } from "../src/core/config";
import { GraphClient } from "../src/graph/client";

describe("Entity Deduplication", () => {
  let system: ReturnType<typeof createTestMemorySystem>;
  let graph: GraphClient;

  beforeAll(async () => {
    await loadTestEnv();
    await setupTestDatabase();
    system = await createTestMemorySystem();

    const config = loadConfig();
    graph = new GraphClient(
      config.neo4j.uri,
      config.neo4j.user,
      config.neo4j.password,
      config.neo4j.database,
    );
  });

  afterAll(async () => {
    await system.close();
    await graph.close();
    await cleanTestDatabase();
  });

  test("should merge entities with different casing", async () => {
    // Store memories with same entity in different cases
    await system.remember("Met Sarah at the cafe");
    await system.remember("sarah suggested a new book");
    await system.remember("Had coffee with SARAH yesterday");

    await waitForMemoryStorage(200);

    // Query Neo4j to check entity count
    const db = process.env.NEO4J_DATABASE || "test";
    const session = graph["driver"].session({ database: db });
    try {
      const result = await session.run(`
        MATCH (e:Entity {type: 'person'})
        WHERE e.normalizedName = 'sarah'
        RETURN e, count{(e)<-[:MENTIONS]-()} as mentions
      `);

      expect(result.records.length).toBe(1);

      const entity = result.records[0]?.get("e");
      const mentions = result.records[0]?.get("mentions").toNumber();

      expect(entity.properties.normalizedName).toBe("sarah");
      expect(mentions).toBeGreaterThanOrEqual(3);
    } finally {
      await session.close();
    }
  });

  test("should preserve original casing in display name", async () => {
    const db = process.env.NEO4J_DATABASE || "test";
    const session = graph["driver"].session({ database: db });
    try {
      const result = await session.run(`
        MATCH (e:Entity {normalizedName: 'sarah'})
        RETURN e.name as displayName
      `);

      const displayName = result.records[0]?.get("displayName");
      // Should have one of the original casings
      expect(["Sarah", "sarah", "SARAH"]).toContain(displayName);
    } finally {
      await session.close();
    }
  });

  test("should list recent memories", async () => {
    const memories = await system.listRecent(5);

    expect(memories.length).toBeGreaterThan(0);
    expect(memories.length).toBeLessThanOrEqual(5);

    // Check memories have Sarah
    const hasSarah = memories.some((m) =>
      m.content.toLowerCase().includes("sarah"),
    );
    expect(hasSarah).toBe(true);
  });

  test("should export memories with original text", async () => {
    const exportPath = "tests/test-export.json";
    const count = await system.exportMemories(exportPath);

    expect(count).toBeGreaterThan(0);

    // Read and verify export
    const file = Bun.file(exportPath);
    const data = await file.json();

    expect(data.version).toBe("2.0");
    expect(data.count).toBe(count);
    expect(data.memories).toBeInstanceOf(Array);
    expect(data.memories.length).toBe(count);

    // Check memories are now just strings (content-only)
    const firstMemory = data.memories[0];
    expect(typeof firstMemory).toBe("string");
  });
});
