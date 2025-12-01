import { GraphClient } from '../graph/client';
import { ClaudeClient } from '../ai/claude';
import { OpenAIClient } from '../ai/openai';
import type { Memory } from './types';

export class MemorySystem {
  constructor(
    private graph: GraphClient,
    private claude: ClaudeClient,
    private openai: OpenAIClient
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
    await this.graph.storeMemory(memory, extracted.entities);

    return memory.id;
  }

  async recall(query: string, limit = 5): Promise<Memory[]> {
    // 1. Generate query embedding
    const embedding = await this.openai.generateEmbedding(query);

    // 2. Vector search
    const memories = await this.graph.searchByVector(embedding, limit);

    return memories;
  }

  async exportMemories(filePath: string): Promise<number> {
    const memories = await this.graph.getAllMemories();
    const data = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      count: memories.length,
      memories: memories.map(m => ({
        id: m.id,
        originalText: m.content,
        summary: m.summary,
        type: m.type,
        timestamp: m.timestamp.toISOString(),
        metadata: m.metadata,
        // Don't export embedding (too large)
      })),
    };

    await Bun.write(filePath, JSON.stringify(data, null, 2));
    return memories.length;
  }

  async importMemories(filePath: string, reExtract = false): Promise<number> {
    const file = Bun.file(filePath);
    const data = await file.json();

    let imported = 0;
    for (const item of data.memories) {
      if (reExtract) {
        // Re-extract with current prompts/models
        await this.remember(item.originalText);
      } else {
        // Use stored extraction data
        const embedding = await this.openai.generateEmbedding(item.originalText);
        const memory: Memory = {
          id: crypto.randomUUID(), // Generate new ID
          content: item.originalText,
          summary: item.summary,
          type: item.type,
          timestamp: new Date(item.timestamp),
          embedding,
          metadata: item.metadata,
        };
        await this.graph.storeMemory(memory, []);
      }
      imported++;
    }

    return imported;
  }

  async listRecent(limit = 10): Promise<Memory[]> {
    return this.graph.getRecentMemories(limit);
  }

  async close(): Promise<void> {
    await this.graph.close();
  }
}
