import neo4j from "neo4j-driver";
import type { Memory, Entity, Relationship } from "../core/types";

export class GraphClient {
  private driver: neo4j.Driver;
  private database: string;

  constructor(
    uri: string,
    user: string,
    password: string,
    database: string = "neo4j",
  ) {
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    this.database = database;
  }

  private normalizeEntityName(name: string): string {
    return name.toLowerCase().trim();
  }

  async initSchema(): Promise<void> {
    const session = this.driver.session({ database: this.database });
    try {
      // Create constraints and indexes
      await session.run(`
        CREATE CONSTRAINT memory_id IF NOT EXISTS
        FOR (m:Memory) REQUIRE m.id IS UNIQUE
      `);

      await session.run(`
        CREATE CONSTRAINT entity_id IF NOT EXISTS
        FOR (e:Entity) REQUIRE e.id IS UNIQUE
      `);

      await session.run(`
        CREATE INDEX memory_timestamp IF NOT EXISTS
        FOR (m:Memory) ON (m.timestamp)
      `);

      await session.run(`
        CREATE INDEX entity_name IF NOT EXISTS
        FOR (e:Entity) ON (e.name)
      `);

      await session.run(`
        CREATE INDEX entity_normalized_name IF NOT EXISTS
        FOR (e:Entity) ON (e.normalizedName)
      `);

      // Fulltext index for fuzzy entity name search
      try {
        await session.run(`
          CREATE FULLTEXT INDEX entity_name_fulltext IF NOT EXISTS
          FOR (e:Entity) ON EACH [e.name, e.aliases]
        `);
      } catch (error: any) {
        if (!error.message.includes("already exists")) {
          console.warn(
            "Warning: Fulltext index creation skipped:",
            error.message,
          );
        }
      }

      // Create vector index for memories
      try {
        await session.run(`
          CREATE VECTOR INDEX memory_embedding IF NOT EXISTS
          FOR (m:Memory) ON (m.embedding)
          OPTIONS {
            indexConfig: {
              \`vector.dimensions\`: 1536,
              \`vector.similarity_function\`: 'cosine'
            }
          }
        `);
      } catch (error: any) {
        if (!error.message.includes("already exists")) {
          console.warn(
            "Warning: Vector index creation skipped:",
            error.message,
          );
        }
      }

      // Create constraint for hypothetical questions
      await session.run(`
        CREATE CONSTRAINT hypothetical_question_id IF NOT EXISTS
        FOR (q:HypotheticalQuestion) REQUIRE q.id IS UNIQUE
      `);

      // Create constraint for entity versions
      await session.run(`
        CREATE CONSTRAINT entity_version_id IF NOT EXISTS
        FOR (ev:EntityVersion) REQUIRE ev.id IS UNIQUE
      `);

      await session.run(`
        CREATE INDEX entity_version_entity_id IF NOT EXISTS
        FOR (ev:EntityVersion) ON (ev.entityId)
      `);

      // Create vector index for hypothetical questions
      try {
        await session.run(`
          CREATE VECTOR INDEX hypothetical_question_embedding IF NOT EXISTS
          FOR (q:HypotheticalQuestion) ON (q.embedding)
          OPTIONS {
            indexConfig: {
              \`vector.dimensions\`: 1536,
              \`vector.similarity_function\`: 'cosine'
            }
          }
        `);
      } catch (error: any) {
        if (!error.message.includes("already exists")) {
          console.warn(
            "Warning: Hypothetical question vector index creation skipped:",
            error.message,
          );
        }
      }
    } finally {
      await session.close();
    }
  }

