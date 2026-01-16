import { tool } from 'ai';
import { z } from 'zod';
import type { GraphClient } from '../../graph/client';

export function createSearchTools(graph: GraphClient) {
  return {
    vector_search: tool({
      description: 'Search memories using vector similarity (embedding-based search)',
      parameters: z.object({
        embedding: z.array(z.number()).describe('Query embedding vector'),
        limit: z.number().default(5).describe('Maximum number of results'),
      }),
      execute: async ({ embedding, limit }) => {
        const memories = await graph.searchByVector(embedding, limit);
        return memories.map((m) => ({
          id: m.id,
          content: m.content,
          summary: m.summary,
          type: m.type,
          timestamp: m.timestamp,
        }));
      },
    }),

    hybrid_search: tool({
      description: 'Search memories using hybrid approach (vector + graph expansion)',
      parameters: z.object({
        embedding: z.array(z.number()).describe('Query embedding vector'),
        limit: z.number().default(5).describe('Maximum number of results'),
      }),
      execute: async ({ embedding, limit }) => {
        const memories = await graph.hybridSearch(embedding, limit);
        return memories.map((m) => ({
          id: m.id,
          content: m.content,
          summary: m.summary,
          type: m.type,
          timestamp: m.timestamp,
        }));
      },
    }),

    get_entities: tool({
      description: 'Get all known entities (people, places, organizations, concepts)',
      parameters: z.object({}),
      execute: async () => {
        const entities = await graph.getAllEntities();
        return entities.map((e) => ({
          id: e.entity.id,
          name: e.entity.name,
          type: e.entity.type,
          aliases: e.entity.aliases,
          memoryCount: e.memoryCount,
        }));
      },
    }),

    get_entity_relationships: tool({
      description: 'Get relationships for a specific entity',
      parameters: z.object({
        entityId: z.string().describe('Entity ID'),
      }),
      execute: async ({ entityId }) => {
        // This would need a new GraphClient method, for now return empty
        // TODO: Implement getEntityRelationships in GraphClient
        return [];
      },
    }),
  };
}
