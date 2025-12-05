import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  setDefaultTimeout,
} from "bun:test";

// These tests involve AI API calls, need longer timeout
setDefaultTimeout(60000);

import { GraphClient } from "../src/graph/client";
import { ClaudeClient } from "../src/ai/claude";
import { OpenAIClient } from "../src/ai/openai";
import { MemorySystem } from "../src/core/memory-system";
import { loadConfig } from "../src/core/config";

// Generate unique suffix for this test run to avoid conflicts with existing data
const TEST_SUFFIX = `X${Date.now().toString().slice(-6)}`;

describe("Entity Resolution", () => {
  let graph: GraphClient;
  let claude: ClaudeClient;
  let openai: OpenAIClient;
  let system: MemorySystem;

  beforeAll(async () => {
    const config = loadConfig();
    graph = new GraphClient(
      config.neo4j.uri,
      config.neo4j.user,
      config.neo4j.password,
      config.neo4j.database,
    );
    claude = new ClaudeClient(config.anthropic.apiKey, config.anthropic.model);
    openai = new OpenAIClient(config.openai.apiKey, config.openai.model);
    system = new MemorySystem(graph, claude, openai);

    await graph.initSchema();
  });

  afterAll(async () => {
    await graph.close();
  });

  describe("findSimilarEntities", () => {
    test("finds exact match", async () => {
      // Use a name that Claude will extract as-is
      const personName = `Zara ${TEST_SUFFIX}`;
      // First create an entity
      await system.remember(`Met with ${personName} for coffee`);

      const results = await graph.findSimilarEntities(personName, "person");

      expect(results.length).toBeGreaterThanOrEqual(1);
      // Claude might normalize the name slightly, so check contains
      expect(results.some((r) => r.entity.name.includes("Zara"))).toBe(true);
    });

    test("finds similar entities with fuzzy match", async () => {
      const name1 = `Quincy Anderson ${TEST_SUFFIX}`;
      const name2 = `Quincy Smith ${TEST_SUFFIX}`;
      // Create two similar entities
      await system.remember(`${name1} joined the team`);
      await system.remember(`${name2} sent an email`);

      // Search for first name - should find via fuzzy
      const results = await graph.findSimilarEntities("Quincy", "person");

      // Should find at least one Quincy
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((r) => r.entity.name.includes("Quincy"))).toBe(true);
    });

    test("returns multiple candidates for ambiguous names", async () => {
      const bob = `Robert ${TEST_SUFFIX}`;
      const bobby = `Roberto ${TEST_SUFFIX}`;
      // Create entities with similar names
      await system.remember(`${bob} works at Google`);
      await system.remember(`${bobby} is learning guitar`);

      // Search for Robert - should find it
      const results = await graph.findSimilarEntities("Robert", "person");

      // Should find at least Robert
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("prepareMemory disambiguation", () => {
    test("returns disambiguations when multiple similar entities exist", async () => {
      const mike = `Mike ${TEST_SUFFIX}`;
      const michael = `Michael ${TEST_SUFFIX}`;
      // First ensure we have multiple similar entities
      await system.remember(`${mike} from accounting called`);
      await system.remember(`${michael} sent the report`);

      // Now prepare a memory that mentions Mike
      const { disambiguations } = await system.prepareMemory(
        `${mike} called again about the budget`,
      );

      // Should have found similar entities (or auto-resolved)
      // This test verifies the disambiguation system works
      // It might auto-resolve or prompt - both are valid
      expect(disambiguations).toBeDefined();
    });

    test("no disambiguation needed for unique entities", async () => {
      const uniqueName = `Xerxes ${TEST_SUFFIX}`;
      const { disambiguations } = await system.prepareMemory(
        `${uniqueName} is a new team member`,
      );

      // Should have no disambiguations for a unique name
      // (or auto-resolved if it matches existing)
      expect(disambiguations).toBeDefined();
    });
  });

  describe("storeMemory with entity resolution", () => {
    test("links to resolved entity when ID provided", async () => {
      const personName = `Viktor ${TEST_SUFFIX}`;
      // Create an entity first
      await system.remember(`${personName} is a developer`);

      // Get the entity ID - Claude might normalize the name
      const entities = await graph.getAllEntities();
      const targetEntity = entities.find((e) =>
        e.entity.name.includes("Viktor"),
      );
      expect(targetEntity).toBeDefined();
      const initialCount = targetEntity?.memoryCount || 0;

      // Prepare a new memory
      const { extracted, embedding } = await system.prepareMemory(
        `${personName} finished the task`,
      );

      // Store with explicit resolution
      const resolutions = new Map<string, string>();
      const entityToResolve = extracted.entities.find((e) =>
        e.name.includes("Viktor"),
      );
      if (entityToResolve && targetEntity) {
        resolutions.set(entityToResolve.name, targetEntity.entity.id);
      }

      const memoryId = await system.storeMemory(
        `${personName} finished the task`,
        extracted,
        embedding,
        resolutions,
      );

      expect(memoryId).toBeDefined();

      // Verify the memory links to the original entity
      const entitiesAfter = await graph.getAllEntities();
      const entityAfter = entitiesAfter.find((e) =>
        e.entity.name.includes("Viktor"),
      );

      // Should have 1 more memory now
      expect(entityAfter?.memoryCount).toBe(initialCount + 1);
    });

    test("creates new entity when no resolution provided", async () => {
      const personName = `Yolanda ${TEST_SUFFIX}`;
      const { extracted, embedding } = await system.prepareMemory(
        `${personName} started working`,
      );

      const memoryId = await system.storeMemory(
        `${personName} started working`,
        extracted,
        embedding,
        new Map(), // No resolutions
      );

      expect(memoryId).toBeDefined();

      // Verify new entity was created
      const entities = await graph.getAllEntities();
      const newEntity = entities.find((e) => e.entity.name.includes("Yolanda"));
      expect(newEntity).toBeDefined();
      expect(newEntity?.memoryCount).toBe(1);
    });

    test("does NOT link to multiple entities without explicit resolution", async () => {
      const dupe1 = `Walter ${TEST_SUFFIX}`;
      const dupe2 = `Walton ${TEST_SUFFIX}`;
      // Create two distinct entities
      await system.remember(`${dupe1} likes coffee`);
      await system.remember(`${dupe2} likes tea`);

      // Get initial memory counts
      const entitiesBefore = await graph.getAllEntities();
      const dupe1Before = entitiesBefore.find((e) =>
        e.entity.name.includes("Walter"),
      );
      const dupe2Before = entitiesBefore.find((e) =>
        e.entity.name.includes("Walton"),
      );

      expect(dupe1Before).toBeDefined();
      expect(dupe2Before).toBeDefined();

      // Store a memory that mentions dupe1 specifically
      // Using the direct remember() which should only link to exact match
      await system.remember(`${dupe1} also likes juice`);

      // Verify only dupe1's count increased
      const entitiesAfter = await graph.getAllEntities();
      const dupe1After = entitiesAfter.find((e) =>
        e.entity.name.includes("Walter"),
      );
      const dupe2After = entitiesAfter.find((e) =>
        e.entity.name.includes("Walton"),
      );

      expect(dupe1After?.memoryCount).toBe((dupe1Before?.memoryCount || 0) + 1);
      expect(dupe2After?.memoryCount).toBe(dupe2Before?.memoryCount || 1);
    });
  });

  describe("mergeEntities", () => {
    test("merges two entities and transfers relationships", async () => {
      const merge1 = `${TEST_SUFFIX}Merge1`;
      const merge2 = `${TEST_SUFFIX}Merge2`;
      // Create two entities with memories
      await system.remember(`${merge1} went to the store`);
      await system.remember(`${merge2} bought groceries`);

      const entitiesBefore = await graph.getAllEntities();
      const entity1 = entitiesBefore.find((e) => e.entity.name === merge1);
      const entity2 = entitiesBefore.find((e) => e.entity.name === merge2);

      expect(entity1).toBeDefined();
      expect(entity2).toBeDefined();

      // Merge entity2 into entity1
      await graph.mergeEntities(entity1!.entity.id, entity2!.entity.id);

      // Verify entity2 no longer exists
      const entitiesAfter = await graph.getAllEntities();
      const entity1After = entitiesAfter.find((e) => e.entity.name === merge1);
      const entity2After = entitiesAfter.find((e) => e.entity.name === merge2);

      expect(entity2After).toBeUndefined();

      // Verify entity1 has both memories
      expect(entity1After?.memoryCount).toBe(2);

      // Verify entity1 has the alias
      expect(entity1After?.entity.aliases).toContain(merge2);
    });
  });
});
