"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  OPENROUTER_API,
  OPENROUTER_FRONTEND_API,
  CHAT_ENDPOINT,
  safeProviderLogoUrl,
  normalizeProviderRegistry,
  normalizeFreeChatModel,
  createOpenRouterIntegration
} = require("../openrouter");

function model(id, overrides = {}) {
  return {
    id,
    name: id,
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    endpoints: [CHAT_ENDPOINT, "/api/v1/responses"],
    pricing: { prompt: "0", completion: "0" },
    context_length: 262144,
    ...overrides
  };
}

function response(payload, status = 200, contentType = "application/json") {
  const bytes = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? contentType : null },
    json: async () => JSON.parse(bytes.toString("utf8")),
    arrayBuffer: async () => bytes
  };
}

const registryPayload = {
  data: [
    { slug: "nvidia", name: "NVIDIA", icon: { url: "https://openrouter.ai/images/icons/brands/nvidia.svg?v=0cc710e7" } },
    { slug: "google", name: "Google", icon: { url: "https://t0.gstatic.com/faviconV2?client=OPENROUTER&type=FAVICON&url=https%3A%2F%2Fgoogle.com" } },
    { slug: "deepseek", name: "DeepSeek", icon: { url: "https://untrusted.example/deepseek.svg" } }
  ]
};

test("model discovery refuses to call the authenticated catalogue without a server key", async () => {
  let calls = 0;
  const integration = createOpenRouterIntegration({
    fetchImpl: async () => { calls += 1; throw new Error("Unexpected network call"); }
  });
  assert.equal(integration.configured, false);
  await assert.rejects(integration.listFreeChatModels(), /OPENROUTER_API_KEY_MISSING/);
  assert.equal(calls, 0);
});

test("OpenRouter provider registry reads OpenRouter's own slug, name and icon URL", () => {
  const providers = normalizeProviderRegistry(registryPayload);
  assert.equal(providers.get("nvidia").name, "NVIDIA");
  assert.equal(providers.get("nvidia").logoUrl, "https://openrouter.ai/images/icons/brands/nvidia.svg?v=0cc710e7");
  assert.equal(providers.get("google").logoUrl.startsWith("https://t0.gstatic.com/faviconV2?"), true);
  assert.equal(providers.get("deepseek").logoUrl, null);
  assert.equal(providers.has("nvidi"), false);
});

test("provider logo URLs accept only HTTPS OpenRouter-provided image hosts", () => {
  assert.equal(safeProviderLogoUrl("https://openrouter.ai/images/icons/brands/nvidia.svg?v=0cc710e7"), "https://openrouter.ai/images/icons/brands/nvidia.svg?v=0cc710e7");
  assert.equal(safeProviderLogoUrl("https://t0.gstatic.com/faviconV2?url=https%3A%2F%2Fnvidia.com"), "https://t0.gstatic.com/faviconV2?url=https%3A%2F%2Fnvidia.com");
  assert.equal(safeProviderLogoUrl("https://nvidia.com/favicon.ico"), null);
  assert.equal(safeProviderLogoUrl("http://openrouter.ai/images/icons/NVIDIA.svg"), null);
  assert.equal(safeProviderLogoUrl("javascript:alert(1)"), null);
});

test("free chat normalization includes all :free text chat variants and rejects paid or non-chat entries", () => {
  const providers = normalizeProviderRegistry(registryPayload);
  const nvidia = normalizeFreeChatModel(model("nvidia/nemotron-3.5-lightning:free"), providers);
  assert.equal(nvidia.id, "nvidia/nemotron-3.5-lightning:free");
  assert.equal(nvidia.name, "nvidia/nemotron-3.5-lightning:free");
  assert.equal(nvidia.provider, "OpenRouter");
  assert.equal(nvidia.providerSlug, "nvidia");
  assert.equal(nvidia.providerName, "NVIDIA");
  assert.equal(nvidia.providerLogoAvailable, true);
  assert.equal(nvidia.providerLogoUrl, "https://openrouter.ai/images/icons/brands/nvidia.svg?v=0cc710e7");
  assert.equal(nvidia.freeTier, true);
  assert.equal(nvidia.promptPerMillion, 0);
  assert.equal(normalizeFreeChatModel(model("nvidia/nemotron-paid"), providers), null);
  for (const id of [
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free",
    "inclusionai/ling-3.2-flash:free",
    "recursive/flint-v1.0:free"
  ]) assert.equal(normalizeFreeChatModel(model(id), providers), null, id + " must be excluded");
  for (const id of [
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free",
    "inclusionai/ling-3.2-flash:free",
    "recursive/flint-v1.0:free"
  ]) assert.equal(normalizeFreeChatModel(model(id), providers), null, id + " must be excluded");
  assert.equal(normalizeFreeChatModel(model("nvidia/nemotron-rerank:free", {
    endpoints: ["/api/v1/rerank"]
  }), providers), null);
  assert.equal(normalizeFreeChatModel(model("nvidia/nemotron-image:free", {
    architecture: { input_modalities: ["image"], output_modalities: ["image"] }
  }), providers), null);
});