  async storeMemory(
    memory: Memory,
    entities: Array<{
      name: string;
      type: string;
      context?: string;
      resolvedId?: string;
    }>,
    relationships: Relationship[] = [],
    entityResolutions?: Map<string, string>, // entityName -> resolvedEntityId
  ): Promise<void> {
    const session = this.driver.session({ database: this.database });
    try {
      await session.executeWrite(async (tx) => {
        // Create memory node
        const props: Record<string, any> = {
          id: memory.id,
          content: memory.content,
          summary: memory.summary,
          type: memory.type,
          timestamp: memory.timestamp.toISOString(),
          embedding: memory.embedding,
        };

        // Add todo-specific fields if present
        if (memory.status) {
          props.status = memory.status;
        }
        if (memory.resolutionSummary) {
          props.resolutionSummary = memory.resolutionSummary;
        }
        if (memory.resolvedAt) {
          props.resolvedAt = memory.resolvedAt.toISOString();
        }

        await tx.run(
          `CREATE (m:Memory {
            id: $id,
            content: $content,
            summary: $summary,
            type: $type,
            timestamp: datetime($timestamp),
            embedding: $embedding
            ${memory.status ? ", status: $status" : ""}
            ${memory.resolutionSummary ? ", resolutionSummary: $resolutionSummary" : ""}
            ${memory.resolvedAt ? ", resolvedAt: datetime($resolvedAt)" : ""}
          })`,
          props,
        );

        // Create entities and memory-entity relationships
        for (const entity of entities) {
          if (entity.resolvedId) {
            // Link to existing entity by ID
            await tx.run(
              `MATCH (e:Entity {id: $entityId})
               SET e.lastSeen = datetime()
               WITH e
               MATCH (m:Memory {id: $memoryId})
               CREATE (m)-[:MENTIONS]->(e)`,
              {
                entityId: entity.resolvedId,
                memoryId: memory.id,
              },
            );
          } else {
            // Create or merge entity by normalized name
            const normalizedName = this.normalizeEntityName(entity.name);
            await tx.run(
              `MERGE (e:Entity {normalizedName: $normalizedName, type: $type})
               ON CREATE SET e.id = randomUUID(), e.name = $name, e.firstSeen = datetime()
               ON MATCH SET e.name = $name, e.lastSeen = datetime()
               WITH e
               MATCH (m:Memory {id: $memoryId})
               CREATE (m)-[:MENTIONS]->(e)`,
              {
                normalizedName,
                name: entity.name,
                type: entity.type,
                memoryId: memory.id,
              },
            );
          }
        }

        // Create entity-entity relationships
        // Use resolved entity IDs when available
        for (const rel of relationships) {
          const fromResolvedId = entityResolutions?.get(rel.from);
          const toResolvedId = entityResolutions?.get(rel.to);

          if (fromResolvedId && toResolvedId) {
            // Both resolved by ID
            await tx.run(
              `MATCH (from:Entity {id: $fromId})
               MATCH (to:Entity {id: $toId})
               MERGE (from)-[r:\`${rel.type}\`]->(to)
               ON CREATE SET r.firstSeen = datetime(), r.context = $context
               ON MATCH SET r.lastSeen = datetime()`,
              {
                fromId: fromResolvedId,
                toId: toResolvedId,
                context: rel.context || "",
              },
            );
          } else if (fromResolvedId) {
            // From resolved by ID, to by normalized name
            const toNormalized = this.normalizeEntityName(rel.to);
            await tx.run(
              `MATCH (from:Entity {id: $fromId})
               MATCH (to:Entity {normalizedName: $toNormalized})
               MERGE (from)-[r:\`${rel.type}\`]->(to)
               ON CREATE SET r.firstSeen = datetime(), r.context = $context
               ON MATCH SET r.lastSeen = datetime()`,
              {
                fromId: fromResolvedId,
                toNormalized,
                context: rel.context || "",
              },
            );
          } else if (toResolvedId) {
            // From by normalized name, to resolved by ID
            const fromNormalized = this.normalizeEntityName(rel.from);
            await tx.run(
              `MATCH (from:Entity {normalizedName: $fromNormalized})
               MATCH (to:Entity {id: $toId})
               MERGE (from)-[r:\`${rel.type}\`]->(to)
               ON CREATE SET r.firstSeen = datetime(), r.context = $context
               ON MATCH SET r.lastSeen = datetime()`,
              {
                fromNormalized,
                toId: toResolvedId,
                context: rel.context || "",
              },
            );
          } else {
            // Neither resolved, use normalized names
            const fromNormalized = this.normalizeEntityName(rel.from);
            const toNormalized = this.normalizeEntityName(rel.to);
            await tx.run(
              `MATCH (from:Entity {normalizedName: $fromNormalized})
               MATCH (to:Entity {normalizedName: $toNormalized})
               MERGE (from)-[r:\`${rel.type}\`]->(to)
               ON CREATE SET r.firstSeen = datetime(), r.context = $context
               ON MATCH SET r.lastSeen = datetime()`,
              {
                fromNormalized,
                toNormalized,
                context: rel.context || "",
              },
            );
          }
        }
      });
    } finally {
      await session.close();
    }
  }

