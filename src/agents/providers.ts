import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import type { LanguageModel, EmbeddingModel } from 'ai';

export function createClaudeModel(apiKey: string, model: string): LanguageModel<any> {
  return anthropic(model, { apiKey });
}

export function createEmbeddingModel(apiKey: string): EmbeddingModel<string> {
  return openai.embedding('text-embedding-3-small', { apiKey });
}
