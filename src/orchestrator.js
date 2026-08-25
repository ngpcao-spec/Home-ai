import { plan, deterministicPlan } from "./planner.js";

export async function orchestrate(service, request, { responseMode = process.env.RESPONSE_MODE || "hybrid" } = {}) {
  let selectedPlan;
  let fallbackReason;
  try { selectedPlan = await plan(service, request); } catch (error) { selectedPlan = deterministicPlan(); fallbackReason = error.code || error.message; }
  let response;
  try {
    response = await service.generate({ systemPrompt: "Reply naturally and concisely.", messages: [{ role: "user", content: request }] });
  } catch (error) {
    if (responseMode !== "hybrid") throw error;
    response = "La demande a été traitée de manière déterministe.";
    fallbackReason ||= error.code || error.message;
  }
  return { plan: selectedPlan, response, metadata: service.metadata(fallbackReason ? { fallback: true, fallbackReason } : {}) };
}
