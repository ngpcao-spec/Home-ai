import { LLMProviderError } from "./errors.js";

const ENDPOINT = "https://api.openai.com/v1/responses";

export function extractResponseText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text;
  const parts = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if ((content?.type === "output_text" || content?.type === "text") && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  if (!parts.length) throw new LLMProviderError("OpenAI returned no usable text.");
  return parts.join("\n");
}

export class OpenAIProvider {
  name = "openai";

  constructor({ apiKey = process.env.OPENAI_API_KEY, model = process.env.LLM_MODEL || "gpt-5.6", timeoutMs = process.env.LLM_TIMEOUT_MS || 10000, fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = Number(timeoutMs);
    this.fetch = fetchImpl;
  }

  async generate({ systemPrompt = "", messages = [], responseFormat, temperature } = {}) {
    if (!this.apiKey) throw new LLMProviderError("OPENAI_API_KEY is required for the OpenAI provider.");
    if (typeof this.fetch !== "function") throw new LLMProviderError("Fetch is unavailable.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number.isFinite(this.timeoutMs) ? this.timeoutMs : 10000);
    const body = { model: this.model, instructions: systemPrompt, input: messages };
    if (temperature !== undefined) body.temperature = temperature;
    if (responseFormat === "json") body.text = { format: { type: "json_schema", name: "structured_response", strict: true, schema: { type: "object", additionalProperties: true } } };
    try {
      const response = await this.fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response?.ok) {
        const messagesByStatus = { 401: "OpenAI authentication failed.", 429: "OpenAI rate limit exceeded." };
        const message = messagesByStatus[response?.status] || (response?.status >= 500 ? "OpenAI service is unavailable." : "OpenAI request failed.");
        throw new LLMProviderError(message);
      }
      let json;
      try { json = await response.json(); } catch { throw new LLMProviderError("OpenAI returned an invalid response."); }
      return extractResponseText(json);
    } catch (error) {
      if (error instanceof LLMProviderError) throw error;
      if (error?.name === "AbortError") throw new LLMProviderError("OpenAI request timed out.");
      throw new LLMProviderError("OpenAI network request failed.", { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
}
