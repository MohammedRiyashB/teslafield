"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalizeOpenRouterModel, createOpenRouterCatalog } = require("../model-catalog");

test("catalog normalizes text chat models and computes per-million prices", () => {
  const model = normalizeOpenRouterModel({
    id: "provider/model",
    name: "Provider Model",
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    pricing: { prompt: "0.000002", completion: "0.000008" },
    context_length: 128000
  });
  assert.deepEqual(model, {
    id: "provider/model",
    name: "Provider Model",
    free: false,
    freeTier: false,
    promptPerMillion: 2,
    completionPerMillion: 8,
    contextLength: 128000
  });
});

test("catalog marks zero-priced models free and excludes non-chat or invalid pricing", () => {
  const free = normalizeOpenRouterModel({
    id: "provider/free",
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    pricing: { prompt: "0", completion: "0" }
  });
  assert.equal(free.free, true);
  assert.equal(free.freeTier, false);
  assert.equal(normalizeOpenRouterModel({
    id: "provider/image",
    architecture: { input_modalities: ["image"], output_modalities: ["image"] },
    pricing: { prompt: "0", completion: "0" }
  }), null);
  assert.equal(normalizeOpenRouterModel({
    id: "provider/bad",
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    pricing: { prompt: "unknown", completion: "0" }
  }), null);
});

test("catalog is unavailable without a server-side API key", async () => {
  let calls = 0;
  const catalog = createOpenRouterCatalog({ fetchImpl: async () => { calls += 1; } });
  assert.equal(catalog.configured, false);
  assert.deepEqual(await catalog.listModels(), []);
  assert.equal(await catalog.findModel("openrouter/free"), null);
  assert.equal(calls, 0);
});

test("catalog caches model data and resolves free and paid models", async () => {
  let calls = 0;
  const catalog = createOpenRouterCatalog({
    apiKey: "server-only-test-key",
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.match(url, /openrouter\.ai\/api\/v1\/models$/);
      assert.equal(options.headers.Authorization, "Bearer server-only-test-key");
      return {
        ok: true,
        json: async () => ({ data: [
          { id: "provider/paid", name: "Paid Model", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, pricing: { prompt: "0.000001", completion: "0.000002" } },
          { id: "provider/free", name: "Free Model", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, pricing: { prompt: "0", completion: "0" } }
        ] })
      };
    }
  });
  const models = await catalog.listModels();
  assert.equal(models.length, 2);
  assert.equal(models[0].id, "provider/free");
  assert.equal((await catalog.findModel("provider/paid")).free, false);
  assert.equal((await catalog.findModel("openrouter/free")).free, true);
  assert.equal((await catalog.findModel("openrouter/free")).freeTier, true);
  assert.equal(calls, 1);
});
