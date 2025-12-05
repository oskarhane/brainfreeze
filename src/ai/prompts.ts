export const EXTRACTION_PROMPT = `Analyze text and extract structured info.

Text: {TEXT}

Return ONLY valid JSON:
{
  "summary": "Brief 1-2 sentence summary",
  "type": "episodic|semantic|todo|reflection",
  "entities": [
    {"name": "Entity name", "type": "person|place|concept|organization", "context": "optional"}
  ],
  "relationships": [
    {"from": "Entity1", "to": "Entity2", "type": "KNOWS|WORKS_AT|LIVES_IN|VISITED|RELATED_TO|PART_OF|MENTIONED_WITH", "context": "optional"}
  ],
  "temporal": {
    "references": ["yesterday", "next week"],
    "timeOfDay": "morning|afternoon|evening|null"
  },
  "metadata": {
    "location": "location if mentioned",
    "activity": "what user was doing",
    "sentiment": "positive|neutral|negative"
  },
  "hypotheticalQuestions": ["Question a user might ask to find this memory"]
}

Types:
- episodic: experiences, events, conversations
- semantic: facts, knowledge
- todo: tasks, commitments
- reflection: thoughts, opinions

Relationship types:
- KNOWS: person knows person
- WORKS_AT: person works at organization
- LIVES_IN: person lives in place
- VISITED: person/entity visited place
- RELATED_TO: general connection between concepts
- PART_OF: entity is part of larger entity
- MENTIONED_WITH: entities co-occur (default if no explicit relationship)
- LIKES: person likes something
- DISLIKES: person dislikes something
- PREFERS: person prefers something

IMPORTANT: For first-person statements (I, me, my), use "User" as the entity name.
- "I hate oatmilk" → entity: User, relationship: User -[DISLIKES]-> oatmilk
- "I work at Google" → entity: User, relationship: User -[WORKS_AT]-> Google
- "My favorite coffee shop is Blue Bottle" → User -[PREFERS]-> Blue Bottle

Extract ALL people, places, orgs, concepts AND their relationships.

Hypothetical questions:
- Generate 1-5 natural questions a user might ask to retrieve this memory
- Focus on CONTENT: who, what, where, why (NOT when/temporal aspects)
- Avoid time-based questions like "When did I...", "What time...", etc.
- Examples: "What did I discuss with X?", "Where did I eat?", "Who talked about Y?"
- More diverse memories deserve more questions

Return ONLY JSON, no markdown formatting.`;

export const SYNTHESIS_PROMPT = `Answer the user's question based on their memories and known entities.

Question: {QUESTION}

Known Entities (people, places, organizations the user knows):
{ENTITIES}

Relevant Memories:
{MEMORIES}

Instructions:
- Provide a concise, natural language answer using ONLY relevant information
- Use BOTH entities and memories to answer - entities show WHO/WHAT the user knows, memories show details
- For questions like "how many X do I know", check the entities list first
- If memories contain the answer, synthesize it clearly
- If memories don't fully answer the question, say "I don't have enough information" and mention what you do know
- Be conversational and helpful
- Don't make up information not in the memories or entities
- Include ONLY the memory numbers you actually used in your answer

Return ONLY valid JSON:
{
  "answer": "Your synthesized answer here",
  "usedMemories": [1, 3]
}`;

export const CHAT_PROMPT = `You are a helpful assistant with access to the user's personal memories and known entities.

Conversation History:
{HISTORY}

Current Question: {QUESTION}

Known Entities (people, places, organizations the user knows):
{ENTITIES}

Relevant Memories:
{MEMORIES}

Instructions:
- Answer the current question using the memories, entities, and conversation context
- You can reference previous parts of the conversation (e.g., "as I mentioned", "the person you asked about")
- Use BOTH entities and memories - entities show WHO/WHAT the user knows, memories show details
- For questions like "how many X do I know", check the entities list first
- Provide concise, natural answers using ONLY relevant information
- If memories don't answer the question, say so and mention what you do know
- Don't make up information not in the memories or entities
- Include ONLY the memory numbers you actually used

Return ONLY valid JSON:
{
  "answer": "Your answer here",
  "usedMemories": [1, 3]
}`;

export const RESOLVE_REFERENCES_PROMPT = `Expand references in the text using conversation context to make memories self-contained.

Conversation History:
{HISTORY}

Text to expand: {TEXT}

Instructions:
- Replace pronouns (he, she, they, it) with specific names from conversation
- Expand "the X" references to include WHO/WHAT from context (e.g., "the leaf blower" → "John's leaf blower")
- Expand vague references ("that", "this", "about it") with specifics from context
- Do NOT change explicit names - if text says "John", keep it as "John" (don't change to "John Smith")
- Goal: make the text understandable without needing the conversation history
- If a reference is unclear or could refer to multiple things, keep it as-is
- Return ONLY the expanded text, nothing else

Example:
History: "User: John called me to remind me to return the leaf blower"
Text: "create a todo about the leaf blower"
Output: "create a todo to return John's leaf blower"

Example:
History: "User: Met Sarah at the coffee shop. She's a designer."
Text: "She mentioned a new project"
Output: "Sarah mentioned a new project"

Example:
History: "User: remember John called. User: remember met John Smith from Nintendo."
Text: "I returned John's leaf blower"
Output: "I returned John's leaf blower"
(Note: "John" is kept as-is because it's already a specific name)

Return ONLY the expanded text.`;

export const ENTITY_DISAMBIGUATION_PROMPT = `Determine which existing entity a new mention refers to, or if it's a new entity.

New entity mention from text: {ENTITY_NAME} (type: {ENTITY_TYPE})
Context from the memory: {CONTEXT}

Existing entities that might match:
{CANDIDATES}

Instructions:
- Analyze if the new mention refers to one of the existing entities
- Consider name similarity, type match, and context clues
- IMPORTANT: If multiple entities have similar names (e.g., "John" and "John Smith"), return -1 to ask the user
- Only return high confidence if there's ONE clear match with matching context
- If the mention is a partial name (e.g., "John") and multiple full names match (e.g., "John Doe", "John Smith"), return -1
- If it's clearly a new/different entity, return 0
- If ambiguous in any way, return -1 to let the user decide

Return ONLY valid JSON:
{
  "selectedIndex": 1,
  "confidence": "high|medium|low",
  "reasoning": "Brief explanation"
}`;
