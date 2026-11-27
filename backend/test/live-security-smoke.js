"use strict";

const assert = require("node:assert/strict");

const BASE_URL = (process.env.TESLAFIELD_LIVE_API_BASE || "https://teslafield-api.onrender.com").replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = 10000;

async function request(path, options = {}) {
  return fetch(BASE_URL + path, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
}

async function expectJson(response, expectedStatus, expectedError) {
  assert.equal(response.status, expectedStatus, "Unexpected HTTP status for " + response.url);
  const body = await response.json();
  if (expectedError) assert.equal(body.error, expectedError);
  return body;
}

async function waitForHealth() {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await request("/health");
      if (response.status === 200) {
        const payload = await response.json();
        assert.equal(payload.ok, true);
        return;
      }
      lastError = new Error("Health endpoint returned HTTP " + response.status);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Production health endpoint did not become ready: " + String(lastError));
}

async function main() {
  await waitForHealth();

  const resourceResponse = await request("/.well-known/oauth-protected-resource");
  const resource = await expectJson(resourceResponse, 200);
  assert.equal(resource.resource, BASE_URL + "/mcp");
  assert.ok(Array.isArray(resource.scopes_supported));
  assert.ok(resource.scopes_supported.includes("teslafield:chat"));

  const authorizationResponse = await request("/.well-known/oauth-authorization-server");
  const authorization = await expectJson(authorizationResponse, 200);
  assert.equal(authorization.issuer, BASE_URL);
  assert.ok(authorization.code_challenge_methods_supported.includes("S256"));
  assert.deepEqual(authorization.grant_types_supported, ["authorization_code"]);

  const unauthenticatedChat = await request("/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "security smoke test" }] })
  });
  await expectJson(unauthenticatedChat, 401, "AUTH_REQUIRED");

  const unauthenticatedMcp = await request("/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" }
    })
  });
  assert.equal(unauthenticatedMcp.status, 401);
  assert.match(unauthenticatedMcp.headers.get("www-authenticate") || "", /resource_metadata=/);

  const rejectedOrigin = await request("/health", {
    headers: { Origin: "https://security-smoke.invalid" }
  });
  await expectJson(rejectedOrigin, 403, "ORIGIN_NOT_ALLOWED");

  const malformedAuthorization = await request("/oauth/authorize?response_type=token", {
    redirect: "manual"
  });
  assert.ok([400, 503].includes(malformedAuthorization.status));
  assert.equal(malformedAuthorization.headers.get("location"), null);

  const wrongTokenContentType = await request("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code" })
  });
  assert.ok([415, 503].includes(wrongTokenContentType.status));

  process.stdout.write("PASS: production health, OAuth discovery, unauthenticated API/MCP rejection, CORS and malformed OAuth probes.\n");
}

main().catch((error) => {
  process.stderr.write("FAIL: " + (error && error.stack ? error.stack : String(error)) + "\n");
  process.exitCode = 1;
});
