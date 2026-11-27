"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

test("OpenRouter requests enforce ZDR, deny non-transient collection and disable provider fallback", () => {
  assert.match(serverSource, /provider:\s*\{[\s\S]*?zdr:\s*true[\s\S]*?data_collection:\s*"deny"[\s\S]*?allow_fallbacks:\s*false[\s\S]*?\}/);
});

test("OpenRouter model requests pass the exact selected model ID", () => {
  assert.match(serverSource, /model:\s*model\.id/);
  assert.doesNotMatch(serverSource, /model:\s*["']openrouter\/free["']/);
});
