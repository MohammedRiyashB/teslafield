"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
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

test("model picker puts Teslafield B1 first and shows OpenRouter branding and model names", () => {
  assert.match(app, /model\.id === "teslafield" \? "Teslafield B1"/);
  assert.match(app, /https:\/\/openrouter\.ai\/favicon\.ico/);
  assert.match(app, /OPENROUTER · FREE MODELS/);
  assert.match(app, /OPENROUTER · PAID MODELS/);
  assert.match(app, /\.slice\(0, 13\)/);
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
