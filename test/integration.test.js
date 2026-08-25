import test from "node:test";
import assert from "node:assert/strict";
import { createLLMProvider } from "../src/llm/provider-factory.js";
import { MockLLMProvider } from "../src/llm/mock-provider.js";
import { LLMService } from "../src/llm/service.js";
import { plan } from "../src/planner.js";
import { orchestrate } from "../src/orchestrator.js";

test("factory defaults to mock", () => assert.ok(createLLMProvider({}) instanceof MockLLMProvider));
test("factory rejects an unknown provider", () => assert.throws(() => createLLMProvider({ LLM_PROVIDER: "other" }), /Unknown LLM provider/));
test("planner rejects invalid JSON", async () => await assert.rejects(plan({ generate: async () => "not json" }, "request"), /invalid JSON/));
test("planner rejects unregistered agents", async () => await assert.rejects(plan({ generate: async () => JSON.stringify({ agent: "intruder", action: "status", parameters: {} }) }, "request"), /invalid plan/));
test("hybrid mode falls back after provider failures", async () => {
  const provider = { name: "openai", model: "test-model", generate: async () => { const error = new Error("failure"); error.code = "LLM_PROVIDER_ERROR"; throw error; } };
  const result = await orchestrate(new LLMService(provider), "status", { responseMode: "hybrid" });
  assert.equal(result.response, "La demande a été traitée de manière déterministe.");
  assert.deepEqual(result.metadata, { provider: "openai", model: "test-model", fallback: true, fallbackReason: "LLM_PROVIDER_ERROR" });
});
test("mock completes planner and response", async () => {
  const result = await orchestrate(new LLMService(new MockLLMProvider()), "status");
  assert.equal(result.metadata.provider, "mock"); assert.equal(result.metadata.fallback, false);
});