  async storeHypotheticalQuestions(
    memoryId: string,
    questions: Array<{ question: string; embedding: number[] }>,
  ): Promise<void> {
    const session = this.driver.session({ database: this.database });
    try {
      await session.executeWrite(async (tx) => {
        for (const q of questions) {
          await tx.run(
            `CREATE (hq:HypotheticalQuestion {
              id: randomUUID(),
              question: $question,
              embedding: $embedding
            })
            WITH hq
            MATCH (m:Memory {id: $memoryId})
            CREATE (hq)-[:FOR_MEMORY]->(m)`,
            {
              question: q.question,
              embedding: q.embedding,
              memoryId,
            },
          );
        }
      });
    } finally {
      await session.close();
    }
  }

  async updateEntity(
    entityId: string,
    propertyUpdates: Record<string, string>,
  ): Promise<void> {
    const session = this.driver.session({ database: this.database });
    try {
      await session.executeWrite(async (tx) => {
        // Get current entity state
        const result = await tx.run(
          `MATCH (e:Entity {id: $entityId})
           RETURN e.name as name, e.properties as properties, e.version as version`,
          { entityId },
        );

        if (result.records.length === 0) {
          throw new Error(`Entity ${entityId} not found`);
        }

        const current = result.records[0];
        const currentName = current.get("name");
        const currentPropertiesJson = current.get("properties") || "{}";
        const currentProperties =
          typeof currentPropertiesJson === "string"
            ? JSON.parse(currentPropertiesJson)
            : currentPropertiesJson;
        const currentVersion = current.get("version") || 0;

        // Create EntityVersion snapshot
        await tx.run(
          `CREATE (ev:EntityVersion {
            id: randomUUID(),
            entityId: $entityId,
            version: $version,
            name: $name,
            properties: $properties,
            createdAt: datetime()
          })`,
          {
            entityId,
            version: currentVersion,
            name: currentName,
            properties: JSON.stringify(currentProperties),
          },
        );

        // Link Entity to new EntityVersion (delete old relationship first)
        await tx.run(
          `MATCH (e:Entity {id: $entityId})
           OPTIONAL MATCH (e)-[r:PREVIOUS_VERSION]->()
           DELETE r
           WITH e
           MATCH (ev:EntityVersion {entityId: $entityId, version: $version})
           CREATE (e)-[:PREVIOUS_VERSION]->(ev)`,
          { entityId, version: currentVersion },
        );

        // Find previous EntityVersion and link
        if (currentVersion > 0) {
          await tx.run(
            `MATCH (ev1:EntityVersion {entityId: $entityId, version: $currentVersion})
             MATCH (ev2:EntityVersion {entityId: $entityId, version: $previousVersion})
             MERGE (ev1)-[:PREVIOUS_VERSION]->(ev2)`,
            {
              entityId,
              currentVersion,
              previousVersion: currentVersion - 1,
            },
          );
        }

        // Update Entity with new properties
        const newProperties = { ...currentProperties, ...propertyUpdates };
        await tx.run(
          `MATCH (e:Entity {id: $entityId})
           SET e.properties = $properties,
               e.version = $version,
               e.updatedAt = datetime()`,
          {
            entityId,
            properties: JSON.stringify(newProperties),
            version: currentVersion + 1,
          },
        );
      });
    } finally {
      await session.close();
    }
  }

