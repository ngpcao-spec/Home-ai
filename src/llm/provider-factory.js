import { MockLLMProvider } from "./mock-provider.js";
import { OpenAIProvider } from "./openai-provider.js";

export function createLLMProvider(config = process.env, dependencies = {}) {
  const provider = (config.LLM_PROVIDER || "mock").toLowerCase();
  if (provider === "openai") return new OpenAIProvider({ apiKey: config.OPENAI_API_KEY, model: config.LLM_MODEL, timeoutMs: config.LLM_TIMEOUT_MS, ...dependencies });
  if (provider !== "mock") throw new Error(`Unknown LLM provider: ${provider}`);
  return new MockLLMProvider();
}
