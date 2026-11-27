"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  safeId,
  validateConversation,
  encodeValue,
  decodeValue,
  createConversationStore
} = require("../conversation-store");

test("conversation validation enforces safe IDs, message roles and size limits", () => {
  assert.equal(safeId("chat_123-abc"), true);
  assert.equal(safeId("../other-user"), false);
  const valid = validateConversation({
    id: "chat_123",
    title: "A chat",
    created: 10,
    updated: 20,
    pinned: true,
    messages: [{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi" }]
  });
  assert.equal(valid.messages.length, 2);
  assert.throws(() => validateConversation({ id: "../bad", messages: [] }), /INVALID_CONVERSATION/);
  assert.throws(() => validateConversation({ id: "valid", messages: [{ role: "system", content: "no" }] }), /INVALID_CONVERSATION_MESSAGE/);
});

test("Firestore values round-trip nested conversation messages", () => {
  const value = { id: "chat_1", pinned: true, updated: 42, messages: [{ role: "user", content: "வணக்கம்" }] };
  assert.deepEqual(decodeValue(encodeValue(value)), value);
});

test("cloud history store scopes every document path to the authenticated UID", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "PATCH" || options.method === "DELETE") {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url.includes("/deletedConversations")) {
      return { ok: true, status: 200, json: async () => ({ documents: [{ name: "deletedConversations/chat_old", fields: { id: { stringValue: "chat_old" }, deletedAt: { integerValue: "99" } } }] }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        documents: [{
          name: "projects/teslafieldai/databases/(default)/documents/users/user_123/conversations/chat_1",
          fields: {
            id: { stringValue: "chat_1" },
            title: { stringValue: "A chat" },
            created: { integerValue: "10" },
            updated: { integerValue: "20" },
            pinned: { booleanValue: true },
            messages: { arrayValue: { values: [{ mapValue: { fields: {
              role: { stringValue: "user" }, content: { stringValue: "Hello" }
            } } }] } }
          }
        }]
      })
    };
  };
  const store = createConversationStore({ projectId: "teslafieldai", fetchImpl });
  const listed = await store.list("user_123", "firebase-id-token");
  assert.equal(listed[0].id, "chat_1");
  assert.match(calls[0].url, /users\/user_123\/conversations/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer firebase-id-token");

  await store.upsert("user_123", "firebase-id-token", {
    id: "chat_2", title: "Second", created: 30, updated: 40, messages: [{ role: "user", content: "Hi" }]
  });
  assert.equal(calls[1].options.method, "PATCH");
  assert.match(calls[1].url, /users\/user_123\/conversations\/chat_2/);

  await store.remove("user_123", "firebase-id-token", "chat_2");
  assert.equal(calls[2].options.method, "DELETE");
  assert.match(calls[2].url, /users\/user_123\/conversations\/chat_2$/);
});

test("cloud history rejects unsafe UID and conversation IDs before network access", async () => {
  let called = false;
  const store = createConversationStore({ projectId: "teslafieldai", fetchImpl: async () => { called = true; } });
  await assert.rejects(store.list("../attacker", "token"), /INVALID_USER_ID/);
  await assert.rejects(store.remove("user_1", "token", "../other"), /INVALID_CONVERSATION_ID/);
  assert.equal(called, false);
});
