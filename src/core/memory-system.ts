import { GraphClient } from "../graph/client";
import { ClaudeClient } from "../ai/claude";
import { OpenAIClient } from "../ai/openai";
import type { Memory } from "./types";
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
  ): Promise<{ answer: string; sources: Memory[] }> {
    // 1. Recall relevant memories
    const memories = await this.recall(question, limit, !vectorOnly);

    // 2. Synthesize answer using Claude
    const result = await this.claude.synthesizeAnswer(question, memories);

    // 3. Filter to only memories that were actually used
    const usedMemories = result.usedMemoryIndices
      .map((idx) => memories[idx - 1]) // Convert 1-based to 0-based index
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

  async rememberWithContext(
    text: string,
    session: ChatSession,
  ): Promise<string> {
    // Resolve references using conversation history
    const history = session.getFormattedHistory();
    const expandedText = await this.claude.resolveReferences(text, history);

    // Store the expanded text
    return this.remember(expandedText);
  }

  async chat(
    question: string,
    session: ChatSession,
    limit = 5,
    vectorOnly = false,
  ): Promise<{ answer: string; sources: Memory[] }> {
    // 1. Add user message to session
    session.addUserMessage(question);

    // 2. Recall relevant memories
    const memories = await this.recall(question, limit, !vectorOnly);

    // 3. Get conversation history for context
    const history = session.getFormattedHistory();

    // 4. Get answer using chat method with conversation context
    const result = await this.claude.chatAnswer(question, memories, history);

    // 5. Filter to only memories that were actually used
    const usedMemories = result.usedMemoryIndices
      .map((idx) => memories[idx - 1])
      .filter((m) => m !== undefined);

    // 6. Add assistant response to session
    session.addAssistantMessage(result.answer, usedMemories);

    return {
      answer: result.answer,
      sources: usedMemories,
    };
  }

  async close(): Promise<void> {
    await this.graph.close();
  }
}
