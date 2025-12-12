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
import { OpenAIClient } from "../src/ai/openai";
import { MemorySystem } from "../src/core/memory-system";
import { loadConfig } from "../src/core/config";
import { waitForMemoryStorage } from "./helpers";

// Generate unique suffix for this test run to avoid conflicts with existing data
const TEST_SUFFIX = `X${Date.now().toString().slice(-6)}`;

describe("Property Updates", () => {
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

  test("should update entity properties without creating separate entity for the value", async () => {
    // This tests the bug where "John's last name is Jackson" would create a separate "Jackson" entity
    // instead of updating John entity's lastName property

    const personName = `JohnPropTest${TEST_SUFFIX}`;

    // First create entity
    await system.remember(`${personName} works at Google`);
    await waitForMemoryStorage();

    // Then provide property update
    await system.remember(`${personName}'s last name is Jackson`);
    await waitForMemoryStorage();

    // Verify:
    // 1. John entity exists with property
    const entities = await graph.getAllEntities();
    const johnEntity = entities.find((e) =>
      e.entity.name.includes("JohnPropTest")
    );

    expect(johnEntity).toBeDefined();
    expect(johnEntity?.entity.properties).toBeDefined();
    expect(johnEntity?.entity.properties?.lastName).toBe("Jackson");

    // 2. No separate "Jackson" entity was created
    const jacksonEntity = entities.find((e) =>
      e.entity.normalizedName === "jackson" && e.entity.type === "person"
    );
    expect(jacksonEntity).toBeUndefined();
  });

  test("should handle multiple property updates on same entity", async () => {
    const person = `Sarah${TEST_SUFFIX}`;

    await system.remember(`Met ${person} today`);
    await waitForMemoryStorage();

    await system.remember(`${person}'s email is sarah@example.com`);
    await waitForMemoryStorage();

    await system.remember(`${person}'s phone is 555-1234`);
    await waitForMemoryStorage();

    const entities = await graph.getAllEntities();
    const sarahEntity = entities.find((e) =>
      e.entity.name.includes("Sarah")
    );

    expect(sarahEntity).toBeDefined();
    expect(sarahEntity?.entity.properties).toBeDefined();
    expect(sarahEntity?.entity.properties?.email).toBe("sarah@example.com");
    expect(sarahEntity?.entity.properties?.phone).toBe("555-1234");

    // Should not have created separate entities for email or phone
    const emailEntity = entities.find((e) =>
      e.entity.normalizedName.includes("sarah@example")
    );
    expect(emailEntity).toBeUndefined();
  });

  test("should update property on correct entity when multiple similar names exist", async () => {
    const john1 = `John ${TEST_SUFFIX}`;
    const john2 = `John Smith ${TEST_SUFFIX}`;

    await system.remember(`${john1} works at Google`);
    await system.remember(`${john2} works at Microsoft`);
    await waitForMemoryStorage();

    // This should update John (not John Smith) because of exact match
    await system.remember(`${john1}'s last name is Jackson`);
    await waitForMemoryStorage();

    const entities = await graph.getAllEntities();
    const john1Entity = entities.find((e) =>
      e.entity.name === john1
    );
    const john2Entity = entities.find((e) =>
      e.entity.name.includes("John Smith")
    );

    expect(john1Entity).toBeDefined();
    expect(john1Entity?.entity.properties?.lastName).toBe("Jackson");

    // John Smith should not have been updated
    expect(john2Entity?.entity.properties?.lastName).toBeUndefined();

    // Should not have created "Jackson" entity
    const jacksonEntity = entities.find((e) =>
      e.entity.normalizedName === "jackson" && e.entity.type === "person"
    );
    expect(jacksonEntity).toBeUndefined();
  });

  test("should handle full name property correctly", async () => {
    const person = `TestPerson${TEST_SUFFIX}`;

    await system.remember(`${person} is my colleague`);
    await waitForMemoryStorage();

    await system.remember(`${person}'s full name is Linda Marie Peterson`);
    await waitForMemoryStorage();

    const entities = await graph.getAllEntities();
    const personEntity = entities.find((e) =>
      e.entity.name.includes("TestPerson")
    );

    expect(personEntity).toBeDefined();
    expect(personEntity?.entity.properties?.fullName).toBe("Linda Marie Peterson");

    // Should have added fullName as alias
    expect(personEntity?.entity.aliases).toContain("Linda Marie Peterson");

    // Should not have created separate "Linda Marie Peterson" entity
    const lindaEntity = entities.find((e) =>
      e.entity.normalizedName.includes("linda") && e.entity.normalizedName.includes("peterson")
    );
    expect(lindaEntity).toBeUndefined();
  });

  test("should preserve camelCase for property names", async () => {
    const person = `David${TEST_SUFFIX}`;

    await system.remember(`${person} is my colleague`);
    await waitForMemoryStorage();

    await system.remember(`${person}'s full name is David Michael Johnson`);
    await waitForMemoryStorage();

    const entities = await graph.getAllEntities();
    const davidEntity = entities.find((e) =>
      e.entity.name.includes("David")
    );

    expect(davidEntity).toBeDefined();
    expect(davidEntity?.entity.properties).toBeDefined();

    // Should use camelCase (fullName, not full_name or FullName)
    expect(davidEntity?.entity.properties?.fullName).toBeDefined();
    expect(davidEntity?.entity.properties?.fullName).toContain("David Michael Johnson");
  });

  test("should add fullName as searchable alias", async () => {
    const person = `PersonAlias${TEST_SUFFIX}`;

    await system.remember(`${person} is my colleague`);
    await waitForMemoryStorage();

    await system.remember(`${person}'s full name is Alice Marie Johnson`);
    await waitForMemoryStorage();

    const entities = await graph.getAllEntities();
    const entity = entities.find((e) => e.entity.name.includes("PersonAlias"));

    expect(entity).toBeDefined();
    expect(entity?.entity.properties?.fullName).toBe("Alice Marie Johnson");
    expect(entity?.entity.aliases).toContain("Alice Marie Johnson");

    // Verify searchability by full name
    const results = await graph.findSimilarEntities("Alice Marie Johnson");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.entity.id).toBe(entity?.entity.id);
  });

  test("should not add duplicate aliases", async () => {
    const person = `DupAlias${TEST_SUFFIX}`;

    await system.remember(`${person} is my friend`);
    await waitForMemoryStorage();

    // Add fullName twice
    await system.remember(`${person}'s full name is Bob Wilson`);
    await waitForMemoryStorage();

    await system.remember(`${person}'s full name is Bob Wilson`);
    await waitForMemoryStorage();

    const entities = await graph.getAllEntities();
    const entity = entities.find((e) => e.entity.name.includes("DupAlias"));

    // Should only have one alias entry
    const bobAliases = entity?.entity.aliases?.filter((a) => a === "Bob Wilson");
    expect(bobAliases?.length).toBe(1);
  });

  test("should handle case-insensitive duplicate detection", async () => {
    const person = `CaseAlias${TEST_SUFFIX}`;

    await system.remember(`${person} is my contact`);
    await waitForMemoryStorage();

    await system.remember(`${person}'s full name is Charlie Brown`);
    await waitForMemoryStorage();

    const entities = await graph.getAllEntities();
    const entity = entities.find((e) => e.entity.name.includes("CaseAlias"));

    // Manually try to add same alias with different case
    if (entity) {
      await graph.addAlias(entity.entity.id, "charlie brown");
      await waitForMemoryStorage();

      const updated = await graph.getAllEntities();
      const updatedEntity = updated.find((e) => e.entity.id === entity.entity.id);

      // Should still have only one alias (original case)
      expect(updatedEntity?.entity.aliases?.length).toBe(1);
      expect(updatedEntity?.entity.aliases?.[0]).toBe("Charlie Brown");
    }
  });

  test("should not create aliases for non-fullName properties", async () => {
    const person = `NoAlias${TEST_SUFFIX}`;

    await system.remember(`${person} is my colleague`);
    await waitForMemoryStorage();

    await system.remember(`${person}'s email is test@example.com`);
    await waitForMemoryStorage();

    const entities = await graph.getAllEntities();
    const entity = entities.find((e) => e.entity.name.includes("NoAlias"));

    expect(entity?.entity.properties?.email).toBe("test@example.com");
    expect(entity?.entity.aliases).not.toContain("test@example.com");
  });
});
