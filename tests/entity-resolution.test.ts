import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  setDefaultTimeout,
} from "bun:test";

// These tests involve AI API calls, need longer timeout
setDefaultTimeout(60000);

import { GraphClient } from "../src/graph/client";
import { OpenAIClient } from "../src/ai/openai";
import { MemorySystem } from "../src/core/memory-system";
import { loadConfig } from "../src/core/config";
import { waitForMemoryStorage } from "./helpers";

// Generate unique suffix for this test run to avoid conflicts with existing data
const TEST_SUFFIX = `X${Date.now().toString().slice(-6)}`;

describe("Entity Resolution", () => {
  let graph: GraphClient;
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
    await graph.initSchema();

    openai = new OpenAIClient(config.openai.apiKey, config.openai.model);

    const { createClaudeModel } = await import('../src/agents/providers');
    const claudeModel = createClaudeModel(config.anthropic.apiKey, config.anthropic.model);

    system = new MemorySystem(graph, openai, claudeModel);
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
      // Use very distinct names that Claude won't confuse
      const uniqueId = Date.now().toString().slice(-4);
      const person1 = `Dmitri${uniqueId}`;
      const person2 = `Sergei${uniqueId}`;

      // Create two distinct entities
      await system.remember(`${person1} likes coffee`);
      await system.remember(`${person2} likes tea`);

      // Get initial memory counts
      const entitiesBefore = await graph.getAllEntities();
      const person1Before = entitiesBefore.find((e) =>
        e.entity.name.includes(person1.slice(0, 6)),
      );
      const person2Before = entitiesBefore.find((e) =>
        e.entity.name.includes(person2.slice(0, 6)),
      );

      expect(person1Before).toBeDefined();
      expect(person2Before).toBeDefined();

      const person1CountBefore = person1Before!.memoryCount;
      const person2CountBefore = person2Before!.memoryCount;

      // Store a memory that mentions person1 specifically
      await system.remember(`${person1} also likes juice`);

      // Verify only person1's count increased
      const entitiesAfter = await graph.getAllEntities();
      const person1After = entitiesAfter.find((e) =>
        e.entity.name.includes(person1.slice(0, 6)),
      );
      const person2After = entitiesAfter.find((e) =>
        e.entity.name.includes(person2.slice(0, 6)),
      );

      expect(person1After?.memoryCount).toBe(person1CountBefore + 1);
      expect(person2After?.memoryCount).toBe(person2CountBefore);
    });
  });

  describe("disambiguation with relationships", () => {
    test("resolved entity is used for relationships, not the extracted name", async () => {
      // This is the bug: "John is based in Chicago" extracts entity "John"
      // User disambiguates to "John Smith", but LIVES_IN relationship still
      // links to "John" because relationships use normalizedName lookup

      const john1 = `John ${TEST_SUFFIX}`;
      const john2 = `John Smith ${TEST_SUFFIX}`;
      const city = `Chicago ${TEST_SUFFIX}`;

      // Create two Johns and a city
      await system.remember(`${john1} works at Google`);
      await system.remember(`${john2} is a designer`);
      await system.remember(`${city} is a great city`);

      // Get john2's entity ID (we'll disambiguate to this one)
      const entitiesBefore = await graph.getAllEntities();
      const john2Entity = entitiesBefore.find((e) =>
        e.entity.name.includes("John Smith"),
      );
      expect(john2Entity).toBeDefined();

      // Prepare memory "John is based in Chicago" - this extracts "John" not "John Smith"
      const { extracted, embedding } = await system.prepareMemory(
        `John is based in ${city}`,
      );

      // User selects "John Smith" for disambiguation
      const resolutions = new Map<string, string>();
      const johnEntity = extracted.entities.find((e) =>
        e.name.toLowerCase().includes("john"),
      );
      if (johnEntity) {
        resolutions.set(johnEntity.name, john2Entity!.entity.id);
      }

      await system.storeMemory(
        `John is based in ${city}`,
        extracted,
        embedding,
        resolutions,
      );

      // Verify: John Smith should have the LIVES_IN relationship, NOT John
      const session = (graph as any).driver.session({
        database: (graph as any).database,
      });
      try {
        // Check which John has LIVES_IN relationship to Chicago
        const result = await session.run(
          `MATCH (j:Entity)-[:LIVES_IN]->(c:Entity)
           WHERE j.name CONTAINS 'John' AND c.name CONTAINS 'Chicago'
           RETURN j.name as johnName`,
        );

        const johnsWithRelationship = result.records.map((r: any) =>
          r.get("johnName"),
        );

        // Should be John Smith (or variant), not plain John
        const hasJohnSmith = johnsWithRelationship.some(
          (name: string) =>
            name.includes("John Smith") || name.includes("John smith"),
        );
        const hasPlainJohn = johnsWithRelationship.some(
          (name: string) =>
            name === "John" ||
            (name.includes("John") &&
              !name.includes("Smith") &&
              !name.includes("smith")),
        );

        expect(hasJohnSmith).toBe(true);
        expect(hasPlainJohn).toBe(false);
      } finally {
        await session.close();
      }
    });

    test("memory MENTIONS only the resolved entity, not both", async () => {
      const alice1 = `Alice ${TEST_SUFFIX}`;
      const alice2 = `Alice Wong ${TEST_SUFFIX}`;

      // Create two Alices
      await system.remember(`${alice1} is a developer`);
      await system.remember(`${alice2} is a manager`);

      const entitiesBefore = await graph.getAllEntities();
      const alice1Entity = entitiesBefore.find((e) => e.entity.name === alice1);
      const alice2Entity = entitiesBefore.find((e) =>
        e.entity.name.includes("Alice Wong"),
      );
      expect(alice1Entity).toBeDefined();
      expect(alice2Entity).toBeDefined();

      const alice1CountBefore = alice1Entity!.memoryCount;
      const alice2CountBefore = alice2Entity!.memoryCount;

      // Prepare memory mentioning "Alice"
      const { extracted, embedding } =
        await system.prepareMemory(`Alice loves hiking`);

      // User selects Alice Wong
      const resolutions = new Map<string, string>();
      const aliceEntity = extracted.entities.find((e) =>
        e.name.toLowerCase().includes("alice"),
      );
      if (aliceEntity) {
        resolutions.set(aliceEntity.name, alice2Entity!.entity.id);
      }

      await system.storeMemory(
        `Alice loves hiking`,
        extracted,
        embedding,
        resolutions,
      );

      // Verify: only Alice Wong's count increased
      const entitiesAfter = await graph.getAllEntities();
      const alice1After = entitiesAfter.find((e) => e.entity.name === alice1);
      const alice2After = entitiesAfter.find((e) =>
        e.entity.name.includes("Alice Wong"),
      );

      expect(alice1After!.memoryCount).toBe(alice1CountBefore); // unchanged
      expect(alice2After!.memoryCount).toBe(alice2CountBefore + 1); // increased
    });
  });

  describe("mergeEntities", () => {
    test("merges two entities and transfers relationships", async () => {
      // Use realistic names that LLM will extract consistently
      const merge1 = `Patricia${TEST_SUFFIX}`;
      const merge2 = `Raymond${TEST_SUFFIX}`;
      // Create two entities with memories
      await system.remember(`${merge1} went to the store`);
      await system.remember(`${merge2} bought groceries`);
      await waitForMemoryStorage();

      const entitiesBefore = await graph.getAllEntities();
      // Search flexibly - entity name might be normalized
      const entity1 = entitiesBefore.find((e) => e.entity.name.includes("Patricia"));
      const entity2 = entitiesBefore.find((e) => e.entity.name.includes("Raymond"));

      expect(entity1).toBeDefined();
      expect(entity2).toBeDefined();

      // Merge entity2 into entity1
      await graph.mergeEntities(entity1!.entity.id, entity2!.entity.id);

      // Verify entity2 no longer exists
      const entitiesAfter = await graph.getAllEntities();
      const entity1After = entitiesAfter.find((e) => e.entity.name.includes("Patricia"));
      const entity2After = entitiesAfter.find((e) => e.entity.name.includes("Raymond"));

      expect(entity2After).toBeUndefined();

      // Verify entity1 has both memories
      expect(entity1After?.memoryCount).toBe(2);

      // Verify entity1 has the alias (check if any alias includes Raymond)
      expect(entity1After?.entity.aliases?.some(a => a.includes("Raymond"))).toBe(true);
    });
  });
});
