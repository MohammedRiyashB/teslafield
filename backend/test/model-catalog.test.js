"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalizeOpenRouterModel, createOpenRouterCatalog } = require("../model-catalog");

const model = (id, prompt = "0", completion = "0") => ({
  id,
  name: id,
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  pricing: { prompt, completion },
  context_length: 128000
});

test("catalog accepts only :free text models with zero input and output pricing", () => {
  const free = normalizeOpenRouterModel(model("provider/model:free"));
  assert.equal(free.free, true);
  assert.equal(free.freeTier, true);
  assert.equal(normalizeOpenRouterModel(model("provider/zero-price")), null);
  assert.equal(normalizeOpenRouterModel(model("provider/paid:free", "0.000001", "0")), null);
  assert.equal(normalizeOpenRouterModel({
    ...model("provider/image:free"),
    architecture: { input_modalities: ["image"], output_modalities: ["image"] }
  }), null);
  assert.equal(normalizeOpenRouterModel(model("provider/bad:free", "unknown", "0")), null);
});

test("catalog is unavailable without a server-side API key", async () => {
  let calls = 0;
  const catalog = createOpenRouterCatalog({ fetchImpl: async () => { calls += 1; } });
  assert.equal(catalog.configured, false);
  assert.deepEqual(await catalog.listModels(), []);
  assert.equal(await catalog.findModel("openrouter/free"), null);
  assert.equal(calls, 0);
});

test("catalog excludes the five reported non-working free models", () => {
  for (const id of [
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free",
    "inclusionai/ling-3.2-flash:free",
    "liquid/lfm-3.1-1.7b:free",
    "particle-ai/particle-1:free"
  ]) assert.equal(normalizeOpenRouterModel(model(id)), null, id);
  assert.ok(normalizeOpenRouterModel(model("baidu/ernie-5.5-flash-preview:free")));
  assert.ok(normalizeOpenRouterModel(model("nvidia/nemotron-3-ultra:free")));
  assert.ok(normalizeOpenRouterModel(model("recursive/flint-v1.0:free")));
});

test("catalog caches every exact :free model without requiring ZDR", async () => {
  let calls = 0;
  const catalog = createOpenRouterCatalog({
    apiKey: "server-only-test-key",
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.match(url, /openrouter\.ai\/api\/v1\/models\?endpoints=%2Fapi%2Fv1%2Fchat%2Fcompletions$/);
      assert.equal(options.headers.Authorization, "Bearer server-only-test-key");
      return {
        ok: true,
        json: async () => ({ data: [
          model("provider/paid", "0.000001", "0.000002"),
          model("provider/zero-price"),
          model("provider/free:free")
        ] })
      };
    }
  });
  const models = await catalog.listModels();
  assert.equal(models.length, 1);
  assert.equal(models[0].id, "provider/free:free");
  assert.equal(await catalog.findModel("provider/paid"), null);
  assert.equal(calls, 1);
});

test("catalog keeps every eligible :free model without truncation", async () => {
  const data = Array.from({ length: 125 }, (_, index) => model("provider/free-" + index + ":free"));
  data.push(model("provider/paid", "0.000001", "0.000002"));
  data.push(model("provider/zero-price"));
  const catalog = createOpenRouterCatalog({
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: true, json: async () => ({ data }) })
  });
  const models = await catalog.listModels();
  assert.equal(models.length, 125);
  assert.ok(models.every((item) => item.id.endsWith(":free") && item.freeTier === true));
  assert.ok(models.some((item) => item.id === "provider/free-124:free"));
  assert.equal(await catalog.findModel("provider/paid"), null);
});


test("catalog does not cache a transient empty response", async () => {
  let calls = 0;
  const catalog = createOpenRouterCatalog({
    apiKey: "test-key",
    ttlMs: 60000,
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({ data: calls === 1 ? [] : [model("provider/recovered:free")] })
      };
    }
  });

  assert.deepEqual(await catalog.listModels(), []);
  const recovered = await catalog.listModels();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].id, "provider/recovered:free");
  assert.equal(calls, 2);
});
