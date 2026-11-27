"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const app = fs.readFileSync(path.resolve(__dirname, "../../app.js"), "utf8");

function functionSource(name, nextName) {
  const start = app.indexOf("async function " + name + "(");
  const end = app.indexOf("async function " + nextName + "(", start + 1);
  assert.ok(start >= 0 && end > start, "Could not locate " + name + " function");
  return app.slice(start, end);
}

test("sendMessage locks before awaiting Firebase authentication", () => {
  const source = functionSource("sendMessage", "regenerateLast");
  assert.match(source, /if \(!text \|\| generating \|\| sendPending\) return;/);
  const lockAt = source.indexOf("sendPending = true;");
  const authAt = source.indexOf("await requireAuthentication(text)");
  assert.ok(lockAt >= 0 && authAt > lockAt, "The lock must be acquired before the auth await");
  assert.match(source, /finally \{\s*sendPending = false;\s*\}/);
});

test("regenerateLast shares the same in-flight guard", () => {
  const start = app.indexOf("async function regenerateLast()");
  const end = app.indexOf("function renderAttachments()", start + 1);
  assert.ok(start >= 0 && end > start, "Could not locate regenerateLast function");
  const source = app.slice(start, end);
  assert.match(source, /if \(!chat \|\| generating \|\| sendPending\) return;/);
  assert.match(source, /sendPending = true;/);
  assert.match(source, /finally \{\s*sendPending = false;\s*\}/);
});


test("requestReply generates one idempotency key before its retry loop", () => {
  const start = app.indexOf("async function requestReply(chat)");
  const end = app.indexOf("function showGuestContinueCard()", start + 1);
  assert.ok(start >= 0 && end > start, "Could not locate requestReply function");
  const source = app.slice(start, end);
  const keyAt = source.indexOf("const idempotencyKey =");
  const requestAt = source.indexOf('const chatRequest =');
  const retryAt = source.indexOf("for (let attempt = 0; attempt < 3; attempt += 1)");
  assert.ok(keyAt >= 0 && requestAt > keyAt && retryAt > requestAt);
  assert.match(source, /"Idempotency-Key": idempotencyKey/);
});
