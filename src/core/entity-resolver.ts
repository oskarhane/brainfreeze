import { GraphClient } from "../graph/client";
import { ClaudeClient } from "../ai/claude";
import type { Entity } from "./types";

export interface MergeCandidate {
  entities: Array<{ entity: Entity; memoryCount: number }>;
  suggestedKeep: number; // index of entity to keep
  reasoning: string;
  confidence: "high" | "medium" | "low";
}

export class EntityResolver {
  constructor(
    private graph: GraphClient,
    private claude: ClaudeClient,
  ) {}

  async findMergeCandidates(): Promise<MergeCandidate[]> {
    const allEntities = await this.graph.getAllEntities();
    const candidates: MergeCandidate[] = [];

    // Group entities by normalized name prefix (first 3 chars) for efficiency
    const groups = new Map<string, typeof allEntities>();
    for (const item of allEntities) {
      const prefix = item.entity.name.toLowerCase().slice(0, 3);
      const group = groups.get(prefix) || [];
      group.push(item);
      groups.set(prefix, group);
    }

    // Find potential duplicates within each group
    for (const [, group] of groups) {
      if (group.length < 2) continue;

      // Check each pair for similarity
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const e1 = group[i];
          const e2 = group[j];

          if (!e1 || !e2) continue;

          // Only compare same type entities
          if (e1.entity.type !== e2.entity.type) continue;

          // Check name similarity
          const similarity = this.nameSimilarity(
            e1.entity.name,
            e2.entity.name,
          );
          if (similarity < 0.7) continue;

          // Use Claude to confirm if they're the same
          const result = await this.claude.disambiguateEntity(
            e1.entity.name,
            e1.entity.type,
            `Comparing "${e1.entity.name}" with "${e2.entity.name}"`,
            [e1, e2],
          );

          if (result.selectedIndex > 0) {
            // Claude thinks they might be the same
            const suggestedKeep =
              e1.memoryCount >= e2.memoryCount ? 0 : 1;
            candidates.push({
              entities: [e1, e2],
              suggestedKeep,
              reasoning: result.reasoning,
              confidence: result.confidence as "high" | "medium" | "low",
            });
          }
        }
      }
    }

    return candidates;
  }

  private nameSimilarity(a: string, b: string): number {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();

    // Exact match
    if (aLower === bLower) return 1.0;

    // One contains the other
    if (aLower.includes(bLower) || bLower.includes(aLower)) return 0.9;

    // Levenshtein distance based similarity
    const maxLen = Math.max(a.length, b.length);
    const distance = this.levenshteinDistance(aLower, bLower);
    return 1 - distance / maxLen;
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0]![j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i]![j] = matrix[i - 1]![j - 1]!;
        } else {
          matrix[i]![j] = Math.min(
            matrix[i - 1]![j - 1]! + 1,
            matrix[i]![j - 1]! + 1,
            matrix[i - 1]![j]! + 1,
          );
        }
      }
    }

    return matrix[b.length]![a.length]!;
  }

  async mergeEntities(keepId: string, removeId: string): Promise<void> {
    await this.graph.mergeEntities(keepId, removeId);
  }
}
