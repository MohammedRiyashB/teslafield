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

test("model picker uses authentic provider website logos and never creates initials badges", () => {
  assert.match(app, /model\.id === "teslafield" \? "Teslafield B1"/);
  assert.match(app, /function getModelBrand\(model\)/);
  assert.doesNotMatch(app, /function providerFallbackLogo|fallbackLogo|data:image\/svg\+xml/);
  assert.match(app, /\/api\/v1\/providers\/logo\//);
  for (const provider of ["nvidia\.com", "baidu\.com", "recursive\.ai", "google\.com", "deepseek\.com", "qwen\.ai", "openai\.com", "anthropic\.com"]) {
    assert.match(app, new RegExp(provider));
  }
  assert.match(app, /selectedLogo\.hidden = !brand\.logo/);
  assert.match(app, /logo\.onerror = \(\) => \{ logo\.hidden = true; \}/);
  assert.match(app, /if \(modelBrand\.logo\) \{/);
  assert.match(app, /data\.catalogError/);
  assert.match(app, /OpenRouter returned no eligible chat models/);
  assert.match(app, /Provider models have not loaded yet/);
  assert.doesNotMatch(app, /OPENROUTER · FREE MODELS/);
  assert.doesNotMatch(app, /https:\/\/openrouter\.ai\/favicon\.ico/);
  assert.match(app, /model\.id\.endsWith\(":free"\)/);
  assert.match(app, /"Rate-limited"/);
  assert.doesNotMatch(app, /\.slice\(0, 13\)/);
});

test("backend rejects non-free models and streams the exact OpenRouter model with privacy protections", () => {
  assert.match(backend, /model\.freeTier !== true \|\| !model\.id\.endsWith\(":free"\)/);
  assert.match(backend, /Only OpenRouter models explicitly marked :free are allowed/);
  assert.match(backend, /stream: true/);
  assert.doesNotMatch(backend, /zdr: true/);
  assert.match(backend, /data_collection: "allow"/);
  assert.match(backend, /allow_fallbacks: true/);
  assert.match(backend, /serveProviderLogo/);
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
  assert.match(app, /meta\.textContent = model\.provider === "OpenRouter" \? "Rate-limited" : "TeslafieldAI"/);
  assert.doesNotMatch(app, /FREE · Rate-limited|FREE · TeslafieldAI|option\.textContent = model\.name \+ " · FREE"/);
  assert.doesNotMatch(app, /"Free models only\./);
  assert.match(app, /model\.id\.endsWith\(":free"\)/);
});


test("frontend posts the exact selected model ID and keeps cached models on catalogue errors", () => {
  assert.match(app, /model: userPreferences\.model/);
  assert.match(app, /Only replace the last-known-good cache after a non-empty, healthy free-model refresh/);
  assert.match(app, /if \(data\.catalogAvailable !== false && fetchedProviderModels\.length > 0\)/);
});
