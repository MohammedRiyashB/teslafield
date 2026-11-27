"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { test } = require("node:test");

process.env.PUBLIC_BASE_URL = "https://teslafield-api.onrender.com";
process.env.TESLAFIELD_OAUTH_PAGE = "https://teslafieldai.web.app/oauth";
process.env.TESLAFIELD_OAUTH_SECRET = "oauth-flow-test-secret-with-at-least-32-characters";

const { handleOAuthMcp } = require("../oauth-mcp");

const CLIENT_ID = "https://chatgpt.com/oauth/client.json";
const REDIRECT_URI = "https://chatgpt.com/connector/oauth/redirect";
const RESOURCE = "https://teslafield-api.onrender.com/mcp";

async function withMockedClientMetadata(callback, options = {}) {
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input && input.url;
    if (url === CLIENT_ID) {
      if (init && init.redirect !== "error") throw new Error("Client metadata fetch must reject redirects.");
      return new Response(JSON.stringify({
        client_id: CLIENT_ID,
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none"
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return originalFetch(input, init);
  };

  const server = http.createServer((req, res) => {
    Promise.resolve(handleOAuthMcp(req, res, {
      verifyFirebaseIdToken: options.verifyFirebaseIdToken || (async (token) => {
        if (token !== "valid-firebase-id-token") throw new Error("INVALID_TEST_TOKEN");
        return { sub: "firebase-user-test-001" };
      }),
      chatSpaceUrl: "https://chat-space.invalid",
      allowRate: () => true,
      audit: () => {}
    })).then((handled) => {
      if (!handled && !res.writableEnded) {
        res.writeHead(404);
        res.end();
      }
    }).catch(() => {
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "TEST_SERVER_ERROR" }));
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const baseUrl = "http://127.0.0.1:" + address.port;

  try {
    await callback(baseUrl);
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeAuthorizationUrl(baseUrl, values = {}) {
  const verifier = values.verifier || crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("/oauth/authorize", baseUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", values.redirectUri || REDIRECT_URI);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", values.state || "state-value-for-test");
  url.searchParams.set("resource", RESOURCE);
  url.searchParams.set("scope", "teslafield:chat");
  return { url, verifier };
}

async function beginAuthorization(baseUrl, values = {}) {
  const { url, verifier } = makeAuthorizationUrl(baseUrl, values);
  const response = await fetch(url, { redirect: "manual" });
  assert.equal(response.status, 302);
  const location = response.headers.get("location");
  assert.ok(location, "Authorization must redirect to the consent page.");
  const requestId = new URL(location).searchParams.get("request_id");
  assert.ok(requestId, "The consent redirect must include a one-time request ID.");
  return { requestId, verifier };
}

async function consent(baseUrl, requestId) {
  return fetch(baseUrl + "/oauth/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId, id_token: "valid-firebase-id-token" })
  });
}

async function redeem(baseUrl, code, verifier, overrides = {}) {
  return fetch(baseUrl + "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: overrides.client_id || CLIENT_ID,
      redirect_uri: overrides.redirect_uri || REDIRECT_URI,
      code_verifier: verifier,
      resource: overrides.resource || RESOURCE
    })
  });
}

test("OAuth completes authorization, PKCE exchange and rejects authorization-code replay", async () => {
  await withMockedClientMetadata(async (baseUrl) => {
    const { requestId, verifier } = await beginAuthorization(baseUrl, { state: "success-state" });
    const consentResponse = await consent(baseUrl, requestId);
    assert.equal(consentResponse.status, 200);
    const consentBody = await consentResponse.json();
    assert.equal(consentBody.ok, true);

    const redirect = new URL(consentBody.redirect);
    assert.equal(redirect.origin, "https://chatgpt.com");
    assert.equal(redirect.searchParams.get("state"), "success-state");
    const code = redirect.searchParams.get("code");
    assert.ok(code, "Consent must return a one-time authorization code.");

    const tokenResponse = await redeem(baseUrl, code, verifier);
    assert.equal(tokenResponse.status, 200);
    const tokenBody = await tokenResponse.json();
    assert.equal(tokenBody.token_type, "Bearer");
    assert.equal(tokenBody.expires_in, 3600);
    assert.equal(tokenBody.scope, "teslafield:chat");
    assert.equal(tokenBody.resource, RESOURCE);

    const claims = JSON.parse(Buffer.from(tokenBody.access_token.split(".")[1], "base64url").toString("utf8"));
    assert.equal(claims.sub, "firebase-user-test-001");
    assert.equal(claims.aud, RESOURCE);
    assert.equal(claims.scope, "teslafield:chat");

    const replay = await redeem(baseUrl, code, verifier);
    assert.equal(replay.status, 400);
    assert.equal((await replay.json()).error, "invalid_grant");
  });
});

test("OAuth rejects a redirect URI absent from the trusted client metadata", async () => {
  await withMockedClientMetadata(async (baseUrl) => {
    const { url } = makeAuthorizationUrl(baseUrl, {
      redirectUri: "https://attacker.invalid/steal-code"
    });
    const response = await fetch(url, { redirect: "manual" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_client");
    assert.equal(response.headers.get("location"), null);
  });
});

test("OAuth rejects an incorrect PKCE verifier without consuming the valid code", async () => {
  await withMockedClientMetadata(async (baseUrl) => {
    const { requestId, verifier } = await beginAuthorization(baseUrl);
    const consentResponse = await consent(baseUrl, requestId);
    assert.equal(consentResponse.status, 200);
    const code = new URL((await consentResponse.json()).redirect).searchParams.get("code");

    const wrongVerifier = crypto.randomBytes(32).toString("base64url");
    const rejected = await redeem(baseUrl, code, wrongVerifier);
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error, "invalid_grant");

    const accepted = await redeem(baseUrl, code, verifier);
    assert.equal(accepted.status, 200);
  });
});

test("OAuth consent request cannot be replayed after successful consent", async () => {
  await withMockedClientMetadata(async (baseUrl) => {
    const { requestId } = await beginAuthorization(baseUrl);
    const first = await consent(baseUrl, requestId);
    assert.equal(first.status, 200);
    const second = await consent(baseUrl, requestId);
    assert.equal(second.status, 400);
    assert.equal((await second.json()).error, "invalid_request");
  });
});

test("concurrent OAuth consent requests can consume a pending authorization only once", async () => {
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  let verificationCalls = 0;

  await withMockedClientMetadata(async (baseUrl) => {
    const { requestId } = await beginAuthorization(baseUrl);
    const first = consent(baseUrl, requestId);
    await entered;

    const second = await consent(baseUrl, requestId);
    assert.equal(second.status, 400);
    assert.equal((await second.json()).error, "invalid_request");

    releaseResolve();
    const firstResponse = await first;
    assert.equal(firstResponse.status, 200);
    assert.equal(verificationCalls, 1);
  }, {
    verifyFirebaseIdToken: async (token) => {
      verificationCalls += 1;
      enteredResolve();
      await release;
      if (token !== "valid-firebase-id-token") throw new Error("INVALID_TEST_TOKEN");
      return { sub: "firebase-user-test-001" };
    }
  });
});
