"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const backend = fs.readFileSync(path.join(root, "backend/server.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

test("composer exposes the compact branded model capsule and accessible popup", () => {
  assert.match(html, /id="modelPickerButton"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /id="modelPickerPopup"[^>]*hidden/);
  assert.match(html, /id="modelPickerCurrentName">Teslafield B1</);
  assert.match(html, /id="modelSelector"/);
  assert.ok(html.indexOf('id="modelPickerWrap"') < html.indexOf('id="attachmentButton"'));
  assert.ok(!html.includes('id="plusButton"'), "Model capsule replaces the plus control");
});

test("model picker uses OpenRouter's provider registry icons and puts free providers first", () => {
  assert.match(app, /function getModelBrand\(model\)/);
  assert.match(app, /model\.providerSlug/);
  assert.match(app, /model\.providerName/);
  assert.match(app, /model\.providerLogoAvailable/);
  assert.match(app, /model\.providerLogoUrl/);
  assert.match(app, /function setProviderLogoSource\(image, brand\)/);
  assert.match(app, /image\.dataset\.logoProxyAttempted/);
  assert.match(app, /\/api\/v1\/openrouter\/providers\//);
  assert.match(app, /FREE MODELS/);
  assert.match(app, /teslafield\.openrouter\.catalog\.v4/);
  const brandResolver = app.slice(app.indexOf("function getModelBrand"), app.indexOf("function renderModelPicker"));
  assert.doesNotMatch(brandResolver, /nvidia\.com|google\.com|deepseek\.com|qwen\.ai|anthropic\.com/);
  assert.doesNotMatch(brandResolver, /google\.com\/s2\/favicons|\/api\/v1\/providers\/logo\//);
  assert.match(app, /selectedLogo\.hidden = !brand\.logo/);
  assert.match(app, /setProviderLogoSource\(logo, modelBrand\)/);
  assert.match(app, /modelBrand\.logo/);
  assert.match(app, /data\.catalogError/);
  assert.match(app, /FREE · Rate-limited/);
  assert.match(app, /model\.id\.endsWith\(":free"\)/);
});

test("backend wires only the rebuilt OpenRouter integration for catalogue, exact selection and provider icons", () => {
  assert.match(backend, /createOpenRouterIntegration/);
  assert.match(backend, /openRouter\.listFreeChatModels\(\)/);
  assert.match(backend, /openRouter\.findFreeChatModel\(selectedModel\)/);
  assert.match(backend, /openRouter\.serveProviderLogo/);
  assert.match(backend, /model:\s*model\.id/);
  assert.doesNotMatch(backend, /model:\s*["']openrouter\/free["']/);
  assert.match(backend, /stream:\s*true/);
  assert.match(backend, /data_collection:\s*"allow"/);
  assert.match(backend, /allow_fallbacks:\s*true/);
  assert.doesNotMatch(backend, /zdr:\s*true/);
});

test("model picker popup opens above the capsule and supports Escape dismissal", () => {
  assert.match(css, /\.model-picker-popup\{[^}]*bottom:calc\(100% \+ 11px\)/);
  assert.match(app, /event\.key === "Escape" && !\$\("modelPickerPopup"\)\.hidden/);
});

test("cloud history retains local cache and authenticates remote sync", () => {
  assert.match(app, /function syncCloudHistory\(\)/);
  assert.match(app, /function pushCloudHistoryChanges\(\)/);
  assert.match(app, /Authorization: "Bearer " \+ token/);
  assert.match(app, /localStorage\.setItem\(key, JSON\.stringify\(chats\.slice\(0, MAX_HISTORY\)\)\)/);
});

test("Firestore rules restrict conversation reads and writes to the authenticated owner", () => {
  const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
  const firebaseConfig = JSON.parse(fs.readFileSync(path.join(root, "firebase.json"), "utf8"));
  assert.match(rules, /request\.auth\.uid == userId/);
  assert.match(rules, /request\.resource\.data\.id == conversationId/);
  assert.equal(firebaseConfig.firestore.rules, "firestore.rules");
});

test("cloud sync retries for the newly selected account after an in-flight account switch", () => {
  assert.match(app, /if \(currentUser && currentUser !== user\) syncCloudHistory\(\);/);
});



test("model picker renders immediately, shows loading feedback and can retry the catalogue", () => {
  assert.ok(/renderModelPicker\(\);\s*loadModelCatalog\(\);/.test(app), "Picker must render before the network catalogue request");
  assert.match(app, /MODEL_CATALOG_CACHE_KEY/);
  assert.match(app, /readCachedProviderModels\(\)/);
  assert.match(app, /localStorage\.setItem\(MODEL_CATALOG_CACHE_KEY/);
  assert.match(app, /teslafield\.openrouter\.catalog\.v3/);
  assert.match(app, /localStorage\.removeItem\(sourceKey\)/);
  assert.match(app, /Migrate the last-known-good v3 catalogue/);
  assert.doesNotMatch(app, /modelCatalogStatus = hasProviderModels \? "Refreshing models…"/);
  assert.ok(app.includes("AbortSignal.timeout(25000)"));
  assert.ok(app.includes("loadModelCatalog({ force: true })"));
});


test("model picker displays the official provider logo beside each model and keeps rate-limit text", () => {
  assert.match(app, /className = "model-option-logo"/);
  assert.match(app, /modelBrand\.logo/);
  assert.match(app, /modelBrand\.label \+ " official logo"/);
  assert.match(app, /async function consumeChatStream\(response, onText\)/);
  assert.match(app, /payload\.choices\[0\]\.delta/);
  assert.match(app, /meta\.textContent = model\.provider === "OpenRouter" \? "FREE · Rate-limited" : "FREE · TeslafieldAI"/);
  assert.match(app, /FREE · Rate-limited/);
  assert.doesNotMatch(app, /"Free models only\./);
  assert.match(app, /model\.id\.endsWith\(":free"\)/);
  const rowRenderer = app.slice(app.indexOf("function renderModelPicker"), app.indexOf("function openModelPicker"));
  assert.ok(rowRenderer.indexOf("option.append(logo)") < rowRenderer.indexOf("option.append(copy, check)"), "Round provider logo must appear to the left of the model name");
  for (const id of [
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free",
    "inclusionai/ling-3.2-flash:free",
    "recursive/flint-v1.0:free"
  ]) assert.ok(app.includes(id), "Removed model must be blocked in the browser cache");
  assert.match(css, /\.model-option-logo\{[^}]*border-radius:50%/);
});


test("frontend posts the exact selected model ID and keeps cached models on catalogue errors", () => {
  assert.match(app, /model: userPreferences\.model/);
  assert.match(app, /Only replace the last-known-good cache after a non-empty, healthy free-model refresh/);
  assert.match(app, /if \(data\.catalogAvailable !== false && fetchedProviderModels\.length > 0\)/);
});
