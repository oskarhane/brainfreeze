import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  setDefaultTimeout,
} from "bun:test";
import {
  loadTestEnv,
  createTestMemorySystem,
  setupTestDatabase,
  cleanTestDatabase,
} from "./helpers";

setDefaultTimeout(30000);

describe("Entity Property Updates and Version History", () => {
  let system: ReturnType<typeof createTestMemorySystem>;
  let graph: ReturnType<typeof createTestMemorySystem>["graph"];

  beforeAll(async () => {
    await loadTestEnv();
    await setupTestDatabase();
    system = createTestMemorySystem();
    graph = system.graph;
  });

  afterAll(async () => {
    await system.close();
    await cleanTestDatabase();
  });

  test("should create entity version snapshot when updating properties", async () => {
    // Create initial entity
    const memory1 = {
      id: crypto.randomUUID(),
      content: "John is a software engineer",
      summary: "John is a software engineer",
      type: "semantic" as const,
      timestamp: new Date(),
      embedding: new Array(1536).fill(0.1),
      metadata: {},
    };

    await graph.storeMemory(memory1, [{ name: "John", type: "person" }], []);

    // Find the entity
    const candidates = await graph.findSimilarEntities("John", "person");
    expect(candidates.length).toBeGreaterThan(0);
    const entity = candidates[0]?.entity;
    expect(entity).toBeDefined();
    if (!entity) throw new Error("Entity not found");

    // Update entity properties
    await graph.updateEntity(entity.id, {
      lastName: "Doe",
      email: "john@example.com",
    });

    // Get history
    const history = await graph.getEntityHistory(entity.id);

    // Verify current entity has updated properties
    expect(history.current.properties).toEqual({
      lastName: "Doe",
      email: "john@example.com",
    });
    expect(history.current.version).toBe(1);
    expect(history.current.updatedAt).toBeDefined();

    // Verify version snapshot was created
    expect(history.history.length).toBe(1);
    expect(history.history[0]?.version).toBe(0);
    expect(history.history[0]?.name).toBe("John");
    expect(history.history[0]?.properties).toEqual({});
  });

  test("should maintain version chain across multiple updates", async () => {
    // Create entity
    const memory = {
      id: crypto.randomUUID(),
      content: "Sarah is a designer",
      summary: "Sarah is a designer",
      type: "semantic" as const,
      timestamp: new Date(),
      embedding: new Array(1536).fill(0.1),
      metadata: {},
    };

    await graph.storeMemory(memory, [{ name: "Sarah", type: "person" }], []);

    const candidates = await graph.findSimilarEntities("Sarah", "person");
    const entity = candidates[0]?.entity;
    if (!entity) throw new Error("Entity not found");

    // First update
    await graph.updateEntity(entity.id, { lastName: "Smith" });

    // Second update
    await graph.updateEntity(entity.id, { email: "sarah@example.com" });

    // Third update
    await graph.updateEntity(entity.id, { phone: "555-1234" });

    // Get history
    const history = await graph.getEntityHistory(entity.id);

    // Current should have version 3 with all properties
    expect(history.current.version).toBe(3);
    expect(history.current.properties).toEqual({
      lastName: "Smith",
      email: "sarah@example.com",
      phone: "555-1234",
    });

    // History should have 3 versions
    expect(history.history.length).toBe(3);

    // Verify version chain
    expect(history.history[0]?.version).toBe(2);
    expect(history.history[0]?.properties).toEqual({
      lastName: "Smith",
      email: "sarah@example.com",
    });

    expect(history.history[1]?.version).toBe(1);
    expect(history.history[1]?.properties).toEqual({
      lastName: "Smith",
    });

    expect(history.history[2]?.version).toBe(0);
    expect(history.history[2]?.properties).toEqual({});
  });

  test("should merge properties (last-write-wins)", async () => {
    // Create entity
    const memory = {
      id: crypto.randomUUID(),
      content: "Bob is a manager",
      summary: "Bob is a manager",
      type: "semantic" as const,
      timestamp: new Date(),
      embedding: new Array(1536).fill(0.1),
      metadata: {},
    };

    await graph.storeMemory(memory, [{ name: "Bob", type: "person" }], []);

    const candidates = await graph.findSimilarEntities("Bob", "person");
    const entity = candidates[0]?.entity;
    if (!entity) throw new Error("Entity not found");

    // First update
    await graph.updateEntity(entity.id, {
      email: "bob@old.com",
      phone: "555-0000",
    });

    // Second update - overwrites email, keeps phone
    await graph.updateEntity(entity.id, { email: "bob@new.com", city: "NYC" });

    const history = await graph.getEntityHistory(entity.id);

    // Current should have merged properties with email overwritten
    expect(history.current.properties).toEqual({
      email: "bob@new.com",
      phone: "555-0000",
      city: "NYC",
    });
  });

  test("should respect history limit", async () => {
    // Create entity
    const memory = {
      id: crypto.randomUUID(),
      content: "Alice is an analyst",
      summary: "Alice is an analyst",
      type: "semantic" as const,
      timestamp: new Date(),
      embedding: new Array(1536).fill(0.1),
      metadata: {},
    };

    await graph.storeMemory(memory, [{ name: "Alice", type: "person" }], []);

    const candidates = await graph.findSimilarEntities("Alice", "person");
    const entity = candidates[0]?.entity;
    if (!entity) throw new Error("Entity not found");

    // Create 15 updates
    for (let i = 0; i < 15; i++) {
      await graph.updateEntity(entity.id, { [`field${i}`]: `value${i}` });
    }

    // Get history with limit 5
    const history = await graph.getEntityHistory(entity.id, 5);

    // Should only return 5 most recent versions
    expect(history.history.length).toBe(5);
    expect(history.current.version).toBe(15);
    expect(history.history[0]?.version).toBe(14);
    expect(history.history[4]?.version).toBe(10);
  });

  test("should throw error when updating non-existent entity", async () => {
    const fakeId = crypto.randomUUID();

    await expect(graph.updateEntity(fakeId, { test: "value" })).rejects.toThrow(
      "Entity",
    );
  });

  test("should throw error when getting history for non-existent entity", async () => {
    const fakeId = crypto.randomUUID();

    await expect(graph.getEntityHistory(fakeId)).rejects.toThrow("Entity");
  });

  test("should integrate property updates through remember()", async () => {
    // First create an entity
    await system.remember("Tom works at Google");

    // Now update properties through remember
    await system.remember(
      "Tom's last name is Wilson and his email is tom@wilson.com",
    );

    // Find the entity
    const candidates = await graph.findSimilarEntities("Tom", "person");
    expect(candidates.length).toBeGreaterThan(0);
    const entity = candidates[0]?.entity;
    if (!entity) throw new Error("Entity not found");

    // Get history
    const history = await graph.getEntityHistory(entity.id);

    // Should have properties from the extraction
    expect(history.current.properties?.lastName).toBeDefined();
    expect(history.current.properties?.email).toBeDefined();
    expect(history.current.version).toBeGreaterThan(0);
  });

  test("should handle entity with no version history", async () => {
    // Create entity without any updates
    const memory = {
      id: crypto.randomUUID(),
      content: "Emma is a teacher",
      summary: "Emma is a teacher",
      type: "semantic" as const,
      timestamp: new Date(),
      embedding: new Array(1536).fill(0.1),
      metadata: {},
    };

    await graph.storeMemory(memory, [{ name: "Emma", type: "person" }], []);

    const candidates = await graph.findSimilarEntities("Emma", "person");
    const entity = candidates[0]?.entity;
    if (!entity) throw new Error("Entity not found");

    // Get history for entity with no updates
    const history = await graph.getEntityHistory(entity.id);

    expect(history.current.version).toBe(0);
    expect(history.current.properties).toEqual({});
    expect(history.history.length).toBe(0);
  });
});
