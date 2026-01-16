import { tool } from 'ai';
import { z } from 'zod';
import type { GraphClient } from '../../graph/client';
import type { OpenAIClient } from '../../ai/openai';

export function createTodoTools(graph: GraphClient, openai: OpenAIClient) {
  return {
    list_open_todos: tool({
      description: 'List all open/active todos (excludes done/completed)',
      parameters: z.object({}),
      execute: async () => {
        const allMemories = await graph.getAllMemories();
        const todos = allMemories.filter(
          (m) => m.type === 'todo' && m.status !== 'done',
        );
        return todos.map((t) => ({
          id: t.id,
          summary: t.summary,
          content: t.content,
          timestamp: t.timestamp,
        }));
      },
    }),

    search_todos: tool({
      description: 'Search for todos matching a query',
      parameters: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().default(10).describe('Maximum results'),
      }),
      execute: async ({ query, limit }) => {
        const embedding = await openai.generateEmbedding(query);
        const memories = await graph.searchByVector(embedding, limit);
        const todos = memories.filter(
          (m) => m.type === 'todo' && m.status !== 'done',
        );
        return todos.map((t) => ({
          id: t.id,
          summary: t.summary,
          content: t.content,
          timestamp: t.timestamp,
        }));
      },
    }),

    mark_todo_done: tool({
      description: 'Mark a todo as done/completed',
      parameters: z.object({
        todoId: z.string().describe('Todo memory ID'),
        resolutionSummary: z.string().describe('How it was resolved'),
      }),
      execute: async ({ todoId, resolutionSummary }) => {
        await graph.markTodoDone(todoId, resolutionSummary);
        return { success: true, id: todoId };
      },
    }),
  };
}
