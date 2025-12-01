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

  async close(): Promise<void> {
    await this.graph.close();
  }
}
