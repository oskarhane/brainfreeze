import { GraphClient } from "../graph/client";
import { ClaudeClient } from "../ai/claude";
import { OpenAIClient } from "../ai/openai";
import type {
  Memory,
  Entity,
  ExtractedMemory,
  EntityDisambiguation,
} from "./types";
import type { ChatSession } from "./chat-session";

export class MemorySystem {
  constructor(
    private graph: GraphClient,
    private claude: ClaudeClient,
    private openai: OpenAIClient,
  ) {}

  async remember(text: string): Promise<string> {
    // 1. Extract entities & metadata via Claude
    const extracted = await this.claude.extract(text);

    // 2. Generate embedding via OpenAI
    const embedding = await this.openai.generateEmbedding(text);

    // 3. Build memory object
    const memory: Memory = {
      id: crypto.randomUUID(),
      content: text,
      summary: extracted.summary,
      type: extracted.type,
      timestamp: new Date(),
      embedding,
      metadata: extracted.metadata,
    };

    // 4. Store in graph
    await this.graph.storeMemory(
      memory,
      extracted.entities,
      extracted.relationships,
    );

    // 5. Store hypothetical questions with embeddings
    if (extracted.hypotheticalQuestions?.length > 0) {
      const questionsWithEmbeddings = await Promise.all(
        extracted.hypotheticalQuestions.map(async (question) => ({
          question,
          embedding: await this.openai.generateEmbedding(question),
        })),
      );
      await this.graph.storeHypotheticalQuestions(
        memory.id,
        questionsWithEmbeddings,
      );
    }

    return memory.id;
  }

  async recall(query: string, limit = 5, useHybrid = true): Promise<Memory[]> {
    // 1. Generate query embedding
    const embedding = await this.openai.generateEmbedding(query);

    // 2. Search (hybrid by default, or simple vector)
    if (useHybrid) {
      const results = await this.graph.hybridSearch(embedding, limit);
      return results.map((r) => ({ ...r, score: undefined }) as any as Memory); // Strip score for now
    } else {
      const memories = await this.graph.searchByVector(embedding, limit);
      return memories;
    }
  }

  async answer(
    question: string,
    limit = 5,
    vectorOnly = false,
    conversationHistory?: string,
  ): Promise<{ answer: string; sources: Memory[] }> {
    // 1. Recall relevant memories
    const memories = await this.recall(question, limit, !vectorOnly);

    // 2. Get relevant entities
    const entities = await this.graph.getAllEntities();

    // 3. Synthesize answer - use chat method if history provided
    const result = conversationHistory
      ? await this.claude.chatAnswer(
          question,
          memories,
          conversationHistory,
          entities,
        )
      : await this.claude.synthesizeAnswer(question, memories, entities);

    // 4. Filter to only memories that were actually used
    const usedMemories = result.usedMemoryIndices
      .map((idx) => memories[idx - 1])
      .filter((m) => m !== undefined);

    return {
      answer: result.answer,
      sources: usedMemories,
    };
  }

  async exportMemories(filePath: string): Promise<number> {
    const memories = await this.graph.getAllMemories();
    const data = {
      version: "2.0",
      exportDate: new Date().toISOString(),
      count: memories.length,
      memories: memories.map((m) => m.content),
    };

    await Bun.write(filePath, JSON.stringify(data, null, 2));
    return memories.length;
  }

  async importMemories(filePath: string): Promise<number> {
    const file = Bun.file(filePath);
    const data = await file.json();

    let imported = 0;
    const items = data.memories || [];
    for (const item of items) {
      // Content-only: always re-extract everything
      const content =
        typeof item === "string" ? item : item.originalText || item.content;
      if (content) {
        await this.remember(content);
        imported++;
      }
    }

    return imported;
  }

  async listRecent(limit = 10): Promise<Memory[]> {
    return this.graph.getRecentMemories(limit);
  }

  async prepareMemory(text: string): Promise<{
    extracted: ExtractedMemory;
    embedding: number[];
    disambiguations: EntityDisambiguation[];
  }> {
    // 1. Extract entities & metadata via Claude
    const extracted = await this.claude.extract(text);

    // 2. Generate embedding via OpenAI
    const embedding = await this.openai.generateEmbedding(text);

    // 3. Check each entity for disambiguation needs
    const disambiguations: EntityDisambiguation[] = [];

    for (const entity of extracted.entities) {
      const candidates = await this.graph.findSimilarEntities(
        entity.name,
        entity.type,
      );

      // If exact match (score 1.0), no disambiguation needed
      if (candidates.length === 1 && candidates[0]?.score === 1.0) {
        continue;
      }

      // If multiple candidates, try auto-resolve with Claude
      if (candidates.length > 1) {
        const result = await this.claude.disambiguateEntity(
          entity.name,
          entity.type,
          text,
          candidates,
        );

        if (result.selectedIndex > 0 && result.confidence === "high") {
          // Auto-resolved with high confidence
          disambiguations.push({
            extractedEntity: entity,
            candidates,
            autoResolved: {
              index: result.selectedIndex - 1,
              reasoning: result.reasoning,
            },
          });
        } else if (
          result.selectedIndex === -1 ||
          result.confidence !== "high"
        ) {
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

  async storeMemory(
    text: string,
    extracted: ExtractedMemory,
    embedding: number[],
    entityResolutions?: Map<string, string>, // entityName -> resolvedEntityId
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

    // Store in graph
    await this.graph.storeMemory(
      memory,
      resolvedEntities,
      extracted.relationships,
    );

    // Store hypothetical questions with embeddings
    if (extracted.hypotheticalQuestions?.length > 0) {
      const questionsWithEmbeddings = await Promise.all(
        extracted.hypotheticalQuestions.map(async (question) => ({
          question,
          embedding: await this.openai.generateEmbedding(question),
        })),
      );
      await this.graph.storeHypotheticalQuestions(
        memory.id,
        questionsWithEmbeddings,
      );
    }

    return memory.id;
  }

  async rememberWithContext(
    text: string,
    session: ChatSession,
  ): Promise<string> {
    // Resolve references using conversation history
    const history = session.getFormattedHistory();
    const expandedText = await this.claude.resolveReferences(text, history);

    // Store the expanded text (no disambiguation in simple mode)
    return this.remember(expandedText);
  }

  async prepareMemoryWithContext(
    text: string,
    session: ChatSession,
  ): Promise<{
    expandedText: string;
    extracted: ExtractedMemory;
    embedding: number[];
    disambiguations: EntityDisambiguation[];
  }> {
    // Resolve references using conversation history
    const history = session.getFormattedHistory();
    const expandedText = await this.claude.resolveReferences(text, history);

    // Prepare memory with disambiguation
    const { extracted, embedding, disambiguations } =
      await this.prepareMemory(expandedText);

    return { expandedText, extracted, embedding, disambiguations };
  }

  async chat(
    question: string,
    session: ChatSession,
    limit = 5,
    vectorOnly = false,
  ): Promise<{ answer: string; sources: Memory[] }> {
    // 1. Add user message to session
    session.addUserMessage(question);

    // 2. Get conversation history for context
    const history = session.getFormattedHistory();

    // 3. Use shared answer logic with conversation history
    const result = await this.answer(question, limit, vectorOnly, history);

    // 4. Add assistant response to session
    session.addAssistantMessage(result.answer, result.sources);

    return result;
  }

  async close(): Promise<void> {
    await this.graph.close();
  }
}