  async getEntityHistory(
    entityId: string,
    limit: number = 10,
  ): Promise<{
    current: Entity;
    history: Array<{
      id: string;
      entityId: string;
      version: number;
      name: string;
      properties: Record<string, string>;
      createdAt: Date;
    }>;
  }> {
    const session = this.driver.session({ database: this.database });
    try {
      // Get current entity
      const entityResult = await session.run(
        `MATCH (e:Entity {id: $entityId})
         RETURN e`,
        { entityId },
      );

      if (entityResult.records.length === 0) {
        throw new Error(`Entity ${entityId} not found`);
      }

      const entityNode = entityResult.records[0].get("e");
      const propertiesJson = entityNode.properties.properties || "{}";
      const properties =
        typeof propertiesJson === "string"
          ? JSON.parse(propertiesJson)
          : propertiesJson;

      const currentEntity: Entity = {
        id: entityNode.properties.id,
        name: entityNode.properties.name,
        type: entityNode.properties.type,
        aliases: entityNode.properties.aliases || [],
        properties,
        version:
          entityNode.properties.version?.toNumber?.() ||
          entityNode.properties.version ||
          0,
        updatedAt: entityNode.properties.updatedAt
          ? new Date(entityNode.properties.updatedAt.toString())
          : undefined,
      };

      // Get version history
      const historyResult = await session.run(
        `MATCH path = (e:Entity {id: $entityId})-[:PREVIOUS_VERSION*]->(ev:EntityVersion)
         WITH ev, length(path) as depth
         ORDER BY depth ASC
         LIMIT $limit
         RETURN ev
         ORDER BY ev.version DESC`,
        { entityId, limit: neo4j.int(limit) },
      );

      const history = historyResult.records.map((record) => {
        const ev = record.get("ev");
        const versionPropertiesJson = ev.properties.properties || "{}";
        const versionProperties =
          typeof versionPropertiesJson === "string"
            ? JSON.parse(versionPropertiesJson)
            : versionPropertiesJson;

        return {
          id: ev.properties.id,
          entityId: ev.properties.entityId,
          version:
            ev.properties.version?.toNumber?.() || ev.properties.version || 0,
          name: ev.properties.name,
          properties: versionProperties,
          createdAt: new Date(ev.properties.createdAt.toString()),
        };
      });

      return { current: currentEntity, history };
    } finally {
      await session.close();
    }
  }

