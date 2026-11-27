"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const net = require("node:net");
const path = require("node:path");
const { after, before, test } = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");
const apiRoot = path.join(projectRoot, "backend");
const trustedOrigin = "https://teslafieldai.web.app";
let child;
let baseUrl;
let childOutput = "";

async function getFreePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = address.port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

before(async () => {
  const port = await getFreePort();
  baseUrl = "http://127.0.0.1:" + port;
  child = spawn(process.execPath, [path.join(apiRoot, "server.js")], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(port),
      CORS_ORIGIN: trustedOrigin,
      FIREBASE_PROJECT_ID: "teslafieldai",
      OPENROUTER_API_KEY: "",
      PUBLIC_BASE_URL: "https://teslafield-api.onrender.com",
      TESLAFIELD_OAUTH_SECRET: "test-only-secret-value-with-more-than-32-characters"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });

  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(baseUrl + "/health", { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, "API failed to start. Output: " + childOutput);
});

after(async () => {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
});

test("health endpoint reports the API process is alive", async () => {
  const response = await fetch(baseUrl + "/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "teslafield-api" });
});

test("CORS allows the configured TeslafieldAI web origin", async () => {
  const response = await fetch(baseUrl + "/health", {
    headers: { Origin: trustedOrigin }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), trustedOrigin);
});

test("CORS preflight allows the browser idempotency request header", async () => {
  const response = await fetch(baseUrl + "/api/v1/chat/completions", {
    method: "OPTIONS",
    headers: {
      Origin: trustedOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,authorization,idempotency-key"
    }
  });
  assert.equal(response.status, 204);
  const allowedHeaders = response.headers.get("access-control-allow-headers") || "";
  assert.match(allowedHeaders.toLowerCase(), /idempotency-key/);
});

test("CORS rejects an untrusted origin", async () => {
  const response = await fetch(baseUrl + "/health", {
    headers: { Origin: "https://attacker.invalid" }
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "ORIGIN_NOT_ALLOWED");
});

test("chat completion endpoint requires Firebase authentication", async () => {
  const response = await fetch(baseUrl + "/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "test" }] })
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "AUTH_REQUIRED");
});

test("chat stream endpoint also requires Firebase authentication", async () => {
  const response = await fetch(baseUrl + "/api/v1/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "test" }] })
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "AUTH_REQUIRED");
});

test("OAuth discovery advertises the protected MCP resource and PKCE S256", async () => {
  const [resourceResponse, authorizationResponse] = await Promise.all([
    fetch(baseUrl + "/.well-known/oauth-protected-resource"),
    fetch(baseUrl + "/.well-known/oauth-authorization-server")
  ]);
  assert.equal(resourceResponse.status, 200);
  assert.equal(authorizationResponse.status, 200);
  const resource = await resourceResponse.json();
  const authorization = await authorizationResponse.json();
  assert.equal(resource.resource, "https://teslafield-api.onrender.com/mcp");
  assert.ok(resource.scopes_supported.includes("teslafield:chat"));
  assert.ok(authorization.code_challenge_methods_supported.includes("S256"));
  assert.equal(authorization.client_id_metadata_document_supported, true);
});

test("MCP initialize rejects an unauthenticated client with resource metadata challenge", async () => {
  const response = await fetch(baseUrl + "/mcp", {
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
  assert.equal(response.status, 401);
  const challenge = response.headers.get("www-authenticate") || "";
  assert.ok(
    challenge.includes("https://teslafield-api.onrender.com/.well-known/oauth-protected-resource"),
    "Missing protected-resource metadata challenge: " + challenge
  );
});


test("Firebase rejects a token issued for a different project", async () => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const token = [
    encode({ alg: "RS256", kid: "test-key-id" }),
    encode({
      aud: "another-firebase-project",
      iss: "https://securetoken.google.com/another-firebase-project",
      sub: "test-user",
      exp: now + 3600,
      iat: now,
      auth_time: now
    }),
    "invalid-signature"
  ].join(".");
  const response = await fetch(baseUrl + "/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token
    },
    body: JSON.stringify({ messages: [{ role: "user", content: "test" }] })
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "INVALID_AUTH_TOKEN");
});

test("OAuth authorization rejects an unsupported response type before redirect validation", async () => {
  const url = new URL(baseUrl + "/oauth/authorize");
  url.searchParams.set("response_type", "token");
  url.searchParams.set("client_id", "https://not-a-trusted-client.invalid/client.json");
  url.searchParams.set("redirect_uri", "https://example.invalid/callback");
  const response = await fetch(url);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_request");
});

test("OAuth consent rejects an unknown or expired authorization request", async () => {
  const response = await fetch(baseUrl + "/oauth/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: "not-a-pending-request", id_token: "not-used" })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_request");
});

test("OAuth token endpoint rejects unsupported grants", async () => {
  const response = await fetch(baseUrl + "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials" })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "unsupported_grant_type");
});

test("OAuth token endpoint rejects unknown authorization codes", async () => {
  const verifier = "v".repeat(48);
  const response = await fetch(baseUrl + "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "not-a-real-code",
      client_id: "https://chatgpt.com/oauth/client.json",
      redirect_uri: "https://chatgpt.com/callback",
      code_verifier: verifier,
      resource: "https://teslafield-api.onrender.com/mcp"
    })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_grant");
});

test("MCP rejects a malformed bearer token", async () => {
  const response = await fetch(baseUrl + "/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      Authorization: "Bearer " + "x".repeat(40)
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" }
    })
  });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate") || "", /resource_metadata=/);
});


test("model catalogue exposes the local free model without requiring provider credentials", async () => {
  const response = await fetch(baseUrl + "/api/v1/models");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.openRouterConfigured, false);
  assert.equal(payload.defaultModel, "teslafield");
  assert.ok(payload.models.some((model) => model.id === "teslafield" && model.free === true));
  assert.equal(payload.models.some((model) => model.id === "openrouter/free"), false);
});
