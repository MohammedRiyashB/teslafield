"use strict";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

function pricePerMillion(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000_000 : null;
}

function normalizeOpenRouterModel(item) {
  if (!item || typeof item.id !== "string" || !item.id.trim()) return null;
  // OpenRouter's :free catalog variant is the authoritative free-tier marker.
  // Its API pricing metadata can still contain the paid base-model token price.
  if (!item.id.endsWith(":free")) return null;
  const identity = (item.id + " " + (typeof item.name === "string" ? item.name : "")).toLowerCase();
  if (/(gemma[- ]4[- ]26b[- ]a4b|gemma[- ]4[- ]31b|ling[- ]3[.]2[- ]flash|lfm.*1[.]7b|particle[- ]1)/i.test(identity)) return null;
  const architecture = item.architecture || {};
  const inputs = Array.isArray(architecture.input_modalities) ? architecture.input_modalities : [];
  const outputs = Array.isArray(architecture.output_modalities) ? architecture.output_modalities : [];
  if (!inputs.includes("text") || !outputs.includes("text")) return null;
  const pricing = item.pricing || {};
  const prompt = Number(pricing.prompt);
  const completion = Number(pricing.completion);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) return null;
  return {
    id: item.id,
    name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : item.id,
    free: true,
    freeTier: true,
    // A :free variant is not billed at the base model's listed token price.
    promptPerMillion: 0,
    completionPerMillion: 0,
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
      const response = await fetchImpl(OPENROUTER_BASE_URL + "/models?endpoints=%2Fapi%2Fv1%2Fchat%2Fcompletions", {
        headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        const error = new Error("OPENROUTER_CATALOG_HTTP_" + response.status);
        error.code = "OPENROUTER_CATALOG_HTTP_" + response.status;
        throw error;
      }
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.data)) throw new Error("OPENROUTER_CATALOG_INVALID");
      const models = payload.data.map(normalizeOpenRouterModel).filter(Boolean);
      models.sort((a, b) => a.name.localeCompare(b.name));
      // Do not cache an empty response: a transient upstream/catalogue issue must be retryable.
      if (models.length > 0) {
        cachedModels = models;
        cachedAt = Date.now();
      } else {
        cachedModels = null;
        cachedAt = 0;
      }
      return models;
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  }

  async function findModel(id) {
    const models = await listModels();
    return models.find((model) => model.id === id) || null;
  }

  return { listModels, findModel, configured: Boolean(apiKey) };
}

module.exports = {
  OPENROUTER_BASE_URL,
  normalizeOpenRouterModel,
  createOpenRouterCatalog
};