  async searchByVector(embedding: number[], limit: number): Promise<Memory[]> {
    const session = this.driver.session({ database: this.database });
    try {
      const memoryResults = new Map<
        string,
        { memory: Memory; score: number }
      >();

      // Search memory embeddings
      try {
        const memoryResult = await session.run(
          `CALL db.index.vector.queryNodes('memory_embedding', $limit, $embedding)
           YIELD node, score
           RETURN node, score
           ORDER BY score DESC`,
          { embedding, limit: neo4j.int(limit) },
        );

        for (const record of memoryResult.records) {
          const memory = this.nodeToMemory(record.get("node"));
          const score = record.get("score");
          memoryResults.set(memory.id, { memory, score });
        }
      } catch (error: any) {
        if (!error.message.includes("no such index")) {
          throw error;
        }
      }

      // Search hypothetical question embeddings
      try {
        const questionResult = await session.run(
          `CALL db.index.vector.queryNodes('hypothetical_question_embedding', $limit, $embedding)
           YIELD node, score
           MATCH (node)-[:FOR_MEMORY]->(m:Memory)
           RETURN m, score
           ORDER BY score DESC`,
          { embedding, limit: neo4j.int(limit) },
        );

        for (const record of questionResult.records) {
          const memory = this.nodeToMemory(record.get("m"));
          const score = record.get("score");
          const existing = memoryResults.get(memory.id);
          if (!existing || existing.score < score) {
            memoryResults.set(memory.id, { memory, score });
          }
        }
      } catch (error: any) {
        if (!error.message.includes("no such index")) {
          throw error;
        }
      }

      // If no results from vector search, fall back to recent
      if (memoryResults.size === 0) {
        return this.getRecentMemories(limit);
      }

      // Sort by score and return top results
      return Array.from(memoryResults.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((item) => item.memory);
    } finally {
      await session.close();
    }
  }

  async getRecentMemories(limit: number): Promise<Memory[]> {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH (m:Memory)
         RETURN m
         ORDER BY m.timestamp DESC
         LIMIT $limit`,
        { limit: neo4j.int(limit) },
      );

      return result.records.map((record: any) => {
        const node = record.get("m");
        return this.nodeToMemory(node);
      });
    } finally {
      await session.close();
    }
  }

  async getEntitiesForMemories(memoryIds: string[]): Promise<Entity[]> {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH (m:Memory)-[:MENTIONS]->(e:Entity)
         WHERE m.id IN $memoryIds
         RETURN DISTINCT e`,
        { memoryIds },
      );

      return result.records.map((record: any) => {
        const node = record.get("e");
        return {
          id: node.properties.id,
          name: node.properties.name,
          type: node.properties.type,
        };
      });
    } finally {
      await session.close();
    }
  }

  private nodeToMemory(node: any): Memory {
    const props = node.properties;
    return {
      id: props.id,
      content: props.content,
      summary: props.summary,
      type: props.type,
      timestamp: new Date(props.timestamp),
      embedding: props.embedding || [],
      metadata: {
        location: props.location,
        activity: props.activity,
        sentiment: props.sentiment,
        timeOfDay: props.timeOfDay,
      },
      status: props.status,
      resolutionSummary: props.resolutionSummary,
      resolvedAt: props.resolvedAt ? new Date(props.resolvedAt) : undefined,
    };
  }

  async updateTodoStatus(
    memoryId: string,
    status: "open" | "done",
    resolutionSummary?: string,
  ): Promise<void> {
    const session = this.driver.session({ database: this.database });
    try {
      await session.executeWrite(async (tx) => {
        const props: Record<string, any> = { memoryId, status };

        if (resolutionSummary) {
          props.resolutionSummary = resolutionSummary;
        }

        if (status === "done") {
          props.resolvedAt = new Date().toISOString();
        }

        await tx.run(
          `MATCH (m:Memory {id: $memoryId})
           SET m.status = $status
           ${resolutionSummary ? ", m.resolutionSummary = $resolutionSummary" : ""}
           ${status === "done" ? ", m.resolvedAt = datetime($resolvedAt)" : ""}`,
          props,
        );
      });
    } finally {
      await session.close();
    }
  }

  async getAllMemories(): Promise<Memory[]> {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH (m:Memory)
         RETURN m
         ORDER BY m.timestamp ASC`,
      );

      return result.records.map((record: any) => {
        const node = record.get("m");
        return this.nodeToMemory(node);
      });
    } finally {
      await session.close();
    }
  }

  async hybridSearch(
    embedding: number[],
    limit: number,
  ): Promise<Array<Memory & { score: number }>> {
    const session = this.driver.session({ database: this.database });
    try {
      // Step 1: Vector search for similar memories
      const vectorResults = await this.searchByVector(embedding, limit);

      // Step 2: For each memory, get connected entities and their other memories
      const expandedResults = new Map<
        string,
        { memory: Memory; score: number }
      >();

      for (let i = 0; i < vectorResults.length; i++) {
        const memory = vectorResults[i];
        const vectorScore = 1.0 - i / vectorResults.length; // Higher rank = higher score

        // Add original memory
        expandedResults.set(memory.id, { memory, score: vectorScore });

        // Find related memories through entity connections
        const result = await session.run(
          `MATCH (m:Memory {id: $memoryId})-[:MENTIONS]->(e:Entity)
           MATCH (e)<-[:MENTIONS]-(related:Memory)
           WHERE related.id <> $memoryId
           RETURN DISTINCT related, count(e) as sharedEntities
           ORDER BY sharedEntities DESC
           LIMIT 5`,
          { memoryId: memory.id },
        );

        for (const record of result.records) {
          const relatedMemory = this.nodeToMemory(record.get("related"));
          const sharedCount = record.get("sharedEntities").toNumber();
          const graphScore = (sharedCount / 10) * 0.5; // Max 0.5 score from graph connections

          if (!expandedResults.has(relatedMemory.id)) {
            expandedResults.set(relatedMemory.id, {
              memory: relatedMemory,
              score: graphScore,
            });
          }
        }
      }

      // Step 3: Sort by combined score and return top results
      const scored = Array.from(expandedResults.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((item) => ({ ...item.memory, score: item.score }));

      return scored;
    } finally {
      await session.close();
    }
  }

  async findSimilarEntities(
    name: string,
    type?: string,
  ): Promise<Array<{ entity: Entity; score: number; memoryCount: number }>> {
    const session = this.driver.session({ database: this.database });
    try {
      const normalizedName = this.normalizeEntityName(name);
      const results = new Map<
        string,
        { entity: Entity; score: number; memoryCount: number }
      >();

      // First try exact normalized match
      const exactResult = await session.run(
        `MATCH (e:Entity)
         WHERE e.normalizedName = $normalizedName
         ${type ? "AND e.type = $type" : ""}
         OPTIONAL MATCH (m:Memory)-[:MENTIONS]->(e)
         RETURN e, count(m) as memoryCount`,
        { normalizedName, type },
      );

      for (const record of exactResult.records) {
        const node = record.get("e");
        const id = node.properties.id;
        results.set(id, {
          entity: {
            id,
            name: node.properties.name,
            type: node.properties.type,
            aliases: node.properties.aliases || [],
          },
          score: 1.0,
          memoryCount: record.get("memoryCount").toNumber(),
        });
      }

      // Also try fuzzy fulltext search to find similar entities
      try {
        // Search for each word in the name separately for better matching
        const words = name.split(/\s+/);
        for (const word of words) {
          if (word.length < 2) continue;

          // Escape special Lucene characters
          const escapedWord = word.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");

          const fuzzyResult = await session.run(
            `CALL db.index.fulltext.queryNodes('entity_name_fulltext', $searchTerm)
             YIELD node, score
             WHERE score > 0.3 ${type ? "AND node.type = $type" : ""}
             OPTIONAL MATCH (m:Memory)-[:MENTIONS]->(node)
             RETURN node, score, count(m) as memoryCount
             ORDER BY score DESC
             LIMIT 10`,
            { searchTerm: `${escapedWord}~`, type },
          );

          for (const record of fuzzyResult.records) {
            const node = record.get("node");
            const id = node.properties.id;
            const score = record.get("score");

            // Only add if not already present or if this score is higher
            const existing = results.get(id);
            if (!existing || existing.score < score) {
              results.set(id, {
                entity: {
                  id,
                  name: node.properties.name,
                  type: node.properties.type,
                  aliases: node.properties.aliases || [],
                },
                score: existing?.score === 1.0 ? 1.0 : score, // Keep exact match score
                memoryCount: record.get("memoryCount").toNumber(),
              });
            }
          }
        }
      } catch (error: any) {
        // Fulltext index might not exist yet
        if (!error.message.includes("no such index")) {
          throw error;
        }
      }

      // Sort by score descending
      return Array.from(results.values()).sort((a, b) => b.score - a.score);
    } finally {
      await session.close();
    }
  }

  async mergeEntities(keepId: string, removeId: string): Promise<void> {
    const session = this.driver.session({ database: this.database });
    try {
      await session.executeWrite(async (tx) => {
        // Get the entity being removed to capture its name as alias
        const removeResult = await tx.run(
          `MATCH (remove:Entity {id: $removeId})
           RETURN remove.name as name, remove.aliases as aliases`,
          { removeId },
        );

        if (removeResult.records.length === 0) {
          throw new Error(`Entity ${removeId} not found`);
        }

        const removeName = removeResult.records[0].get("name");
        const removeAliases = removeResult.records[0].get("aliases") || [];

        // Move all MENTIONS relationships to keep entity
        await tx.run(
          `MATCH (m:Memory)-[r:MENTIONS]->(remove:Entity {id: $removeId})
           MATCH (keep:Entity {id: $keepId})
           MERGE (m)-[:MENTIONS]->(keep)
           DELETE r`,
          { keepId, removeId },
        );

        // Move all other relationships (non-MENTIONS)
        await tx.run(
          `MATCH (remove:Entity {id: $removeId})-[r]->(other)
           WHERE type(r) <> 'MENTIONS'
           MATCH (keep:Entity {id: $keepId})
           WITH keep, other, type(r) as relType, properties(r) as relProps, r
           CALL apoc.merge.relationship(keep, relType, {}, relProps, other) YIELD rel
           DELETE r`,
          { keepId, removeId },
        );

        await tx.run(
          `MATCH (other)-[r]->(remove:Entity {id: $removeId})
           MATCH (keep:Entity {id: $keepId})
           WITH keep, other, type(r) as relType, properties(r) as relProps, r
           CALL apoc.merge.relationship(other, relType, {}, relProps, keep) YIELD rel
           DELETE r`,
          { keepId, removeId },
        );

        // Add removed entity name and aliases to keep entity
        await tx.run(
          `MATCH (keep:Entity {id: $keepId})
           SET keep.aliases = coalesce(keep.aliases, []) + $newAliases`,
          { keepId, newAliases: [removeName, ...removeAliases] },
        );

        // Delete the removed entity
        await tx.run(
          `MATCH (remove:Entity {id: $removeId})
           DELETE remove`,
          { removeId },
        );
      });
    } finally {
      await session.close();
    }
  }

  async getAllEntities(): Promise<
    Array<{ entity: Entity; memoryCount: number }>
  > {
    const session = this.driver.session({ database: this.database });
    try {
      const result = await session.run(
        `MATCH (e:Entity)
         OPTIONAL MATCH (m:Memory)-[:MENTIONS]->(e)
         RETURN e, count(m) as memoryCount
         ORDER BY memoryCount DESC`,
      );

      return result.records.map((record: any) => {
        const node = record.get("e");
        return {
          entity: {
            id: node.properties.id,
            name: node.properties.name,
            type: node.properties.type,
            aliases: node.properties.aliases || [],
          },
          memoryCount: record.get("memoryCount").toNumber(),
        };
      });
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}
