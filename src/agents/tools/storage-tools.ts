import { tool } from 'ai';
import { z } from 'zod';
import type { GraphClient } from '../../graph/client';
import type { OpenAIClient } from '../../ai/openai';
import type { ExtractedMemory, Memory } from '../../core/types';

export function createStorageTools(graph: GraphClient, openai: OpenAIClient) {
  return {
    generate_embedding: tool({
      description: 'Generate embedding vector for text',
      parameters: z.object({
        text: z.string().describe('Text to embed'),
      }),
      execute: async ({ text }) => {
        const embedding = await openai.generateEmbedding(text);
        return { embedding };
      },
    }),

    store_memory: tool({
      description: 'Store a memory with entities and relationships',
      parameters: z.object({
        content: z.string().describe('Original memory text'),
        extracted: z.any().describe('Extracted memory data'),
        embedding: z.array(z.number()).describe('Embedding vector'),
        entityResolutions: z
          .record(z.string())
          .optional()
          .describe('Entity name -> resolved ID map'),
      }),
      execute: async ({ content, extracted, embedding, entityResolutions }) => {
        const memory: Memory = {
          id: crypto.randomUUID(),
          content,
          summary: extracted.summary,
          type: extracted.type,
          timestamp: new Date(),
          embedding,
          metadata: extracted.metadata,
        };

        // Apply entity resolutions
        const resolvedEntities = extracted.entities.map((e: any) => {
          const resolvedId = entityResolutions?.[e.name];
          return resolvedId ? { ...e, resolvedId } : e;
        });

        await graph.storeMemory(
          memory,
          resolvedEntities,
          extracted.relationships,
          entityResolutions ? new Map(Object.entries(entityResolutions)) : undefined,
        );

        return { memoryId: memory.id };
      },
    }),

    store_hypothetical_questions: tool({
      description: 'Store hypothetical questions for a memory',
      parameters: z.object({
        memoryId: z.string().describe('Memory ID'),
        questions: z.array(z.string()).describe('Hypothetical questions'),
      }),
      execute: async ({ memoryId, questions }) => {
        const questionsWithEmbeddings = await Promise.all(
          questions.map(async (question) => ({
            question,
            embedding: await openai.generateEmbedding(question),
          })),
        );
        await graph.storeHypotheticalQuestions(memoryId, questionsWithEmbeddings);
        return { success: true, count: questions.length };
      },
    }),
  };
}
