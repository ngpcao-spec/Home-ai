export class LLMService {
  constructor(provider) { this.provider = provider; }
  generate(request) { return this.provider.generate(request); }
  metadata(extra = {}) { return { provider: this.provider.name, model: this.provider.model, fallback: false, ...extra }; }
}
