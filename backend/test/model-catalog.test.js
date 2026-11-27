"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  normalizeOpenRouterModel,
  createOpenRouterCatalog,
  CHAT_COMPLETIONS_ENDPOINT
} = require("../model-catalog");

const model = (id, prompt = "0", completion = "0") => ({
  id,
  name: id,
  endpoints: [CHAT_COMPLETIONS_ENDPOINT, "/api/v1/messages"],
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  pricing: { prompt, completion },
  context_length: 128000
});

test("catalog accepts only exact :free text-chat variants", () => {
  const free = normalizeOpenRouterModel(model("provider/model:free"));
  assert.equal(free.free, true);
  assert.equal(free.freeTier, true);
  assert.equal(free.promptPerMillion, 0);
  assert.equal(free.completionPerMillion, 0);
  assert.equal(normalizeOpenRouterModel(model("provider/paid")), null);
  assert.equal(normalizeOpenRouterModel(model("provider/paid:free", "0.000001", "0.000002")).freeTier, true);
});

test("free variant remains eligible if pricing metadata is missing or non-zero", () => {
  const noPriceMetadata = model("provider/no-price-metadata:free");
  delete noPriceMetadata.pricing;
  assert.equal(normalizeOpenRouterModel(noPriceMetadata).id, "provider/no-price-metadata:free");
  assert.equal(normalizeOpenRouterModel(model("provider/base-priced-free:free", "0.00000008", "0.0000002")).free, true);
});

test("catalog requires chat endpoint and text input/output", () => {
  assert.equal(normalizeOpenRouterModel({
    ...model("provider/not-chat:free"),
    endpoints: ["/api/v1/messages"]
  }), null);
  assert.equal(normalizeOpenRouterModel({
    ...model("provider/image-input-only:free"),
    architecture: { input_modalities: ["image"], output_modalities: ["text"] }
  }), null);
  assert.equal(normalizeOpenRouterModel({
    ...model("provider/image-output:free"),
    architecture: { input_modalities: ["text"], output_modalities: ["image"] }
  }), null);
});

test("catalog excludes the five models previously reported as non-working", () => {
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

test("catalog uses standard text-output Models API and filters chat route locally", async () => {
  let calls = 0;
  const catalog = createOpenRouterCatalog({
    apiKey: "server-only-test-key",
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, "https://openrouter.ai/api/v1/models?output_modalities=text");
      assert.equal(options.headers.Authorization, "Bearer server-only-test-key");
      return {
        ok: true,
        json: async () => ({ data: [
          model("provider/paid", "0.000001", "0.000002"),
          model("provider/zero-price-no-free-suffix"),
          model("provider/free:free", "0.00000008", "0.0000002"),
          { ...model("provider/non-chat:free"), endpoints: ["/api/v1/messages"] }
        ] })
      };
    }
  });
  const models = await catalog.listModels();
  assert.equal(models.length, 1);
  assert.equal(models[0].id, "provider/free:free");
  assert.equal(catalog.getDiagnostics().textOutputCatalogCount, 4);
  assert.equal(catalog.getDiagnostics().freeVariantCount, 2);
  assert.equal(catalog.getDiagnostics().freeChatEndpointCount, 1);
  assert.equal(catalog.getDiagnostics().eligibleModelCount, 1);
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

test("catalog exposes diagnostic counts when no eligible models remain", async () => {
  const data = [model("particle-ai/particle-1:free")];
  const catalog = createOpenRouterCatalog({
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: true, json: async () => ({ data }) })
  });
  assert.deepEqual(await catalog.listModels(), []);
  assert.deepEqual(catalog.getDiagnostics(), {
    textOutputCatalogCount: 1,
    freeVariantCount: 1,
    freeChatEndpointCount: 1,
    freeTextChatCandidateCount: 1,
    excludedKnownModelCount: 1,
    eligibleModelCount: 0
  });
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
