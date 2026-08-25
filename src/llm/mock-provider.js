export class MockLLMProvider {
  name = "mock";
  model = "deterministic-mock";

  async generate({ responseFormat } = {}) {
    if (responseFormat === "json") {
      return JSON.stringify({ agent: "home", action: "status", parameters: {} });
    }
    return "Votre demande a été traitée par le fournisseur mock.";
  }
}