test("model discovery uses the standard OpenRouter catalogue with the server key and ranks free models first", async () => {
  const catalogItems = [
    model("nvidia/nemotron-3.5-lightning:free", { name: "NVIDIA: Nemotron 3.5 Lightning (free)" }),
    model("nvidia/nemotron-3-ultra-550b-a55b:free", { name: "NVIDIA: Nemotron 3 Ultra (free)" }),
    model("google/gemma-4-26b-a4b-it:free", { name: "Google: Gemma 4 26B A4B (free)" }),
    model("google/gemma-4-31b-it:free", { name: "Google: Gemma 4 31B (free)" }),
    model("inclusionai/ling-3.2-flash:free", { name: "inclusionAI: Ling 3.2 Flash (free)" }),
    model("recursive/flint-v1.0:free", { name: "Recursive: Flint (free)" }),
    model("nvidia/nemotron-paid", { pricing: { prompt: "0.000001", completion: "0.000002" } }),
    model("nvidia/nemotron-embed:free", { endpoints: ["/api/v1/embeddings"] }),
    model("nvidia/nemotron-vision-output:free", {
      architecture: { input_modalities: ["text"], output_modalities: ["image"] }
    })
  ];
  const calls = [];
  const integration = createOpenRouterIntegration({
    apiKey: "server-only-test-key",
    modelTtlMs: 60000,
    providerTtlMs: 60000,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.startsWith(OPENROUTER_API + "/models?")) {
        assert.equal(options.headers.Authorization, "Bearer server-only-test-key");
        return response({ data: catalogItems });
      }
      if (url === OPENROUTER_FRONTEND_API + "/all-providers") {
        assert.equal(options.headers.Authorization, undefined);
        return response(registryPayload);
      }
      throw new Error("Unexpected URL: " + url);
    }
  });

  const models = await integration.listFreeChatModels();
  assert.deepEqual(models.map((item) => item.id), [
    "nvidia/nemotron-3.5-lightning:free",
    "nvidia/nemotron-3-ultra-550b-a55b:free"
  ]);
  assert.equal(models[0].providerLogoAvailable, true);
  assert.equal(models[0].providerLogoUrl, "https://openrouter.ai/images/icons/brands/nvidia.svg?v=0cc710e7");
  assert.equal(models[2].providerName, "Google");
  assert.equal(integration.getDiagnostics().eligibleModelCount, 3);
  assert.equal(integration.getDiagnostics().freeChatModelIds.length, 3);
  assert.equal(calls.some((call) => call.url === OPENROUTER_API + "/models?output_modalities=text&sort=top-weekly"), true);
  assert.equal(calls.some((call) => call.url === OPENROUTER_FRONTEND_API + "/all-providers"), true);
});

test("exact model lookup returns the requested free model and never substitutes another model", async () => {
  const integration = createOpenRouterIntegration({
    apiKey: "server-only-test-key",
    fetchImpl: async (url) => {
      if (url.startsWith(OPENROUTER_API + "/models?")) {
        return response({ data: [
          model("nvidia/nemotron-3.5-lightning:free"),
          model("nvidia/nemotron-3-ultra-550b-a55b:free")
        ] });
      }
      if (url === OPENROUTER_FRONTEND_API + "/all-providers") return response(registryPayload);
      throw new Error("Unexpected URL: " + url);
    }
  });

  assert.equal((await integration.findFreeChatModel("nvidia/nemotron-3-ultra-550b-a55b:free")).id, "nvidia/nemotron-3-ultra-550b-a55b:free");
  assert.equal(await integration.findFreeChatModel("openrouter/free"), null);
  assert.equal(await integration.findFreeChatModel("nvidia/nemotron-paid"), null);
});

test("logo proxy serves only the logo URL provided by OpenRouter's registry", async () => {
  const res = {
    status: 0,
    headers: {},
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };
  let logoRequested = "";
  const integration = createOpenRouterIntegration({
    apiKey: "server-only-test-key",
    fetchImpl: async (url) => {
      if (url.startsWith(OPENROUTER_API + "/models?")) return response({ data: [model("nvidia/nemotron-3.5-lightning:free")] });
      if (url === OPENROUTER_FRONTEND_API + "/all-providers") return response(registryPayload);
      if (url === "https://openrouter.ai/images/icons/brands/nvidia.svg?v=0cc710e7") {
        logoRequested = url;
        return response("<svg/>", 200, "image/svg+xml");
      }
      throw new Error("Unexpected URL: " + url);
    }
  });

  await integration.listFreeChatModels();
  assert.equal(await integration.serveProviderLogo(res, "nvidia"), true);
  assert.equal(logoRequested, "https://openrouter.ai/images/icons/brands/nvidia.svg?v=0cc710e7");
  assert.equal(res.status, 200);
  assert.equal(res.headers["Content-Type"], "image/svg+xml");
  assert.equal(res.body.toString("utf8"), "<svg/>");
  assert.equal(await integration.serveProviderLogo(res, "unknown-provider"), false);
});

test("provider registry failure does not hide free chat models", async () => {
  const integration = createOpenRouterIntegration({
    apiKey: "server-only-test-key",
    fetchImpl: async (url) => {
      if (url.startsWith(OPENROUTER_API + "/models?")) return response({
        data: [model("nvidia/nemotron-3.5-lightning:free")]
      });
      if (url === OPENROUTER_FRONTEND_API + "/all-providers") return response({}, 503);
      throw new Error("Unexpected URL: " + url);
    }
  });

  const models = await integration.listFreeChatModels();
  assert.equal(models.length, 1);
  assert.equal(models[0].providerLogoAvailable, false);
  assert.equal(models[0].providerName, "Nvidia");
});
