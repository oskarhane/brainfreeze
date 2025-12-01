import { $ } from 'bun';
import { loadConfig } from '../src/core/config';
import { GraphClient } from '../src/graph/client';
import { ClaudeClient } from '../src/ai/claude';
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

export function createTestMemorySystem(): MemorySystem {
  const config = loadConfig();
  const graph = new GraphClient(
    config.neo4j.uri,
    config.neo4j.user,
    config.neo4j.password,
    config.neo4j.database
  );
  const claude = new ClaudeClient(config.anthropic.apiKey, config.anthropic.model);
  const openai = new OpenAIClient(config.openai.apiKey, config.openai.model);

  return new MemorySystem(graph, claude, openai);
}

export async function setupTestDatabase() {
  console.log('Setting up test database...');

  // Check if Neo4j is running
  try {
    await fetch('http://localhost:7474');
  } catch (error) {
    throw new Error('Neo4j is not running at localhost:7474. Start with: docker start brainfreeze-neo4j');
  }

  // Create test database (will warn if Community Edition)
  try {
    await $`docker exec brainfreeze-neo4j cypher-shell -u neo4j -p password "CREATE DATABASE test IF NOT EXISTS;"`.quiet();
  } catch (error) {
    console.warn('⚠️  Could not create database (may already exist or Community Edition)');
  }

  // Initialize schema
  await loadTestEnv();
  const config = loadConfig();
  const graph = new GraphClient(
    config.neo4j.uri,
    config.neo4j.user,
    config.neo4j.password,
    config.neo4j.database
  );

  await graph.initSchema();
  await graph.close();

  console.log(`✓ Test database ready: ${config.neo4j.database}`);
}

export async function cleanTestDatabase() {
  console.log('Cleaning test database...');

  try {
    await $`docker exec brainfreeze-neo4j cypher-shell -u neo4j -p password -d test "MATCH (n) DETACH DELETE n;"`.quiet();
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
