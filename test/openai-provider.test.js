import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider, extractResponseText } from "../src/llm/openai-provider.js";

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test("sends a Responses API request with authorization and JSON format", async () => {
  let call;
  const provider = new OpenAIProvider({ apiKey: "unit-test-secret", model: "test-model", fetchImpl: async (...args) => { call = args; return ok({ output_text: "{}" }); } });
  assert.equal(await provider.generate({ systemPrompt: "system", messages: [{ role: "user", content: "hi" }], responseFormat: "json", temperature: 0 }), "{}");
  assert.equal(call[0], "https://api.openai.com/v1/responses");
  assert.equal(call[1].headers.Authorization, "Bearer unit-test-secret");
  assert.deepEqual(JSON.parse(call[1].body), { model: "test-model", instructions: "system", input: [{ role: "user", content: "hi" }], temperature: 0, text: { format: { type: "json_schema", name: "structured_response", strict: true, schema: { type: "object", additionalProperties: true } } } });
});

test("extracts text from every output content item", () => assert.equal(extractResponseText({ output: [{ content: [{ type: "output_text", text: "one" }] }, { content: [{ type: "output_text", text: "two" }] }] }), "one\ntwo"));
test("rejects malformed output", () => assert.throws(() => extractResponseText({ output: [] }), { code: "LLM_PROVIDER_ERROR" }));
test("rejects missing API key without making a request", async () => assert.rejects(new OpenAIProvider({ apiKey: "", fetchImpl: () => assert.fail() }).generate(), { code: "LLM_PROVIDER_ERROR" }));

for (const [status, message] of [[401, "authentication"], [429, "rate limit"], [500, "unavailable"]]) {
  test(`normalizes HTTP ${status}`, async () => {
    const provider = new OpenAIProvider({ apiKey: "fake", fetchImpl: async () => ({ ok: false, status }) });
    await assert.rejects(provider.generate(), (error) => error.code === "LLM_PROVIDER_ERROR" && error.message.includes(message) && !error.message.includes("fake"));
  });
}

test("normalizes malformed JSON response", async () => {
  const provider = new OpenAIProvider({ apiKey: "fake", fetchImpl: async () => ({ ok: true, json: async () => { throw new Error("bad"); } }) });
  await assert.rejects(provider.generate(), { code: "LLM_PROVIDER_ERROR", message: "OpenAI returned an invalid response." });
});

test("aborts and normalizes timeout", async () => {
  const provider = new OpenAIProvider({ apiKey: "fake", timeoutMs: 1, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error(), { name: "AbortError" })))) });
  await assert.rejects(provider.generate(), { code: "LLM_PROVIDER_ERROR", message: "OpenAI request timed out." });
});

test("normalizes a network failure", async () => {
  const provider = new OpenAIProvider({ apiKey: "fake", fetchImpl: async () => { throw new Error("socket secret details"); } });
  await assert.rejects(provider.generate(), (error) => error.message === "OpenAI network request failed." && !error.message.includes("socket"));
});
