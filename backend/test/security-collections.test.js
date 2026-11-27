"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { pruneExpiredEntries, hasCapacity } = require("../security-collections");

test("expired limiter and OAuth entries are pruned without evicting active state", () => {
  const entries = new Map([
    ["expired", { resetAt: 10 }],
    ["active", { resetAt: 50 }]
  ]);
  assert.equal(pruneExpiredEntries(entries, 20, "resetAt"), 1);
  assert.equal(entries.has("expired"), false);
  assert.equal(entries.has("active"), true);
});

test("bounded stores report capacity without deleting active entries", () => {
  const entries = new Map([["first", { expiresAt: 100 }], ["second", { expiresAt: 200 }]]);
  assert.equal(hasCapacity(entries, 2), false);
  assert.equal(entries.size, 2);
  assert.equal(entries.has("first"), true);
  assert.equal(entries.has("second"), true);
});
