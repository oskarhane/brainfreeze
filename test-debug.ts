import { ClaudeClient } from "./src/ai/claude";
import { loadConfig } from "./src/core/config";

const config = loadConfig();
const claude = new ClaudeClient(config.anthropic.apiKey, config.anthropic.model);

const testName = `Test${Date.now()}AliceAnderson`;
const result = await claude.extract(`${testName} joined the team`);
console.log("Extracted entities:", JSON.stringify(result.entities, null, 2));
