import type { Memory } from "./types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  usedMemories?: string[]; // memory IDs used in this response
}

export class ChatSession {
  private history: ChatMessage[] = [];
  private retrievedMemories: Map<string, Memory> = new Map();

  addUserMessage(content: string): void {
    this.history.push({ role: "user", content });
  }

  addAssistantMessage(content: string, usedMemories: Memory[] = []): void {
    const memoryIds = usedMemories.map((m) => m.id);
    this.history.push({ role: "assistant", content, usedMemories: memoryIds });

    // Track all retrieved memories in session
    for (const memory of usedMemories) {
      this.retrievedMemories.set(memory.id, memory);
    }
  }

  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  getFormattedHistory(): string {
    return this.history
      .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
      .join("\n\n");
  }

  getRetrievedMemories(): Memory[] {
    return Array.from(this.retrievedMemories.values());
  }

  clear(): void {
    this.history = [];
    this.retrievedMemories.clear();
  }

  get length(): number {
    return this.history.length;
  }
}
