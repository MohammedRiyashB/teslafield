"use strict";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const FREE_ROUTER_MODEL = "openrouter/free";

function pricePerMillion(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : null;
}

function normalizeOpenRouterModel(item) {
  if (!item || typeof item.id !== "string" || !item.id.trim()) return null;
  const architecture = item.architecture || {};
  const inputs = Array.isArray(architecture.input_modalities) ? architecture.input_modalities : [];
  const outputs = Array.isArray(architecture.output_modalities) ? architecture.output_modalities : [];
  if (!inputs.includes("text") || !outputs.includes("text")) return null;
  const pricing = item.pricing || {};
  const prompt = Number(pricing.prompt);
  const completion = Number(pricing.completion);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) return null;
  const free = prompt === 0 && completion === 0;
  return {
    id: item.id,
    name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : item.id,
    free,
    freeTier: item.id.endsWith(":free"),
    promptPerMillion: pricePerMillion(prompt),
    completionPerMillion: pricePerMillion(completion),
    contextLength: Number.isFinite(Number(item.context_length)) ? Number(item.context_length) : null
  };
}

function createOpenRouterCatalog({ apiKey = "", fetchImpl = fetch, ttlMs = 10 * 60 * 1000 } = {}) {
  let cachedModels = null;
  let cachedAt = 0;
  let pending = null;

  async function listModels() {
    if (!apiKey) return [];
    if (cachedModels && Date.now() - cachedAt < ttlMs) return cachedModels;
    if (pending) return pending;
    pending = (async () => {
      const response = await fetchImpl(OPENROUTER_BASE_URL + "/models", {
        headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error("OPENROUTER_CATALOG_UNAVAILABLE");
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.data)) throw new Error("OPENROUTER_CATALOG_INVALID");
      const models = payload.data.map(normalizeOpenRouterModel).filter(Boolean);
      models.sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name));
      const freeModels = models.filter((model) => model.free).slice(0, 50);
      const paidModels = models.filter((model) => !model.free).slice(0, 100);
      cachedModels = freeModels.concat(paidModels);
      cachedAt = Date.now();
      return cachedModels;
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  }

  async function findModel(id) {
    if (id === FREE_ROUTER_MODEL) {
      if (!apiKey) return null;
      return { id: FREE_ROUTER_MODEL, name: "OpenRouter Free Auto", free: true, freeTier: true, promptPerMillion: 0, completionPerMillion: 0 };
    }
    const models = await listModels();
    return models.find((model) => model.id === id) || null;
  }

  return { listModels, findModel, configured: Boolean(apiKey) };
}

module.exports = {
  OPENROUTER_BASE_URL,
  FREE_ROUTER_MODEL,
  normalizeOpenRouterModel,
  createOpenRouterCatalog
};
