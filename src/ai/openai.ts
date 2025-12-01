import OpenAI from 'openai';

export class OpenAIClient {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: text,
      });

      return response.data[0]?.embedding || [];
    } catch (error: any) {
      throw new Error(`OpenAI embedding failed: ${error.message}`);
    }
  }
}
