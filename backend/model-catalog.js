"use strict";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const CHAT_COMPLETIONS_ENDPOINT = "/api/v1/chat/completions";

function normalizeOpenRouterModel(item) {
  if (!item || typeof item.id !== "string" || !item.id.trim()) return null;
  // The :free catalog suffix is OpenRouter's explicit free-variant marker.
  if (!item.id.endsWith(":free")) return null;

  const architecture = item.architecture || {};
  const inputs = Array.isArray(architecture.input_modalities) ? architecture.input_modalities : [];
  const outputs = Array.isArray(architecture.output_modalities) ? architecture.output_modalities : [];
  if (!inputs.includes("text") || !outputs.includes("text")) return null;

  return {
    id: item.id,
    name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : item.id,
    free: true,
    freeTier: true,
    // OpenRouter's :free catalog variants are zero-cost. Do not use base-model
    // pricing metadata to reject them; the catalog variant itself is authoritative.
    promptPerMillion: 0,
    completionPerMillion: 0,
    contextLength: Number.isFinite(Number(item.context_length)) ? Number(item.context_length) : null
  };
}

function getCatalogDiagnostics(items, normalizedModels) {
  const list = Array.isArray(items) ? items : [];
  const freeVariants = list.filter((item) => item && typeof item.id === "string" && item.id.endsWith(":free"));
  // The catalogue request itself is filtered by the chat-completions endpoint.
  // OpenRouter's ordinary /models records do not consistently embed an endpoints array.
  const freeChatVariants = freeVariants;
  const freeTextChatVariants = freeChatVariants.filter((item) => {
    const architecture = item.architecture || {};
    return Array.isArray(architecture.input_modalities) &&
      architecture.input_modalities.includes("text") &&
      Array.isArray(architecture.output_modalities) &&
      architecture.output_modalities.includes("text");
  });
  return {
    textOutputCatalogCount: list.length,
    freeVariantCount: freeVariants.length,
    freeChatEndpointCount: freeChatVariants.length,
    freeTextChatCandidateCount: freeTextChatVariants.length,
    excludedKnownModelCount: freeTextChatVariants.length - normalizedModels.length,
    eligibleModelCount: normalizedModels.length
  };
}

function createOpenRouterCatalog({ apiKey = "", fetchImpl = fetch, ttlMs = 10 * 60 * 1000 } = {}) {
  let cachedModels = null;
  let cachedAt = 0;
  let pending = null;
  let diagnostics = null;

  async function listModels() {
    if (!apiKey) return [];
    if (cachedModels && Date.now() - cachedAt < ttlMs) return cachedModels;
    if (pending) return pending;
    pending = (async () => {
      // Ask OpenRouter to filter models by the chat-completions endpoint.
      // Do not require item.endpoints locally: the normal /models record can
      // omit that array; endpoint details are a separate API representation.
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
      diagnostics = getCatalogDiagnostics(payload.data, models);

      // Do not cache an empty response: transient upstream or account-policy
      // changes must be retryable on the next catalogue refresh.
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

  function getDiagnostics() {
    return diagnostics;
  }

  return { listModels, findModel, getDiagnostics, configured: Boolean(apiKey) };
}

module.exports = {
  OPENROUTER_BASE_URL,
  normalizeOpenRouterModel,
  getCatalogDiagnostics,
  createOpenRouterCatalog
};
