import { tool } from 'ai';
import { z } from 'zod';
import type { GraphClient } from '../../graph/client';

export function createEntityTools(graph: GraphClient) {
  return {
    find_similar_entities: tool({
      description: 'Search for entities similar to a given name',
      parameters: z.object({
        name: z.string().describe('Entity name to search for'),
        type: z
          .string()
          .optional()
          .describe('Entity type: person, place, organization, concept'),
      }),
      execute: async ({ name, type }) => {
        const candidates = await graph.findSimilarEntities(name, type);
        return candidates.map((c) => ({
          id: c.entity.id,
          name: c.entity.name,
          type: c.entity.type,
          aliases: c.entity.aliases,
          score: c.score,
        }));
      },
    }),

    get_entity_details: tool({
      description: 'Get details about a specific entity',
      parameters: z.object({
        entityId: z.string().describe('Entity ID'),
      }),
      execute: async ({ entityId }) => {
        // Would need a getEntityById method on GraphClient
        // For now, find via getAllEntities
        const entities = await graph.getAllEntities();
        const entity = entities.find((e) => e.entity.id === entityId);
        if (!entity) {
          return null;
        }
        return {
          id: entity.entity.id,
          name: entity.entity.name,
          type: entity.entity.type,
          aliases: entity.entity.aliases,
          properties: entity.entity.properties,
          memoryCount: entity.memoryCount,
        };
      },
    }),

    update_entity_properties: tool({
      description: 'Update properties for an entity',
      parameters: z.object({
        entityId: z.string().describe('Entity ID'),
        updates: z.record(z.string()).describe('Property updates as key-value pairs'),
      }),
      execute: async ({ entityId, updates }) => {
        await graph.updateEntity(entityId, updates);
        return { success: true, entityId, updates };
      },
    }),
  };
}
