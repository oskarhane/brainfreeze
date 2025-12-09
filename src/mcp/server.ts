#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { loadConfig } from "../core/config";
import { MemorySystem } from "../core/memory-system";
import { GraphClient } from "../graph/client";
import { ClaudeClient } from "../ai/claude";
import { OpenAIClient } from "../ai/openai";

function createMemorySystem(): MemorySystem {
  const config = loadConfig();
  const graph = new GraphClient(
    config.neo4j.uri,
    config.neo4j.user,
    config.neo4j.password,
    config.neo4j.database,
  );
  const claude = new ClaudeClient(
    config.anthropic.apiKey,
    config.anthropic.model,
  );
  const openai = new OpenAIClient(config.openai.apiKey, config.openai.model);
  return new MemorySystem(graph, claude, openai);
}

const server = new McpServer({
  name: "brainfreeze",
  version: "0.1.0",
});

server.registerTool(
  "remember",
  {
    title: "Remember",
    description: "Store a memory/fact for later recall",
    inputSchema: {
      text: z.string().describe("The text to remember"),
    },
  },
  async ({ text }) => {
    const system = createMemorySystem();
    try {
      const id = await system.remember(text);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ id }),
          },
        ],
      };
    } finally {
      await system.close();
    }
  },
);

server.registerTool(
  "list_todos",
  {
    title: "List Open Todos",
    description: "List all open/active todos (excludes resolved/done todos)",
    inputSchema: {},
  },
  async () => {
    const system = createMemorySystem();
    try {
      const todos = await system.listTodos();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              count: todos.length,
              todos: todos.map((t) => ({
                id: t.id,
                summary: t.summary,
                content: t.content,
                timestamp: t.timestamp,
              })),
            }),
          },
        ],
      };
    } finally {
      await system.close();
    }
  },
);

server.registerTool(
  "answer",
  {
    title: "Answer",
    description:
      "Get a synthesized answer to a question based on stored memories (includes all memories, even resolved todos)",
    inputSchema: {
      question: z.string().describe("The question to answer"),
      limit: z
        .number()
        .optional()
        .default(5)
        .describe("Max memories to consider"),
      vectorOnly: z
        .boolean()
        .optional()
        .default(false)
        .describe("Use vector-only search (no graph expansion)"),
    },
  },
  async ({ question, limit, vectorOnly }) => {
    const system = createMemorySystem();
    try {
      const result = await system.answer(
        question,
        limit ?? 5,
        vectorOnly ?? false,
      );
      const response = {
        answer: result.answer,
        sources: result.sources.map((s) => ({
          summary: s.summary,
          content: s.content,
        })),
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response),
          },
        ],
      };
    } finally {
      await system.close();
    }
  },
);

server.registerTool(
  "get_entity_history",
  {
    title: "Get Entity History",
    description: "Get entity's current state and version history",
    inputSchema: {
      entityName: z.string().describe("Entity name to query"),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Max versions to return (default 10)"),
    },
  },
  async ({ entityName, limit }) => {
    const system = createMemorySystem();
    try {
      // Find entity
      const candidates = await system.graph.findSimilarEntities(entityName);

      if (candidates.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Entity not found",
                query: entityName,
              }),
            },
          ],
        };
      }

      if (!candidates[0]) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Entity not found",
                query: entityName,
              }),
            },
          ],
        };
      }

      const entity = candidates[0].entity;
      const history = await system.graph.getEntityHistory(
        entity.id,
        limit ?? 10,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              entity: history.current,
              history: history.history,
              matchScore: candidates[0].score,
            }),
          },
        ],
      };
    } finally {
      await system.close();
    }
  },
);

server.registerTool(
  "done",
  {
    title: "Mark Todo Done",
    description: "Mark a todo as done/resolved with summary",
    inputSchema: {
      todoQuery: z
        .string()
        .describe("Query to find the todo (e.g., 'call John')"),
      resolutionSummary: z.string().describe("Summary of how it was resolved"),
    },
  },
  async ({ todoQuery, resolutionSummary }) => {
    const system = createMemorySystem();
    try {
      const result = await system.markTodoDone(todoQuery, resolutionSummary);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              id: result.id,
              todo: result.summary,
              resolution: resolutionSummary,
            }),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: error.message,
            }),
          },
        ],
      };
    } finally {
      await system.close();
    }
  },
);

server.registerTool(
  "merge_entities",
  {
    title: "Merge Entities",
    description:
      "Merge two entities by search string. Returns candidates if multiple matches, requires keepId and removeId to confirm.",
    inputSchema: {
      keepSearch: z
        .string()
        .optional()
        .describe("Search string for entity to keep"),
      removeSearch: z
        .string()
        .optional()
        .describe("Search string for entity to remove"),
      keepId: z.string().optional().describe("Confirmed entity ID to keep"),
      removeId: z.string().optional().describe("Confirmed entity ID to remove"),
    },
  },
  async ({ keepSearch, removeSearch, keepId, removeId }) => {
    const system = createMemorySystem();
    try {
      // If IDs provided, do the merge
      if (keepId && removeId) {
        if (keepId === removeId) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: "Cannot merge entity with itself",
                }),
              },
            ],
          };
        }

        await system.graph.mergeEntities(keepId, removeId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: "Entities merged successfully",
              }),
            },
          ],
        };
      }

      // Otherwise, search and return candidates
      if (!keepSearch || !removeSearch) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error:
                  "Provide either (keepSearch + removeSearch) or (keepId + removeId)",
              }),
            },
          ],
        };
      }

      const keepCandidates = await system.graph.findSimilarEntities(keepSearch);
      const removeCandidates =
        await system.graph.findSimilarEntities(removeSearch);

      if (keepCandidates.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: `No entities found matching: "${keepSearch}"`,
              }),
            },
          ],
        };
      }

      if (removeCandidates.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: `No entities found matching: "${removeSearch}"`,
              }),
            },
          ],
        };
      }

      // If both have single matches, auto-merge
      if (keepCandidates.length === 1 && removeCandidates.length === 1) {
        const keep = keepCandidates[0];
        const remove = removeCandidates[0];

        if (!keep || !remove) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: "Entity lookup failed",
                }),
              },
            ],
          };
        }

        if (keep.entity.id === remove.entity.id) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: "Cannot merge entity with itself",
                }),
              },
            ],
          };
        }

        await system.graph.mergeEntities(keep.entity.id, remove.entity.id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                merged: {
                  keep: keep.entity.name,
                  removed: remove.entity.name,
                },
              }),
            },
          ],
        };
      }

      // Return candidates for user to select
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              requiresSelection: true,
              keepCandidates: keepCandidates.map((c) => ({
                id: c.entity.id,
                name: c.entity.name,
                type: c.entity.type,
                memoryCount: c.memoryCount,
              })),
              removeCandidates: removeCandidates.map((c) => ({
                id: c.entity.id,
                name: c.entity.name,
                type: c.entity.type,
                memoryCount: c.memoryCount,
              })),
              message:
                "Multiple matches found. Call again with keepId and removeId to confirm merge.",
            }),
          },
        ],
      };
    } finally {
      await system.close();
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
