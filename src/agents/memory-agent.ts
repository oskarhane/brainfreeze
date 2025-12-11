import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import type { LanguageModel } from 'ai';
import type { GraphClient } from '../graph/client';
import type { OpenAIClient } from '../ai/openai';
import type { ExtractedMemory, Memory, EntityDisambiguation } from '../core/types';
import { withRetry } from './utils/retry';
import { EXTRACTION_PROMPT, ENTITY_DISAMBIGUATION_PROMPT, RESOLVE_REFERENCES_PROMPT } from '../ai/prompts';

// Zod schema for extracted memory
const extractedMemorySchema = z.object({
  summary: z.string(),
  type: z.enum(['episodic', 'semantic', 'todo', 'reflection']),
  entities: z.array(
    z.object({
      name: z.string(),
      type: z.enum(['person', 'place', 'concept', 'organization']),
      context: z.string().optional(),
    }),
  ),
  relationships: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      type: z.enum([
        'KNOWS',
        'WORKS_AT',
        'LIVES_IN',
        'VISITED',
        'RELATED_TO',
        'PART_OF',
        'MENTIONED_WITH',
        'LIKES',
        'DISLIKES',
        'PREFERS',
      ]),
      context: z.string().optional(),
    }),
  ),
  propertyUpdates: z
    .array(
      z.object({
        entityName: z.string(),
        updates: z.record(z.string()),
      }),
    )
    .optional(),
  temporal: z.object({
    references: z.array(z.string()),
    timeOfDay: z.enum(['morning', 'afternoon', 'evening']).nullish(),
  }),
  metadata: z.object({
    location: z.string().optional(),
    activity: z.string().optional(),
    sentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
  }),
  hypotheticalQuestions: z.array(z.string()),
});

export class MemoryAgent {
  constructor(
    private model: LanguageModel<any>,
    private graph: GraphClient,
    private openai: OpenAIClient,
  ) {}

  async extract(text: string): Promise<ExtractedMemory> {
    return withRetry(async () => {
      const result = await generateObject({
        model: this.model,
        schema: extractedMemorySchema,
        prompt: EXTRACTION_PROMPT.replace('{TEXT}', text),
        temperature: 0.3,
      });

      return result.object as ExtractedMemory;
    });
  }

  async remember(text: string): Promise<string> {
    // 1. Extract entities & metadata
    const extracted = await this.extract(text);

    // 2. Generate embedding
    const embedding = await this.openai.generateEmbedding(text);

    // 3. Handle property updates
    if (extracted.propertyUpdates && extracted.propertyUpdates.length > 0) {
      for (const update of extracted.propertyUpdates) {
        const candidates = await this.graph.findSimilarEntities(update.entityName);

        if (candidates.length > 0 && candidates[0] && candidates[0].score === 1.0) {
          // Exact match - update entity
          await this.graph.updateEntity(candidates[0].entity.id, update.updates);
        } else if (candidates.length > 1) {
          // Ambiguous - log warning
          console.warn(`Ambiguous entity for property update: ${update.entityName}`);
        }
      }
    }

    // 4. Build memory object
    const memory: Memory = {
      id: crypto.randomUUID(),
      content: text,
      summary: extracted.summary,
      type: extracted.type,
      timestamp: new Date(),
      embedding,
      metadata: extracted.metadata,
      status: extracted.type === 'todo' ? 'open' : undefined,
    };

    // 5. Store in graph
    await this.graph.storeMemory(memory, extracted.entities, extracted.relationships);

    // 6. Store hypothetical questions with embeddings
    if (extracted.hypotheticalQuestions?.length > 0) {
      const questionsWithEmbeddings = await Promise.all(
        extracted.hypotheticalQuestions.map(async (question) => ({
          question,
          embedding: await this.openai.generateEmbedding(question),
        })),
      );
      await this.graph.storeHypotheticalQuestions(memory.id, questionsWithEmbeddings);
    }

    return memory.id;
  }

  async listTodos(): Promise<Memory[]> {
    const allMemories = await this.graph.getAllMemories();
    return allMemories.filter((m) => m.type === 'todo' && m.status !== 'done');
  }

  async markTodoDone(
    todoQuery: string,
    resolutionSummary: string,
  ): Promise<{ id: string; summary: string }> {
    // 1. Find matching todo(s)
    const embedding = await this.openai.generateEmbedding(todoQuery);
    const memories = await this.graph.searchByVector(embedding, 10);
    const todos = memories.filter((m) => m.type === 'todo' && m.status !== 'done');

    if (todos.length === 0) {
      throw new Error('No matching open todo found');
    }

    // 2. If multiple matches, disambiguate
    let selectedTodo = todos[0];
    if (todos.length > 1) {
      selectedTodo = await this.disambiguateTodo(todoQuery, todos);
    }

    // 3. Mark as done
    await this.graph.markTodoDone(selectedTodo!.id, resolutionSummary);

    return {
      id: selectedTodo!.id,
      summary: selectedTodo!.summary,
    };
  }

