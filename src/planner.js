import { agents, hasAgent } from "./agents/registry.js";

export async function plan(service, request) {
  const catalog = agents.map(({ name, description, capabilities }) => ({ name, description, capabilities }));
  const text = await service.generate({
    systemPrompt: `Choose only an agent from this registry: ${JSON.stringify(catalog)}. Return strict JSON: {"agent":"name","action":"capability","parameters":{}}.`,
    messages: [{ role: "user", content: request }], responseFormat: "json", temperature: 0
  });
  let result;
  try { result = JSON.parse(text); } catch { throw new Error("Planner returned invalid JSON."); }
  const agent = agents.find((entry) => entry.name === result?.agent);
  if (!hasAgent(result?.agent) || !agent.capabilities.includes(result?.action) || typeof result?.parameters !== "object" || result.parameters === null) {
    throw new Error("Planner returned an invalid plan.");
  }
  return result;
}

export function deterministicPlan() { return { agent: "home", action: "status", parameters: {} }; }
