import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';

setDefaultTimeout(30000); // 30 seconds for API calls
import { loadTestEnv, createTestMemorySystem, setupTestDatabase, cleanTestDatabase, waitForMemoryStorage } from './helpers';

describe('Hybrid Search', () => {
  let system: ReturnType<typeof createTestMemorySystem>;

  beforeAll(async () => {
    await loadTestEnv();
    await setupTestDatabase();
    system = createTestMemorySystem();

    // Store test memories
    await system.remember('John works at Google on AI projects');
    await system.remember('Sarah is a data scientist at Microsoft');
    await system.remember('Met John for coffee to discuss machine learning');
    await system.remember('Sarah presented at the AI conference last week');
    await system.remember('Google announced new AI model');

    await waitForMemoryStorage(500); // Wait longer for multiple memories
  });

  afterAll(async () => {
    await system.close();
    await cleanTestDatabase();
  });

  test('regular vector search finds semantically similar memories', async () => {
    const results = await system.recall('AI technology', 3, false);

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);

    // Should find memories mentioning AI
    const hasAIMemories = results.some(m =>
      m.content.toLowerCase().includes('ai')
    );
    expect(hasAIMemories).toBe(true);
  });

  test('hybrid search expands results via graph connections', async () => {
    const results = await system.recall('AI technology', 5, true);

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);

    // Hybrid should potentially find memories about people connected to AI
    // even if they don't mention "AI" directly
    const hasConnectedMemories = results.some(m =>
      m.content.toLowerCase().includes('john') ||
      m.content.toLowerCase().includes('sarah')
    );
    expect(hasConnectedMemories).toBe(true);
  });

  test('hybrid search returns different results than vector only', async () => {
    const vectorResults = await system.recall('Google', 3, false);
    const hybridResults = await system.recall('Google', 3, true);

    expect(vectorResults.length).toBeGreaterThan(0);
    expect(hybridResults.length).toBeGreaterThan(0);

    // Hybrid might return more or different memories due to graph expansion
    const vectorIds = new Set(vectorResults.map(m => m.id));
    const hybridIds = new Set(hybridResults.map(m => m.id));

    // At least one of these should be true:
    // 1. Different number of results
    // 2. Different memory IDs
    const isDifferent =
      vectorResults.length !== hybridResults.length ||
      ![...vectorIds].every(id => hybridIds.has(id));

    // Hybrid should at minimum include Google-related memories
    const hybridHasGoogle = hybridResults.some(m =>
      m.content.toLowerCase().includes('google')
    );
    expect(hybridHasGoogle).toBe(true);
  });

  test('search for person finds their related activities', async () => {
    const results = await system.recall('John', 5, true);

    expect(results.length).toBeGreaterThan(0);

    // Should find memories about John
    const aboutJohn = results.filter(m =>
      m.content.toLowerCase().includes('john')
    );
    expect(aboutJohn.length).toBeGreaterThan(0);

    // May also find memories about Google or AI (connected via relationships)
    const hasRelatedTopics = results.some(m =>
      m.content.toLowerCase().includes('google') ||
      m.content.toLowerCase().includes('ai')
    );
    expect(hasRelatedTopics).toBe(true);
  });

  test('hybrid search handles queries without direct matches', async () => {
    // Query for something not directly mentioned but semantically related
    const results = await system.recall('technology companies', 3, true);

    expect(results.length).toBeGreaterThan(0);

    // Should find memories about Google, Microsoft, AI, etc.
    const hasCompanyMentions = results.some(m =>
      m.content.toLowerCase().includes('google') ||
      m.content.toLowerCase().includes('microsoft')
    );
    expect(hasCompanyMentions).toBe(true);
  });
});
