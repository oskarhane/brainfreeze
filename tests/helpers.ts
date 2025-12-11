import { $ } from 'bun';
import { loadConfig } from '../src/core/config';
import { GraphClient } from '../src/graph/client';
import { OpenAIClient } from '../src/ai/openai';
import { MemorySystem } from '../src/core/memory-system';

// Load test environment
export async function loadTestEnv() {
  const envFile = Bun.file('.env.test');
  const content = await envFile.text();

  for (const line of content.split('\n')) {
    if (line.trim() && !line.startsWith('#')) {
      const [key, value] = line.split('=');
      if (key && value) {
        process.env[key.trim()] = value.trim();
      }
    }
  }
}

export async function createTestMemorySystem(): Promise<MemorySystem> {
  const config = loadConfig();
  const graph = new GraphClient(
    config.neo4j.uri,
    config.neo4j.user,
    config.neo4j.password,
    config.neo4j.database
  );
  const openai = new OpenAIClient(config.openai.apiKey, config.openai.model);

  const { createClaudeModel } = await import('../src/agents/providers');
  const claudeModel = createClaudeModel(config.anthropic.apiKey, config.anthropic.model);

  return new MemorySystem(graph, openai, claudeModel);
}

export async function setupTestDatabase() {
  console.log('Setting up test database...');

  // Check if Neo4j is running (docker maps 7475:7474)
  try {
    await fetch('http://localhost:7475');
  } catch (error) {
    throw new Error('Neo4j is not running at localhost:7475. Start with: docker compose up -d');
  }

  await loadTestEnv();
  const config = loadConfig();

  // Wait a moment for Neo4j to be fully ready
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Try to create test database (only works in Enterprise)
  try {
    await $`docker exec brainfreeze-neo4j cypher-shell -u neo4j -p password "CREATE DATABASE test IF NOT EXISTS;"`.quiet();
    console.log('✓ Using separate test database');
  } catch (error) {
    // Community Edition - use default database and warn
    console.warn('⚠️  Community Edition detected - using default "neo4j" database');
    console.warn('⚠️  Tests will modify your main database! Consider using Enterprise Edition.');
    process.env.NEO4J_DATABASE = 'neo4j'; // Override to use default
  }

  // Initialize schema
  const graph = new GraphClient(
    config.neo4j.uri,
    config.neo4j.user,
    config.neo4j.password,
    process.env.NEO4J_DATABASE || config.neo4j.database
  );

  await graph.initSchema();
  await graph.close();

  console.log(`✓ Test database ready: ${process.env.NEO4J_DATABASE || config.neo4j.database}`);
}

export async function cleanTestDatabase() {
  console.log('Cleaning test database...');

  const db = process.env.NEO4J_DATABASE || 'test';

  try {
    await $`docker exec brainfreeze-neo4j cypher-shell -u neo4j -p password -d ${db} "MATCH (n) DETACH DELETE n;"`.quiet();
    console.log('✓ Test database cleaned');
  } catch (error) {
    console.error('Failed to clean test database:', error);
    throw error;
  }
}

export async function waitForMemoryStorage(delayMs: number = 100) {
  // Small delay to ensure async storage completes
  await new Promise(resolve => setTimeout(resolve, delayMs));
}
