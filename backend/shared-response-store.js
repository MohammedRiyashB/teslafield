"use strict";

const MAX_SHARED_RESPONSE_BYTES = 700000;
const SHARE_ID_PATTERN = /^[a-f0-9]{24}$/;

function encodeString(value) {
  return { stringValue: value };
}
function encodeInteger(value) {
  return { integerValue: String(Math.trunc(value)) };
}
function decodeValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  return null;
}
function decodeShare(document) {
  const fields = document && document.fields || {};
  const id = decodeValue(fields.id);
  const content = decodeValue(fields.content);
  const createdAt = decodeValue(fields.createdAt);
  if (typeof id !== "string" || !SHARE_ID_PATTERN.test(id) ||
      typeof content !== "string" || !content.trim() ||
      !Number.isFinite(createdAt)) {
    throw new Error("INVALID_STORED_SHARE");
  }
  return { id, content, createdAt };
}

function createSharedResponseStore({ projectId, fetchImpl = fetch } = {}) {
  const root = "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(projectId || "teslafieldai") +
    "/databases/(default)/documents";

  async function request(path, token, options = {}) {
    const { allowNotFound = false, ...fetchOptions } = options;
    let response;
    try {
      response = await fetchImpl(root + path, {
        ...fetchOptions,
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(fetchOptions.body ? { "Content-Type": "application/json" } : {}),
          ...(fetchOptions.headers || {})
        },
        signal: AbortSignal.timeout(15000)
      });
    } catch {
      throw new Error("SHARE_STORAGE_UNAVAILABLE");
    }
    // A missing document is normal only for a GET lookup. Treating a write
    // 404 as success creates a short URL for a document that was never saved.
    if (response.status === 404 && allowNotFound) return null;
    if (!response.ok) {
      const error = new Error("SHARE_STORAGE_REQUEST_FAILED");
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json().catch(() => ({}));
  }

  async function create(id, token, content) {
    if (typeof id !== "string" || !SHARE_ID_PATTERN.test(id) ||
        typeof token !== "string" || !token.trim() || token.length > 8192) {
      throw new Error("INVALID_SHARE_ID");
    }
    if (typeof content !== "string" || !content.trim()) throw new Error("INVALID_SHARE_CONTENT");
    if (Buffer.byteLength(content, "utf8") > MAX_SHARED_RESPONSE_BYTES) throw new Error("SHARE_CONTENT_TOO_LARGE");
    const createdAt = Date.now();
    const fields = {
      id: encodeString(id),
      content: encodeString(content),
      createdAt: encodeInteger(createdAt)
    };
    const mask = Object.keys(fields).map((key) => "updateMask.fieldPaths=" + encodeURIComponent(key)).join("&");
    await request("/sharedResponses/" + encodeURIComponent(id) + "?" + mask, token, {
      method: "PATCH",
      body: JSON.stringify({ fields })
    });

    // Verify the same unauthenticated read used by people opening a shared
    // link. Never return a link until Firestore confirms the document exists
    // and contains the exact response that was submitted.
    const persisted = await get(id);
    if (!persisted || persisted.content !== content) {
      throw new Error("SHARE_WRITE_NOT_VERIFIED");
    }
    return { id, createdAt };
  }

  async function get(id) {
    if (typeof id !== "string" || !SHARE_ID_PATTERN.test(id)) return null;
    const document = await request("/sharedResponses/" + encodeURIComponent(id), null, {
      allowNotFound: true
    });
    if (!document) return null;
    return decodeShare(document);
  }

  return { create, get };
}

module.exports = {
  MAX_SHARED_RESPONSE_BYTES,
  SHARE_ID_PATTERN,
  createSharedResponseStore
};
