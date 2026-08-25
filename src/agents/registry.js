export const agents = [{ name: "home", description: "Contrôle et inspecte la maison", capabilities: ["status", "lights"] }];

export function hasAgent(name) { return agents.some((agent) => agent.name === name); }
