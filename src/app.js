import { agents } from "./agents/registry.js";
import { createLLMProvider } from "./llm/provider-factory.js";
import { LLMService } from "./llm/service.js";
import { orchestrate } from "./orchestrator.js";

export function createApp({ config = process.env, fetchImpl } = {}) {
  const service = new LLMService(createLLMProvider(config, fetchImpl ? { fetchImpl } : {}));
  return async function handler(req, res) {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && req.url === "/health") return res.end(JSON.stringify({ status: "ok" }));
    if (req.method === "GET" && req.url === "/api/v1/agents") return res.end(JSON.stringify({ agents }));
    if (req.method === "POST" && req.url === "/api/v1/orchestrate") {
      try {
        let raw = ""; for await (const chunk of req) raw += chunk;
        const body = raw ? JSON.parse(raw) : {};
        return res.end(JSON.stringify(await orchestrate(service, body.request || "", { responseMode: config.RESPONSE_MODE })));
      } catch (error) { res.statusCode = 400; return res.end(JSON.stringify({ error: { code: error.code || "BAD_REQUEST", message: error.message } })); }
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }));
  };
}
