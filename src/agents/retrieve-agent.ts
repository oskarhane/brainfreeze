import { generateObject } from 'ai';
import { z } from 'zod';
import type { LanguageModel } from 'ai';
import type { Memory, Entity } from '../core/types';
import { withRetry } from './utils/retry';

const answerSchema = z.object({
  answer: z.string(),
  usedMemories: z.array(z.number()),
});

export class RetrieveAgent {
  constructor(private model: LanguageModel<any>) {}

  async synthesizeAnswer(
    question: string,
    memories: Memory[],
    entities: Array<{ entity: Entity; memoryCount: number }> = [],
    conversationHistory?: string,
  ): Promise<{ answer: string; usedMemoryIndices: number[] }> {
    return withRetry(async () => {
      // Format entities
      const entitiesText =
        entities.length > 0
          ? entities
              .map(
                (e) =>
                  `- ${e.entity.name} (${e.entity.type})${e.entity.aliases?.length ? ` [aliases: ${e.entity.aliases.join(", ")}]` : ""} - ${e.memoryCount} memories`,
              )
              .join("\n")
          : "No entities found.";

      // Format memories
      const memoriesText = memories
        .map(
          (m, i) =>
            `Memory ${i + 1}:
Summary: ${m.summary}
Content: ${m.content}
Type: ${m.type}`,
        )
        .join("\n\n");

      // Build prompt based on whether we have conversation history
      let prompt: string;
      if (conversationHistory) {
        prompt = `You are a helpful assistant with access to the user's personal memories and known entities.

Conversation History:
${conversationHistory}

Current Question: ${question}

Known Entities (people, places, organizations the user knows):
${entitiesText}

Relevant Memories:
${memoriesText}

Instructions:
- Answer the current question using the memories, entities, and conversation context
- You can reference previous parts of the conversation (e.g., "as I mentioned", "the person you asked about")
- Use BOTH entities and memories - entities show WHO/WHAT the user knows, memories show details
- For questions like "how many X do I know", check the entities list first
- Provide concise, natural answers using ONLY relevant information
- If memories don't answer the question, say so and mention what you do know
- Don't make up information not in the memories or entities
- Include ONLY the memory numbers you actually used`;
      } else {
        prompt = `Answer the user's question based on their memories and known entities.

Question: ${question}

Known Entities (people, places, organizations the user knows):
${entitiesText}

Relevant Memories:
${memoriesText}

Instructions:
- Provide a concise, natural language answer using ONLY relevant information
- Use BOTH entities and memories to answer - entities show WHO/WHAT the user knows, memories show details
- For questions like "how many X do I know", check the entities list first
- If memories contain the answer, synthesize it clearly
- If memories don't fully answer the question, say "I don't have enough information" and mention what you do know
- Be conversational and helpful
- Don't make up information not in the memories or entities
- Include ONLY the memory numbers you actually used in your answer`;
      }

      const result = await generateObject({
        model: this.model,
        schema: answerSchema,
        mode: 'json',
        prompt,
        temperature: 0.5,
      });

      return {
        answer: result.object.answer,
        usedMemoryIndices: result.object.usedMemories,
      };
    });
  }
}
