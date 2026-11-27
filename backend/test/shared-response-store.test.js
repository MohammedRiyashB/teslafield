"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createSharedResponseStore, MAX_SHARED_RESPONSE_BYTES } = require("../shared-response-store");

const id = "a1b2c3d4e5f60718293a4b5c";
const token = "firebase-test-token";
const responseDocument = (content = "Full response") => ({
  fields: {
    id: { stringValue: id },
    ownerUid: { stringValue: "test-user" },
    content: { stringValue: content },
    createdAt: { integerValue: "1760000000000" }
  }
});

test("create stores a complete response with an authenticated Firestore write", async () => {
  let request;
  const store = createSharedResponseStore({
    projectId: "teslafieldai",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ name: "sharedResponses/" + id }) };
    }
  });
  const result = await store.create(id, "test-user", token, "Full response");
  assert.equal(result.id, id);
  assert.match(request.url, /sharedResponses\//);
  assert.equal(request.options.method, "PATCH");
  assert.equal(request.options.headers.Authorization, "Bearer " + token);
  const body = JSON.parse(request.options.body);
  assert.equal(body.fields.content.stringValue, "Full response");
  assert.equal(body.fields.ownerUid.stringValue, "test-user");
});

test("get reads a share by ID without requiring authentication", async () => {
  let request;
  const store = createSharedResponseStore({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => responseDocument() };
    }
  });
  const result = await store.get(id);
  assert.equal(result.id, id);
  assert.equal(result.content, "Full response");
  assert.equal(result.createdAt, 1760000000000);
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(request.options.method, undefined);
});

test("get returns null for an unknown share ID", async () => {
  const store = createSharedResponseStore({
    fetchImpl: async () => ({ ok: false, status: 404 })
  });
  assert.equal(await store.get(id), null);
});

test("create rejects invalid identifiers, empty content and oversized responses", async () => {
  const store = createSharedResponseStore({ fetchImpl: async () => { throw new Error("unexpected fetch"); } });
  await assert.rejects(store.create("bad", "test-user", token, "content"), /INVALID_SHARE_ID/);
  await assert.rejects(store.create(id, "test-user", token, "  "), /INVALID_SHARE_CONTENT/);
  await assert.rejects(store.create(id, "test-user", token, "x".repeat(MAX_SHARED_RESPONSE_BYTES + 1)), /SHARE_CONTENT_TOO_LARGE/);
});

test("get rejects malformed stored documents", async () => {
  const store = createSharedResponseStore({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ fields: {} }) })
  });
  await assert.rejects(store.get(id), /INVALID_STORED_SHARE/);
});
