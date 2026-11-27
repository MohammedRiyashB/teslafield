"use strict";

const OPENROUTER_API = "https://openrouter.ai/api/v1";
const OPENROUTER_FRONTEND_API = "https://openrouter.ai/api/frontend/v1";
const CHAT_ENDPOINT = "/api/v1/chat/completions";
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const PROVIDER_CACHE_TTL_MS = 60 * 60 * 1000;
const PROVIDER_FAILURE_RETRY_MS = 5 * 60 * 1000;
const MAX_LOGO_BYTES = 256 * 1024;
const ALLOWED_LOGO_HOSTS = new Set(["openrouter.ai", "t0.gstatic.com"]);
const REMOVED_FREE_CHAT_MODEL_IDS = new Set([
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "inclusionai/ling-3.2-flash:free",
  "recursive/flint-v1.0:free"
]);

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeProviderLogoUrl(value) {
  const raw = asText(value);
  if (!raw) return null;

  let url;
  try {
    url = new URL(raw, "https://openrouter.ai");
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || (url.port && url.port !== "443") || !ALLOWED_LOGO_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (url.hostname.toLowerCase() === "openrouter.ai" &&
      !/^\/images\/(icons|models)\//.test(url.pathname)) return null;
  if (url.hostname.toLowerCase() === "t0.gstatic.com" && !url.pathname.startsWith("/faviconV2")) return null;

  return url.href;
}

function providerSlugFromModelId(modelId) {
  const value = asText(modelId);
  const slash = value.indexOf("/");
  return slash > 0 ? value.slice(0, slash).toLowerCase() : "";
}

function formatProviderLabel(slug) {
  return asText(slug).replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "AI Provider";
}

function normalizeProviderRegistry(payload) {
  const entries = payload && Array.isArray(payload.data) ? payload.data : null;
  if (!entries) {
    const error = new Error("OPENROUTER_PROVIDER_REGISTRY_INVALID");
    error.code = error.message;
    throw error;
  }

  const providers = new Map();
  for (const item of entries) {
    if (!item || typeof item !== "object") continue;
    const slug = asText(item.slug).toLowerCase();
    if (!slug) continue;

    const rawIcon = typeof item.icon === "string"
      ? item.icon
      : item.icon && typeof item.icon === "object"
        ? item.icon.url
        : "";
    const logoUrl = safeProviderLogoUrl(rawIcon);
    const provider = {
      slug,
      name: asText(item.name) || formatProviderLabel(slug),
      logoUrl
    };

    providers.set(slug, provider);
    const compactSlug = slug.replace(/-/g, "");
    if (compactSlug && compactSlug !== slug && !providers.has(compactSlug)) {
      providers.set(compactSlug, provider);
    }
  }

  return providers;
}

function normalizeFreeChatModel(item, providers) {
  if (!item || typeof item.id !== "string" || !item.id.trim()) return null;
  if (!item.id.endsWith(":free")) return null;

  const endpoints = Array.isArray(item.endpoints) ? item.endpoints : [];
  if (!endpoints.includes(CHAT_ENDPOINT)) return null;

  const architecture = item.architecture && typeof item.architecture === "object" ? item.architecture : {};
  const inputs = Array.isArray(architecture.input_modalities) ? architecture.input_modalities : [];
  const outputs = Array.isArray(architecture.output_modalities) ? architecture.output_modalities : [];
  if (!inputs.includes("text") || !outputs.includes("text")) return null;

  const providerSlug = providerSlugFromModelId(item.id);
  const provider = providers.get(providerSlug) || providers.get(providerSlug.replace(/-/g, ""));
  return {
    id: item.id,
    name: asText(item.name) || item.id,
    free: true,
    freeTier: true,
    provider: "OpenRouter",
    providerSlug,
    providerName: provider ? provider.name : formatProviderLabel(providerSlug),
    providerLogoAvailable: Boolean(provider && provider.logoUrl),
    promptPerMillion: 0,
    completionPerMillion: 0,
    contextLength: Number.isFinite(item.context_length) ? item.context_length : null
  };
}

function buildCatalogDiagnostics(items, models, providerCount) {
  const list = Array.isArray(items) ? items : [];
  const chatModels = list.filter((item) =>
    item && Array.isArray(item.endpoints) && item.endpoints.includes(CHAT_ENDPOINT)
  );
  const freeVariants = list.filter((item) =>
    item && typeof item.id === "string" && item.id.endsWith(":free")
  );
  const freeChatCandidates = list.filter((item) =>
    item &&
    typeof item.id === "string" &&
    item.id.endsWith(":free") &&
    Array.isArray(item.endpoints) &&
    item.endpoints.includes(CHAT_ENDPOINT) &&
    item.architecture &&
    Array.isArray(item.architecture.input_modalities) &&
    item.architecture.input_modalities.includes("text") &&
    Array.isArray(item.architecture.output_modalities) &&
    item.architecture.output_modalities.includes("text")
  );

  return {
    source: "openrouter-public-models-api",
    sort: "top-weekly",
    totalModelCount: list.length,
    chatEndpointModelCount: chatModels.length,
    freeVariantCount: freeVariants.length,
    freeChatCandidateCount: freeChatCandidates.length,
    eligibleModelCount: models.length,
    providerRegistryCount: providerCount,
    providerLogoCount: models.filter((model) => model.providerLogoAvailable).length,
    freeChatModelIds: models.map((model) => model.id)
  };
}

function createOpenRouterIntegration({
  apiKey = "",
  fetchImpl = fetch,
  modelTtlMs = MODEL_CACHE_TTL_MS,
  providerTtlMs = PROVIDER_CACHE_TTL_MS,
  providerFailureRetryMs = PROVIDER_FAILURE_RETRY_MS
} = {}) {
  let cachedCatalogItems = null;
  let catalogExpiresAt = 0;
  let catalogPending = null;
  let cachedProviders = null;
  let providersExpiresAt = 0;
  let providersPending = null;
  let diagnostics = null;

  async function loadPublicModelCatalog() {
    if (cachedCatalogItems && Date.now() < catalogExpiresAt) return cachedCatalogItems;
    if (catalogPending) return catalogPending;

    catalogPending = (async () => {
      if (!asText(apiKey)) {
        const error = new Error("OPENROUTER_API_KEY_MISSING");
        error.code = error.message;
        throw error;
      }
      // Use the standard catalogue, not /models/user: the latter applies
      // account privacy preferences and guardrails to model discovery.
      // The credential remains server-side and is never sent to the browser.
      const url = OPENROUTER_API + "/models?output_modalities=text&sort=top-weekly";
      const response = await fetchImpl(url, {
        headers: {
          Authorization: "Bearer " + apiKey,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) {
        const error = new Error("OPENROUTER_MODELS_HTTP_" + response.status);
        error.code = error.message;
        throw error;
      }

      const payload = await response.json();
      if (!payload || !Array.isArray(payload.data)) {
        const error = new Error("OPENROUTER_MODELS_INVALID");
        error.code = error.message;
        throw error;
      }

      cachedCatalogItems = payload.data;
      catalogExpiresAt = Date.now() + modelTtlMs;
      return cachedCatalogItems;
    })();

    try {
      return await catalogPending;
    } finally {
      catalogPending = null;
    }
  }

  async function loadProviderRegistry() {
    if (cachedProviders && Date.now() < providersExpiresAt) return cachedProviders;
    if (providersPending) return providersPending;

    providersPending = (async () => {
      const response = await fetchImpl(OPENROUTER_FRONTEND_API + "/all-providers", {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) {
        const error = new Error("OPENROUTER_PROVIDER_REGISTRY_HTTP_" + response.status);
        error.code = error.message;
        throw error;
      }

      const registry = normalizeProviderRegistry(await response.json());
      cachedProviders = registry;
      providersExpiresAt = Date.now() + providerTtlMs;
      return registry;
    })();

    try {
      return await providersPending;
    } catch (error) {
      // Keep the previous known-good registry on transient failures and retry sooner.
      if (!cachedProviders) cachedProviders = new Map();
      providersExpiresAt = Date.now() + providerFailureRetryMs;
      return cachedProviders;
    } finally {
      providersPending = null;
    }
  }

  async function listFreeChatModels() {
    if (!asText(apiKey)) {
      const error = new Error("OPENROUTER_API_KEY_MISSING");
      error.code = error.message;
      throw error;
    }

    const [items, providers] = await Promise.all([
      loadPublicModelCatalog(),
      loadProviderRegistry()
    ]);

    const models = items
      .map((item) => normalizeFreeChatModel(item, providers))
      .filter(Boolean);

    // The upstream API's top-weekly ordering is retained so popular free models,
    // including active NVIDIA Nemotron variants, appear near the top.
    const uniqueProviders = new Set(Array.from(providers.values(), (provider) => provider.slug));
    diagnostics = buildCatalogDiagnostics(items, models, uniqueProviders.size);
    return models;
  }

  async function findFreeChatModel(id) {
    if (typeof id !== "string" || !id.trim()) return null;
    const models = await listFreeChatModels();
    return models.find((model) => model.id === id) || null;
  }

  async function serveProviderLogo(res, slug) {
    const key = typeof slug === "string" ? slug.toLowerCase() : "";
    if (!/^[a-z0-9-]{1,64}$/.test(key)) return false;

    const providers = await loadProviderRegistry();
    const provider = providers.get(key) || providers.get(key.replace(/-/g, ""));
    const logoUrl = provider && provider.logoUrl;
    if (!logoUrl) return false;

    let upstream;
    try {
      upstream = await fetchImpl(logoUrl, {
        headers: { Accept: "image/svg+xml,image/png,image/webp,image/jpeg,image/*;q=0.8" },
        signal: AbortSignal.timeout(8000)
      });
    } catch {
      res.writeHead(502, { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" });
      res.end();
      return true;
    }

    const contentType = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!upstream.ok || !contentType.startsWith("image/")) {
      res.writeHead(502, { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" });
      res.end();
      return true;
    }

    let bytes;
    try {
      bytes = Buffer.from(await upstream.arrayBuffer());
    } catch {
      res.writeHead(502, { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" });
      res.end();
      return true;
    }

    if (!bytes.length || bytes.length > MAX_LOGO_BYTES) {
      res.writeHead(502, { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" });
      res.end();
      return true;
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": bytes.length,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin"
    });
    res.end(bytes);
    return true;
  }

  function getDiagnostics() {
    return diagnostics;
  }

  return {
    configured: Boolean(asText(apiKey)),
    listFreeChatModels,
    findFreeChatModel,
    getDiagnostics,
    serveProviderLogo
  };
}

module.exports = {
  OPENROUTER_API,
  OPENROUTER_FRONTEND_API,
  CHAT_ENDPOINT,
  safeProviderLogoUrl,
  normalizeProviderRegistry,
  normalizeFreeChatModel,
  buildCatalogDiagnostics,
  createOpenRouterIntegration
};
