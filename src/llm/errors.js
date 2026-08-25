export class LLMProviderError extends Error {
  constructor(message, { provider = "openai", cause } = {}) {
    super(message, { cause });
    this.name = "LLMProviderError";
    this.code = "LLM_PROVIDER_ERROR";
    this.provider = provider;
  }

  toJSON() {
    return { code: this.code, provider: this.provider, message: this.message };
  }
}
