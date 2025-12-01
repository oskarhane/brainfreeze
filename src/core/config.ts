import type { Config } from './types';

export function loadConfig(): Config {
  const config: Config = {
    neo4j: {
      uri: process.env.NEO4J_URI || '',
      user: process.env.NEO4J_USER || '',
      password: process.env.NEO4J_PASSWORD || '',
      database: process.env.NEO4J_DATABASE || 'neo4j', // default to 'neo4j'
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      model: 'claude-sonnet-4-5-20250929',
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      model: 'text-embedding-3-small',
    },
  };

  // Validate required fields
  if (!config.neo4j.uri) {
    throw new Error('NEO4J_URI required in .env');
  }
  if (!config.neo4j.user) {
    throw new Error('NEO4J_USER required in .env');
  }
  if (!config.neo4j.password) {
    throw new Error('NEO4J_PASSWORD required in .env');
  }
  if (!config.anthropic.apiKey) {
    throw new Error('ANTHROPIC_API_KEY required in .env');
  }
  if (!config.openai.apiKey) {
    throw new Error('OPENAI_API_KEY required in .env');
  }

  return config;
}
