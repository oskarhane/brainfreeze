export interface Memory {
  id: string;
  content: string;
  summary: string;
  type: MemoryType;
  timestamp: Date;
  embedding: number[];
  metadata: MemoryMetadata;
}

export type MemoryType = "episodic" | "semantic" | "todo" | "reflection";

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  context?: string;
  aliases?: string[];
}

export type EntityType = "person" | "place" | "concept" | "organization";

export interface MemoryMetadata {
  location?: string;
  activity?: string;
  sentiment?: "positive" | "neutral" | "negative";
  timeOfDay?: "morning" | "afternoon" | "evening";
}

export interface Relationship {
  from: string; // entity name
  to: string; // entity name
  type: RelationshipType;
  context?: string;
}

export type RelationshipType =
  | "KNOWS"
  | "WORKS_AT"
  | "LIVES_IN"
  | "VISITED"
  | "RELATED_TO"
  | "PART_OF"
  | "MENTIONED_WITH";

export interface ExtractedMemory {
  summary: string;
  type: MemoryType;
  entities: Array<{
    name: string;
    type: EntityType;
    context?: string;
  }>;
  relationships: Relationship[];
  temporal: {
    references: string[];
    timeOfDay?: "morning" | "afternoon" | "evening";
  };
  metadata: MemoryMetadata;
  hypotheticalQuestions: string[];
}

export interface RecallQuery {
  text: string;
  limit?: number;
  filters?: {
    type?: MemoryType;
    dateFrom?: Date;
    dateTo?: Date;
    entities?: string[];
  };
}

export interface RecallResult {
  memories: Memory[];
  entities: Entity[];
  relationshipCount: number;
}

export interface EntityDisambiguation {
  extractedEntity: { name: string; type: string; context?: string };
  candidates: Array<{ entity: Entity; memoryCount: number }>;
  autoResolved?: { index: number; reasoning: string };
}

export interface Config {
  neo4j: {
    uri: string;
    user: string;
    password: string;
    database?: string; // default: 'neo4j'
  };
  anthropic: {
    apiKey: string;
    model: string;
  };
  openai: {
    apiKey: string;
    model: string;
  };
}
