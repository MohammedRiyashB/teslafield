"use strict";

const MAX_CONVERSATIONS = 100;
const MAX_MESSAGES = 300;
const MAX_MESSAGE_CHARS = 12000;
const MAX_CONVERSATION_BYTES = 400 * 1024;

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validateConversation(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !safeId(input.id)) {
    throw new Error("INVALID_CONVERSATION");
  }
  if (!Array.isArray(input.messages) || input.messages.length > MAX_MESSAGES) {
    throw new Error("INVALID_CONVERSATION_MESSAGES");
  }
  const messages = input.messages.map((message) => {
    if (!message || !["user", "assistant"].includes(message.role) ||
        typeof message.content !== "string" || message.content.length > MAX_MESSAGE_CHARS) {
      throw new Error("INVALID_CONVERSATION_MESSAGE");
    }
    return {
      role: message.role,
      content: message.content,
      ...(Number.isFinite(message.createdAt) ? { createdAt: message.createdAt } : {})
    };
  });
  const conversation = {
    id: input.id,
    title: typeof input.title === "string" ? input.title.slice(0, 120) : "New chat",
    created: Number.isFinite(input.created) ? input.created : Date.now(),
    updated: Number.isFinite(input.updated) ? input.updated : Date.now(),
    pinned: input.pinned === true,
    messages
  };
  if (Buffer.byteLength(JSON.stringify(conversation), "utf8") > MAX_CONVERSATION_BYTES) {
    throw new Error("CONVERSATION_TOO_LARGE");
  }
  return conversation;
}

function encodeValue(value) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isFinite(value)) return { integerValue: String(Math.trunc(value)) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (value && typeof value === "object") {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)])) } };
  }
  return { nullValue: "NULL_VALUE" };
}

function decodeValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("nullValue" in value) return null;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeValue);
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decodeValue(item)]));
  return null;
}

function decodeDocument(document) {
  const fields = Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decodeValue(value)]));
  return validateConversation({ ...fields, id: fields.id || document.name.split("/").pop() });
}

function createConversationStore({ projectId, fetchImpl = fetch } = {}) {
  const root = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(projectId || "teslafieldai") +
    "/databases/(default)/documents";

  async function request(path, token, options = {}) {
    if (!token || typeof token !== "string" || token.length > 8192) throw new Error("FIRESTORE_AUTH_REQUIRED");
    let response;
    try {
      response = await fetchImpl(root + path, {
        ...options,
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {})
        },
        signal: AbortSignal.timeout(15000)
      });
    } catch {
      throw new Error("FIRESTORE_UNAVAILABLE");
    }
    if (!response.ok) {
      const error = new Error("FIRESTORE_REQUEST_FAILED");
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    return response.json().catch(() => ({}));
  }

  function collectionPath(uid) {
    return "/users/" + encodeURIComponent(uid) + "/conversations";
  }

  function deletedCollectionPath(uid) {
    return "/users/" + encodeURIComponent(uid) + "/deletedConversations";
  }

  async function listDeleted(uid, token) {
    if (!safeId(uid)) throw new Error("INVALID_USER_ID");
    const results = [];
    let pageToken = "";
    // Tombstones are intentionally retained so stale offline devices cannot resurrect deleted chats.
    do {
      const query = "?pageSize=500" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
      const payload = await request(deletedCollectionPath(uid) + query, token);
      for (const document of Array.isArray(payload.documents) ? payload.documents : []) {
        const fields = Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decodeValue(value)]));
        const item = { id: fields.id || document.name.split("/").pop(), deletedAt: Number(fields.deletedAt || 0) };
        if (safeId(item.id)) results.push(item);
      }
      pageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : "";
    } while (pageToken && results.length < 10000);
    return results;
  }

  async function writeTombstone(uid, token, id) {
    const fields = { id: encodeValue(id), deletedAt: encodeValue(Date.now()) };
    await request(deletedCollectionPath(uid) + "/" + encodeURIComponent(id), token, {
      method: "PATCH",
      body: JSON.stringify({ fields })
    });
  }

  async function list(uid, token) {
    if (!safeId(uid)) throw new Error("INVALID_USER_ID");
    const payload = await request(collectionPath(uid) + "?pageSize=" + MAX_CONVERSATIONS, token);
    return (Array.isArray(payload.documents) ? payload.documents : [])
      .map(decodeDocument)
      .sort((a, b) => b.updated - a.updated)
      .slice(0, MAX_CONVERSATIONS);
  }

  async function upsert(uid, token, input) {
    if (!safeId(uid)) throw new Error("INVALID_USER_ID");
    const conversation = validateConversation(input);
    const fields = Object.fromEntries(Object.entries(conversation).map(([key, value]) => [key, encodeValue(value)]));
    const mask = Object.keys(fields).map((key) => "updateMask.fieldPaths=" + encodeURIComponent(key)).join("&");
    await request(collectionPath(uid) + "/" + encodeURIComponent(conversation.id) + "?" + mask, token, {
      method: "PATCH",
      body: JSON.stringify({ fields })
    });
    // A deliberate save of this ID is the only operation that clears its delete marker.
    await request(deletedCollectionPath(uid) + "/" + encodeURIComponent(conversation.id), token, { method: "DELETE" }).catch((error) => {
      if (error.status !== 404) throw error;
    });
    return conversation;
  }

  async function remove(uid, token, id) {
    if (!safeId(uid) || !safeId(id)) throw new Error("INVALID_CONVERSATION_ID");
    // Write the tombstone first so another device cannot resurrect a stale local copy.
    await writeTombstone(uid, token, id);
    await request(collectionPath(uid) + "/" + encodeURIComponent(id), token, { method: "DELETE" }).catch((error) => {
      if (error.status !== 404) throw error;
    });
    return true;
  }

  return { list, listDeleted, upsert, remove };
}

module.exports = {
  MAX_CONVERSATIONS,
  MAX_MESSAGES,
  safeId,
  validateConversation,
  encodeValue,
  decodeValue,
  decodeDocument,
  createConversationStore
};
