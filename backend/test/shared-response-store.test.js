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

test("create stores and publicly verifies a complete response after an authenticated Firestore write", async () => {
  const requests = [];
  const store = createSharedResponseStore({
    projectId: "teslafieldai",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (options.method === "PATCH") {
        return { ok: true, status: 200, json: async () => ({ name: "sharedResponses/" + id }) };
      }
      return { ok: true, status: 200, json: async () => ({
        fields: {
          id: { stringValue: id },
          content: { stringValue: "Full response" },
          createdAt: { integerValue: "1760000000000" }
        }
      }) };
    }
  });
  const result = await store.create(id, token, "Full response");
  assert.equal(result.id, id);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /sharedResponses\//);
  assert.equal(requests[0].options.method, "PATCH");
  assert.equal(requests[0].options.headers.Authorization, "Bearer " + token);
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.fields.content.stringValue, "Full response");
  assert.equal(body.fields.ownerUid, undefined);
  assert.equal(requests[1].options.method, undefined);
  assert.equal(requests[1].options.headers.Authorization, undefined);
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
  await assert.rejects(store.create("bad", token, "content"), /INVALID_SHARE_ID/);
  await assert.rejects(store.create(id, token, "  "), /INVALID_SHARE_CONTENT/);
  await assert.rejects(store.create(id, token, "x".repeat(MAX_SHARED_RESPONSE_BYTES + 1)), /SHARE_CONTENT_TOO_LARGE/);
});

test("get rejects malformed stored documents", async () => {
  const store = createSharedResponseStore({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ fields: {} }) })
  });
  await assert.rejects(store.get(id), /INVALID_STORED_SHARE/);
});

test("create does not report success when Firestore returns 404 for the write", async () => {
  const store = createSharedResponseStore({
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) })
  });
  await assert.rejects(store.create(id, token, "Full response"), (error) => {
    assert.equal(error.message, "SHARE_STORAGE_REQUEST_FAILED");
    assert.equal(error.status, 404);
    return true;
  });
});

test("create does not return a short link when the public read cannot find the saved document", async () => {
  const store = createSharedResponseStore({
    fetchImpl: async (_url, options) => options.method === "PATCH"
      ? { ok: true, status: 200, json: async () => ({ name: "sharedResponses/" + id }) }
      : { ok: false, status: 404, json: async () => ({}) }
  });
  await assert.rejects(store.create(id, token, "Full response"), /SHARE_WRITE_NOT_VERIFIED/);
});
