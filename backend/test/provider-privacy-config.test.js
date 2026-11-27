"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

test("OpenRouter requests allow data-collecting providers after user approval and retain same-model provider failover", () => {
  assert.match(serverSource, /provider:\s*\{[\s\S]*?data_collection:\s*"allow"[\s\S]*?allow_fallbacks:\s*true[\s\S]*?\}/);
  assert.doesNotMatch(serverSource, /zdr:\s*true/);
  assert.doesNotMatch(serverSource, /data_collection:\s*"deny"/);
  assert.doesNotMatch(serverSource, /allow_fallbacks:\s*false/);
  assert.match(serverSource, /stream:\s*true/);
});

test("OpenRouter model requests pass the exact selected model ID", () => {
  assert.match(serverSource, /model:\s*model\.id/);
  assert.doesNotMatch(serverSource, /model:\s*["']openrouter\/free["']/);
});
