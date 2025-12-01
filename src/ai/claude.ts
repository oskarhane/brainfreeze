import Anthropic from '@anthropic-ai/sdk';
import type { ExtractedMemory } from '../core/types';
import { EXTRACTION_PROMPT } from './prompts';

export class ClaudeClient {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async extract(text: string, retries = 1): Promise<ExtractedMemory> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2000,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: EXTRACTION_PROMPT.replace('{TEXT}', text),
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      // Try to extract JSON from the response (handle markdown code blocks)
      let jsonStr = content.text.trim();

      // Remove markdown code blocks if present
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
      }

      const extracted = JSON.parse(jsonStr);
      return extracted as ExtractedMemory;
    } catch (error: any) {
      if (retries > 0 && error.status && error.status >= 500) {
        // Retry on server errors
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.extract(text, retries - 1);
      }
      throw new Error(`Claude extraction failed: ${error.message}`);
    }
  }
}
