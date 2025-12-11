import { generateObject } from 'ai';
import { z } from 'zod';
import type { LanguageModel } from 'ai';
import { withRetry } from './utils/retry';

// Intent schema - discriminated union for different intent types
const intentSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('remember'), text: z.string() }),
  z.object({ intent: z.literal('todo_list') }),
  z.object({
    intent: z.literal('todo_mark_done'),
    query: z.string(),
    summary: z.string(),
  }),
  z.object({ intent: z.literal('retrieve'), question: z.string() }),
]);

export type Intent = z.infer<typeof intentSchema>;

export class IntentAgent {
  constructor(private model: LanguageModel<any>) {}

  async detectIntent(text: string): Promise<Intent> {
    return withRetry(async () => {
      const result = await generateObject({
        model: this.model,
        schema: intentSchema,
        prompt: `Analyze if this is a todo-related command or a question:

Text: ${text}

Classify into ONE of these intents:
- "remember": User wants to store a memory (use original text)
- "todo_list": User wants to list OPEN/ACTIVE todos only
- "todo_mark_done": User wants to mark a todo as done (extract query and summary)
- "retrieve": User asks a question or wants information (use original text as question)

Examples:
"what todos do i have?" → {"intent": "todo_list"}
"show my todos" → {"intent": "todo_list"}
"what todos are open?" → {"intent": "todo_list"}
"done i bought a computer today" → {"intent": "todo_mark_done", "query": "buy computer", "summary": "bought a computer today"}
"mark done call john" → {"intent": "todo_mark_done", "query": "call john", "summary": "completed"}
"I finished the report" → {"intent": "todo_mark_done", "query": "report", "summary": "finished"}
"remember I had coffee with Sarah" → {"intent": "remember", "text": "I had coffee with Sarah"}
"buy groceries tomorrow" → {"intent": "remember", "text": "buy groceries tomorrow"}
"hello" → {"intent": "retrieve", "question": "hello"}
"what did I do yesterday" → {"intent": "retrieve", "question": "what did I do yesterday"}
"what todos have i completed" → {"intent": "retrieve", "question": "what todos have i completed"}
"show completed todos" → {"intent": "retrieve", "question": "show completed todos"}

Note: "todo_list" is ONLY for listing OPEN/ACTIVE todos. Questions about completed/resolved todos should be "retrieve".`,
        temperature: 0.2,
      });

      return result.object;
    });
  }
}
