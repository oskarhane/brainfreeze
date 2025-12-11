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
import { IntentAgent, type Intent } from "../agents/intent-agent";
import { RetrieveAgent } from "../agents/retrieve-agent";
import { MemoryAgent } from "../agents/memory-agent";
import type { LanguageModel } from "ai";

export class MemorySystem {
  private intentAgent: IntentAgent;
  private retrieveAgent: RetrieveAgent;
  private memoryAgent: MemoryAgent;

  constructor(
    public graph: GraphClient,
    private claude: ClaudeClient,
    private openai: OpenAIClient,
    private claudeModel: LanguageModel<any>,
  ) {
    this.intentAgent = new IntentAgent(claudeModel);
    this.retrieveAgent = new RetrieveAgent(claudeModel);
    this.memoryAgent = new MemoryAgent(claudeModel, graph, openai);
  }

  async remember(text: string): Promise<string> {
    return this.memoryAgent.remember(text);
  }

  // OLD IMPLEMENTATION - DEPRECATED
  async _remember_old(text: string): Promise<string> {
    // 1. Extract entities & metadata via Claude
    const extracted = await this.claude.extract(text);

    // 2. Generate embedding via OpenAI
    const embedding = await this.openai.generateEmbedding(text);

    // 3. Handle property updates
    if (extracted.propertyUpdates && extracted.propertyUpdates.length > 0) {
      for (const update of extracted.propertyUpdates) {
        const candidates = await this.graph.findSimilarEntities(
          update.entityName,
        );

        if (
          candidates.length > 0 &&
          candidates[0] &&
          candidates[0].score === 1.0
        ) {
          // Exact match - update entity
          await this.graph.updateEntity(
            candidates[0].entity.id,
            update.updates,
          );
        } else if (candidates.length > 1) {
          // Ambiguous - log warning
          console.warn(
            `Ambiguous entity for property update: ${update.entityName}`,
          );
        }
        // No match - entity will be created in storeMemory below
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
      status: extracted.type === "todo" ? "open" : undefined,
    };

    // 5. Store in graph
    await this.graph.storeMemory(
      memory,
      extracted.entities,
      extracted.relationships,
    );

    // 6. Store hypothetical questions with embeddings
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

  async listTodos(): Promise<Memory[]> {
    return this.memoryAgent.listTodos();
  }

  async markTodoDone(
    todoQuery: string,
    resolutionSummary: string,
  ): Promise<{ id: string; summary: string }> {
    return this.memoryAgent.markTodoDone(todoQuery, resolutionSummary);
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

    // 3. Synthesize answer using RetrieveAgent
    const result = await this.retrieveAgent.synthesizeAnswer(
      question,
      memories,
      entities,
      conversationHistory,
    );

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
    return this.memoryAgent.prepareMemory(text);
  }

  // OLD IMPLEMENTATION - DEPRECATED
  async _prepareMemory_old(text: string): Promise<{
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
    entityResolutions?: Map<string, string>,
  ): Promise<string> {
    return this.memoryAgent.storeMemory(text, extracted, embedding, entityResolutions);
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

  async detectIntent(
    text: string,
  ): Promise<
    | { type: "list_todos" }
    | { type: "mark_done"; query: string; summary: string }
    | { type: "normal" }
  > {
    const intent = await this.intentAgent.detectIntent(text);

    // Map new intent format to old format for backwards compatibility
    switch (intent.intent) {
      case 'todo_list':
        return { type: 'list_todos' };
      case 'todo_mark_done':
        return { type: 'mark_done', query: intent.query, summary: intent.summary };
      case 'remember':
      case 'retrieve':
      default:
        return { type: 'normal' };
    }
  }

  async close(): Promise<void> {
    await this.graph.close();
  }
}
