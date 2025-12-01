export const EXTRACTION_PROMPT = `Analyze text and extract structured info.

Text: {TEXT}

Return ONLY valid JSON:
{
  "summary": "Brief 1-2 sentence summary",
  "type": "episodic|semantic|todo|reflection",
  "entities": [
    {"name": "Entity name", "type": "person|place|concept|organization", "context": "optional"}
  ],
  "temporal": {
    "references": ["yesterday", "next week"],
    "timeOfDay": "morning|afternoon|evening|null"
  },
  "metadata": {
    "location": "location if mentioned",
    "activity": "what user was doing",
    "sentiment": "positive|neutral|negative"
  }
}

Types:
- episodic: experiences, events, conversations
- semantic: facts, knowledge
- todo: tasks, commitments
- reflection: thoughts, opinions

Extract ALL people, places, orgs, concepts. Return ONLY JSON, no markdown formatting.`;
