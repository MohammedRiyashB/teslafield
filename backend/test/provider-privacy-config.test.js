"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

test("OpenRouter requests retain ZDR and data-collection denial while allowing same-model provider failover", () => {
  assert.match(serverSource, /provider:\s*\{[\s\S]*?zdr:\s*true[\s\S]*?data_collection:\s*"deny"[\s\S]*?allow_fallbacks:\s*true[\s\S]*?\}/);
  assert.doesNotMatch(serverSource, /allow_fallbacks:\s*false/);
  assert.match(serverSource, /stream:\s*true/);
});

test("OpenRouter model requests pass the exact selected model ID", () => {
  assert.match(serverSource, /model:\s*model\.id/);
  assert.doesNotMatch(serverSource, /model:\s*["']openrouter\/free["']/);
});