  private async disambiguateTodo(query: string, todos: Memory[]): Promise<Memory> {
    const todosText = todos
      .map((t, i) => `${i + 1}. ${t.summary}\n   Content: ${t.content}`)
      .join('\n');

    const prompt = `Which todo best matches this query?

Query: ${query}

Todos:
${todosText}

Return the number (1-${todos.length}) of the best matching todo.`;

    const result = await withRetry(async () => {
      const response = await generateObject({
        model: this.model,
        schema: z.object({ selectedIndex: z.number().min(1).max(todos.length) }),
        prompt,
        temperature: 0.2,
      });
      return response.object;
    });

    return todos[result.selectedIndex - 1]!;
  }

  async resolveReferences(text: string, conversationHistory: string): Promise<string> {
    const prompt = RESOLVE_REFERENCES_PROMPT.replace('{HISTORY}', conversationHistory).replace(
      '{TEXT}',
      text,
    );

    const result = await withRetry(async () => {
      return generateText({
        model: this.model,
        prompt,
        temperature: 0.3,
      });
    });

    return result.text.trim();
  }

  async prepareMemory(text: string): Promise<{
    extracted: ExtractedMemory;
    embedding: number[];
    disambiguations: EntityDisambiguation[];
  }> {
    // 1. Extract entities & metadata
    const extracted = await this.extract(text);

    // 2. Generate embedding
    const embedding = await this.openai.generateEmbedding(text);

    // 3. Check for entity conflicts
    const disambiguations: EntityDisambiguation[] = [];

    for (const entity of extracted.entities) {
      const candidates = await this.graph.findSimilarEntities(entity.name, entity.type);

      if (candidates.length === 0 || (candidates.length === 1 && candidates[0]?.score === 1.0)) {
        continue;
      }

      // If multiple candidates, try auto-resolve with Claude
      if (candidates.length > 1) {
        const result = await this.disambiguateEntity(
          entity.name,
          entity.type,
          text,
          candidates,
        );

        if (result.selectedIndex > 0 && result.confidence === 'high') {
          // Auto-resolved with high confidence
          disambiguations.push({
            extractedEntity: entity,
            candidates,
            autoResolved: {
              index: result.selectedIndex - 1,
              reasoning: result.reasoning,
            },
          });
        } else if (result.selectedIndex === -1 || result.confidence !== 'high') {
          // Need user input
          disambiguations.push({
            extractedEntity: entity,
            candidates,
          });
        }
        // selectedIndex === 0 means new entity, no disambiguation needed
      }
    }

    return { extracted, embedding, disambiguations };
  }

  private async disambiguateEntity(
    entityName: string,
    entityType: string,
    context: string,
    candidates: Array<{ entity: any; score: number }>,
  ): Promise<{ selectedIndex: number; confidence: string; reasoning: string }> {
    const candidatesText = candidates
      .map((c, i) => {
        const aliases = c.entity.aliases?.length ? ` (aliases: ${c.entity.aliases.join(', ')})` : '';
        return `${i + 1}. ${c.entity.name} (${c.entity.type})${aliases} - similarity: ${Math.round(c.score * 100)}%`;
      })
      .join('\n');

    const prompt = ENTITY_DISAMBIGUATION_PROMPT.replace('{ENTITY_NAME}', entityName)
      .replace('{ENTITY_TYPE}', entityType)
      .replace('{CONTEXT}', context)
      .replace('{CANDIDATES}', candidatesText);

    const result = await withRetry(async () => {
      const response = await generateObject({
        model: this.model,
        schema: z.object({
          selectedIndex: z.number(),
          confidence: z.enum(['high', 'medium', 'low']),
          reasoning: z.string(),
        }),
        prompt,
        temperature: 0.2,
      });
      return response.object;
    });

    return result;
  }

  async storeMemory(
    text: string,
    extracted: ExtractedMemory,
    embedding: number[],
    entityResolutions?: Map<string, string>,
  ): Promise<string> {
    // Build memory object
    const memory: Memory = {
      id: crypto.randomUUID(),
      content: text,
      summary: extracted.summary,
      type: extracted.type,
      timestamp: new Date(),
      embedding,
      metadata: extracted.metadata,
    };

    // Apply entity resolutions if provided
    const resolvedEntities = extracted.entities.map((e) => {
      const resolvedId = entityResolutions?.get(e.name);
      return resolvedId ? { ...e, resolvedId } : e;
    });

    // Store in graph - pass resolutions so relationships use correct entities
    await this.graph.storeMemory(
      memory,
      resolvedEntities,
      extracted.relationships,
      entityResolutions,
    );

    // Store hypothetical questions with embeddings
    if (extracted.hypotheticalQuestions?.length > 0) {
      const questionsWithEmbeddings = await Promise.all(
        extracted.hypotheticalQuestions.map(async (question) => ({
          question,
          embedding: await this.openai.generateEmbedding(question),
        })),
      );
      await this.graph.storeHypotheticalQuestions(memory.id, questionsWithEmbeddings);
    }

    return memory.id;
  }
}
