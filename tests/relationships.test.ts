import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';

setDefaultTimeout(30000); // 30 seconds for API calls
import { loadTestEnv, createTestMemorySystem, setupTestDatabase, cleanTestDatabase, waitForMemoryStorage } from './helpers';
import { loadConfig } from '../src/core/config';
import { GraphClient } from '../src/graph/client';

describe('Relationship Extraction', () => {
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
      config.neo4j.database
    );
  });

  afterAll(async () => {
    await system.close();
    await graph.close();
    await cleanTestDatabase();
  });

  test('should extract WORKS_AT relationships', async () => {
    await system.remember('John works at Google in San Francisco');
    await waitForMemoryStorage();

    const db = process.env.NEO4J_DATABASE || 'test';
    const session = graph['driver'].session({ database: db });
    try {
      const result = await session.run(`
        MATCH (p:Entity)-[r:WORKS_AT]->(o:Entity)
        WHERE p.normalizedName = 'john' AND o.normalizedName = 'google'
        RETURN p, r, o
      `);

      expect(result.records.length).toBeGreaterThan(0);

      const person = result.records[0]?.get('p');
      const org = result.records[0]?.get('o');

      expect(person.properties.type).toBe('person');
      expect(org.properties.type).toBe('organization');
    } finally {
      await session.close();
    }
  });

  test('should extract KNOWS relationships', async () => {
    await system.remember('Sarah lives in Brooklyn and knows John from college');
    await waitForMemoryStorage();

    const db = process.env.NEO4J_DATABASE || 'test';
    const session = graph['driver'].session({ database: db });
    try {
      const result = await session.run(`
        MATCH (p1:Entity)-[r:KNOWS]->(p2:Entity)
        WHERE p1.normalizedName = 'sarah' AND p2.normalizedName = 'john'
        RETURN p1, r, p2
      `);

      expect(result.records.length).toBeGreaterThan(0);

      const rel = result.records[0]?.get('r');
      expect(rel.type).toBe('KNOWS');
    } finally {
      await session.close();
    }
  });

  test('should extract LIVES_IN relationships', async () => {
    const db = process.env.NEO4J_DATABASE || 'test';
    const session = graph['driver'].session({ database: db });
    try {
      const result = await session.run(`
        MATCH (p:Entity)-[r:LIVES_IN]->(place:Entity)
        WHERE p.normalizedName = 'sarah' AND place.normalizedName = 'brooklyn'
        RETURN p, r, place
      `);

      expect(result.records.length).toBeGreaterThan(0);

      const person = result.records[0]?.get('p');
      const place = result.records[0]?.get('place');

      expect(person.properties.type).toBe('person');
      expect(place.properties.type).toBe('place');
    } finally {
      await session.close();
    }
  });

  test('should handle multiple entities in one memory', async () => {
    await system.remember('Met John and Sarah at Chipotle yesterday');
    await waitForMemoryStorage();

    const db = process.env.NEO4J_DATABASE || 'test';
    const session = graph['driver'].session({ database: db });
    try {
      // Check all entities mentioned
      const result = await session.run(`
        MATCH (m:Memory)-[:MENTIONS]->(e:Entity)
        WHERE m.content CONTAINS 'Chipotle'
        RETURN e.name as name, e.type as type
      `);

      expect(result.records.length).toBeGreaterThanOrEqual(3);

      const names = result.records.map(r => r.get('name').toLowerCase());
      expect(names).toContain('john');
      expect(names).toContain('sarah');
      expect(names).toContain('chipotle');
    } finally {
      await session.close();
    }
  });

  test('should count all non-MENTIONS relationships', async () => {
    const db = process.env.NEO4J_DATABASE || 'test';
    const session = graph['driver'].session({ database: db });
    try {
      const result = await session.run(`
        MATCH (a)-[r]->(b)
        WHERE type(r) <> 'MENTIONS'
        RETURN type(r) as relType, count(*) as count
      `);

      expect(result.records.length).toBeGreaterThan(0);

      const types = result.records.map(r => r.get('relType'));
      expect(types).toContain('WORKS_AT');
      expect(types).toContain('KNOWS');
      expect(types).toContain('LIVES_IN');
    } finally {
      await session.close();
    }
  });
});
