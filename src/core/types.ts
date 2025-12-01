export interface Memory {
  id: string;
  content: string;
  summary: string;
  type: MemoryType;
  timestamp: Date;
  embedding: number[];
  metadata: MemoryMetadata;
}

export type MemoryType = 'episodic' | 'semantic' | 'todo' | 'reflection';

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  context?: string;
}

export type EntityType = 'person' | 'place' | 'concept' | 'organization';

export interface MemoryMetadata {
  location?: string;
  activity?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  timeOfDay?: 'morning' | 'afternoon' | 'evening';
}

export interface ExtractedMemory {
  summary: string;
  type: MemoryType;
  entities: Array<{
    name: string;
    type: EntityType;
    context?: string;
  }>;
  temporal: {
    references: string[];
    timeOfDay?: 'morning' | 'afternoon' | 'evening';
  };
  metadata: MemoryMetadata;
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

export interface Config {
  neo4j: {
    uri: string;
    user: string;
    password: string;
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
