import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedMemory, Memory } from "../core/types";
import {
  EXTRACTION_PROMPT,
  SYNTHESIS_PROMPT,
  CHAT_PROMPT,
  RESOLVE_REFERENCES_PROMPT,
  ENTITY_DISAMBIGUATION_PROMPT,
} from "./prompts";
import type { Entity } from "../core/types";

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
            role: "user",
            content: EXTRACTION_PROMPT.replace("{TEXT}", text),
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== "text") {
        throw new Error("Unexpected response type from Claude");
      }

      // Try to extract JSON from the response (handle markdown code blocks)
      let jsonStr = content.text.trim();

      // Remove markdown code blocks if present
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr
          .replace(/```json?\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
      }

      const extracted = JSON.parse(jsonStr);
      return extracted as ExtractedMemory;
    } catch (error: any) {
      if (retries > 0 && error.status && error.status >= 500) {
        // Retry on server errors
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return this.extract(text, retries - 1);
      }
      throw new Error(`Claude extraction failed: ${error.message}`);
    }
  }

  async synthesizeAnswer(
    question: string,
    memories: Memory[],
    entities: Array<{ entity: Entity; memoryCount: number }> = [],
  ): Promise<{ answer: string; usedMemoryIndices: number[] }> {
    // Format entities for the prompt
    const entitiesText =
      entities.length > 0
        ? entities
            .map(
              (e) =>
                `- ${e.entity.name} (${e.entity.type})${e.entity.aliases?.length ? ` [aliases: ${e.entity.aliases.join(", ")}]` : ""} - ${e.memoryCount} memories`,
            )
            .join("\n")
        : "No entities found.";

    // Format memories for the prompt
    const memoriesText = memories
      .map(
        (m, i) =>
          `Memory ${i + 1}:
Summary: ${m.summary}
Content: ${m.content}
Type: ${m.type}`,
      )
      .join("\n\n");

    const prompt = SYNTHESIS_PROMPT.replace("{QUESTION}", question)
      .replace("{ENTITIES}", entitiesText)
      .replace("{MEMORIES}", memoriesText);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1000,
        temperature: 0.5,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== "text") {
        throw new Error("Unexpected response type from Claude");
      }

      let jsonStr = content.text.trim();

      // Remove markdown code blocks if present
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr
          .replace(/```json?\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
      }

      const result = JSON.parse(jsonStr);
      return {
        answer: result.answer,
        usedMemoryIndices: result.usedMemories || [],
      };
    } catch (error: any) {
      throw new Error(`Claude synthesis failed: ${error.message}`);
    }
  }

  async chatAnswer(
    question: string,
    memories: Memory[],
    conversationHistory: string,
    entities: Array<{ entity: Entity; memoryCount: number }> = [],
  ): Promise<{ answer: string; usedMemoryIndices: number[] }> {
    // Format entities for the prompt
    const entitiesText =
      entities.length > 0
        ? entities
            .map(
              (e) =>
                `- ${e.entity.name} (${e.entity.type})${e.entity.aliases?.length ? ` [aliases: ${e.entity.aliases.join(", ")}]` : ""} - ${e.memoryCount} memories`,
            )
            .join("\n")
        : "No entities found.";

    // Format memories for the prompt
    const memoriesText = memories
      .map(
        (m, i) =>
          `Memory ${i + 1}:
Summary: ${m.summary}
Content: ${m.content}
Type: ${m.type}`,
      )
      .join("\n\n");

    const prompt = CHAT_PROMPT.replace("{QUESTION}", question)
      .replace("{ENTITIES}", entitiesText)
      .replace("{MEMORIES}", memoriesText)
      .replace(
        "{HISTORY}",
        conversationHistory || "(No previous conversation)",
      );

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1000,
        temperature: 0.5,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== "text") {
        throw new Error("Unexpected response type from Claude");
      }

      let jsonStr = content.text.trim();

      // Remove markdown code blocks if present
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr
          .replace(/```json?\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
      }

      const result = JSON.parse(jsonStr);
      return {
        answer: result.answer,
        usedMemoryIndices: result.usedMemories || [],
      };
    } catch (error: any) {
      throw new Error(`Claude chat failed: ${error.message}`);
    }
  }

  async disambiguateEntity(
    entityName: string,
    entityType: string,
    context: string,
    candidates: Array<{ entity: Entity; memoryCount: number }>,
  ): Promise<{ selectedIndex: number; confidence: string; reasoning: string }> {
    const candidatesText = candidates
      .map(
        (c, i) =>
          `${i + 1}. ${c.entity.name} (type: ${c.entity.type}, memories: ${c.memoryCount}${c.entity.aliases?.length ? `, aliases: ${c.entity.aliases.join(", ")}` : ""})`,
      )
      .join("\n");

    const prompt = ENTITY_DISAMBIGUATION_PROMPT.replace(
      "{ENTITY_NAME}",
      entityName,
    )
      .replace("{ENTITY_TYPE}", entityType)
      .replace("{CONTEXT}", context)
      .replace("{CANDIDATES}", candidatesText);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 300,
        temperature: 0.3,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== "text") {
        return {
          selectedIndex: -1,
          confidence: "low",
          reasoning: "No response",
        };
      }

      let jsonStr = content.text.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr
          .replace(/```json?\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
      }

      return JSON.parse(jsonStr);
    } catch (error: any) {
      return { selectedIndex: -1, confidence: "low", reasoning: error.message };
    }
  }

  async resolveReferences(
    text: string,
    conversationHistory: string,
  ): Promise<string> {
    const prompt = RESOLVE_REFERENCES_PROMPT.replace("{TEXT}", text).replace(
      "{HISTORY}",
      conversationHistory,
    );

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 500,
        temperature: 0.3,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== "text") {
        return text; // Fallback to original
      }

      return content.text.trim();
    } catch (error: any) {
      // On error, just return original text
      return text;
    }
  }

  async disambiguateTodo(
    query: string,
    todos: Memory[],
    resolutionContext: string,
  ): Promise<number> {
    const todosText = todos
      .map(
        (t, i) =>
          `${i + 1}. ${t.summary} (created: ${t.timestamp.toISOString()})`,
      )
      .join("\n");

    const prompt = `You need to identify which todo the user wants to mark as done.

Query: ${query}
Resolution context: ${resolutionContext}

Available open todos:
${todosText}

Return JSON with:
- selectedIndex: number (1-${todos.length}, or 0 if none match, or -1 if ambiguous)
- confidence: "high" | "medium" | "low"
- reasoning: brief explanation

Return only valid JSON, no other text.`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 300,
        temperature: 0.3,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== "text") {
        return -1;
      }

      let jsonStr = content.text.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr
          .replace(/```json?\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
      }

      const result = JSON.parse(jsonStr);

      // Return 0-based index, or -1 if ambiguous/none
      if (
        result.selectedIndex === 0 ||
        result.selectedIndex === -1 ||
        result.confidence !== "high"
      ) {
        return -1;
      }

      return result.selectedIndex - 1; // Convert to 0-based
    } catch (error: any) {
      return -1;
    }
  }

  async detectIntent(
    text: string,
  ): Promise<
    | { type: "list_todos" }
    | { type: "mark_done"; query: string; summary: string }
    | { type: "normal" }
  > {
    const prompt = `Analyze if this is a todo-related command:

Text: ${text}

Return JSON with:
- type: "list_todos" | "mark_done" | "normal"
- query: (if mark_done) what todo to find
- summary: (if mark_done) resolution summary

Examples:
"what todos do i have?" → {"type": "list_todos"}
"show my todos" → {"type": "list_todos"}
"what todos are open?" → {"type": "list_todos"}
"done i bought a computer today" → {"type": "mark_done", "query": "buy computer", "summary": "bought a computer today"}
"mark done call john" → {"type": "mark_done", "query": "call john", "summary": "completed"}
"I finished the report" → {"type": "mark_done", "query": "report", "summary": "finished"}
"hello" → {"type": "normal"}
"what did I do yesterday" → {"type": "normal"}
"what todos have i completed" → {"type": "normal"}
"show completed todos" → {"type": "normal"}

Note: "list_todos" is ONLY for listing OPEN/ACTIVE todos. Questions about completed/resolved todos should be "normal".

Return only valid JSON, no other text.`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 200,
        temperature: 0.2,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== "text") {
        return { type: "normal" };
      }

      let jsonStr = content.text.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr
          .replace(/```json?\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
      }

      return JSON.parse(jsonStr);
    } catch (error: any) {
      return { type: "normal" };
    }
  }
}
