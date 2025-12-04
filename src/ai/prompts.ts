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

Extract ALL people, places, orgs, concepts AND their relationships.

Hypothetical questions:
- Generate 1-5 natural questions a user might ask to retrieve this memory
- Focus on CONTENT: who, what, where, why (NOT when/temporal aspects)
- Avoid time-based questions like "When did I...", "What time...", etc.
- Examples: "What did I discuss with X?", "Where did I eat?", "Who talked about Y?"
- More diverse memories deserve more questions

Return ONLY JSON, no markdown formatting.`;

export const SYNTHESIS_PROMPT = `Answer the user's question based on their memories.

Question: {QUESTION}

Relevant Memories:
{MEMORIES}

Instructions:
- Provide a concise, natural language answer using ONLY relevant information
- Use information from the memories provided
- If memories contain the answer, synthesize it clearly
- If memories don't fully answer the question, say "I don't have enough information" and mention what you do know
- Be conversational and helpful
- Don't make up information not in the memories
- Include ONLY the memory numbers you actually used in your answer

Return ONLY valid JSON:
{
  "answer": "Your synthesized answer here",
  "usedMemories": [1, 3]
}`;

export const CHAT_PROMPT = `You are a helpful assistant with access to the user's personal memories.

Conversation History:
{HISTORY}

Current Question: {QUESTION}

Relevant Memories:
{MEMORIES}

Instructions:
- Answer the current question using the memories and conversation context
- You can reference previous parts of the conversation (e.g., "as I mentioned", "the person you asked about")
- Provide concise, natural answers using ONLY relevant information
- If memories don't answer the question, say so and mention what you do know
- Don't make up information not in the memories
- Include ONLY the memory numbers you actually used

Return ONLY valid JSON:
{
  "answer": "Your answer here",
  "usedMemories": [1, 3]
}`;

export const RESOLVE_REFERENCES_PROMPT = `Expand pronouns and references in the text using conversation context.

Conversation History:
{HISTORY}

Text to expand: {TEXT}

Instructions:
- Replace pronouns (he, she, they, it, that, this) with specific names/entities from conversation
- Replace vague references ("that guy", "the place", "the thing") with specifics
- Keep the meaning and tone identical
- If a reference is unclear, keep it as-is
- Return ONLY the expanded text, nothing else

Example:
History: "User: Who is John? Assistant: John works at Google."
Text: "He loves coffee"
Output: "John loves coffee"

Return ONLY the expanded text.`;
