"use strict";

const crypto = require("node:crypto");

const PUBLIC_BASE_URL = trimSlash(process.env.PUBLIC_BASE_URL || "https://teslafield-api.onrender.com");
const MCP_RESOURCE = PUBLIC_BASE_URL + "/mcp";
const OAUTH_PAGE_URL = process.env.TESLAFIELD_OAUTH_PAGE || "https://teslafieldai.web.app/oauth.html";
const OAUTH_ISSUER = PUBLIC_BASE_URL;
const REQUIRED_SCOPE = "teslafield:chat";
const KNOWN_PROTOCOL_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]);
const pendingAuthorizations = new Map();
const authorizationCodes = new Map();

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  res.end(body);
}

function readBody(req, maxBytes = 16384) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        body = "";
      } else if (!tooLarge) {
        body += chunk.toString("utf8");
      }
    });
    req.on("end", () => {
      if (tooLarge) return reject(new Error("BODY_TOO_LARGE"));
      resolve(body);
    });
    req.on("error", reject);
  });
}

function readJson(req, maxBytes = 16384) {
  return readBody(req, maxBytes).then((body) => {
    if (!body.trim()) return {};
    try {
      return JSON.parse(body);
    } catch {
      throw new Error("INVALID_JSON");
    }
  });
}

function getOAuthSecret() {
  const secret = process.env.TESLAFIELD_OAUTH_SECRET || "";
  return secret.length >= 32 ? secret : null;
}

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function createAccessToken(uid) {
  const secret = getOAuthSecret();
  if (!secret) throw new Error("OAUTH_SECRET_NOT_CONFIGURED");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: OAUTH_ISSUER,
    sub: uid,
    aud: MCP_RESOURCE,
    iat: now,
    nbf: now - 2,
    exp: now + 3600,
    scope: REQUIRED_SCOPE,
    jti: crypto.randomUUID()
  }));
  const input = header + "." + payload;
  const signature = crypto.createHmac("sha256", secret).update(input).digest("base64url");
  return input + "." + signature;
}

function verifyAccessToken(token) {
  const secret = getOAuthSecret();
  if (!secret) return null;
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!header || header.alg !== "HS256" || header.typ !== "JWT") return null;
  const expected = crypto.createHmac("sha256", secret).update(parts[0] + "." + parts[1]).digest();
  let actual;
  try {
    actual = Buffer.from(parts[2], "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (
    claims.iss !== OAUTH_ISSUER ||
    claims.aud !== MCP_RESOURCE ||
    typeof claims.sub !== "string" || !claims.sub ||
    !Number.isFinite(claims.exp) || claims.exp <= now ||
    !Number.isFinite(claims.nbf) || claims.nbf > now + 30 ||
    typeof claims.scope !== "string" || !claims.scope.split(/\s+/).includes(REQUIRED_SCOPE)
  ) return null;
  return claims;
}

function protectedResourceMetadata() {
  return {
    resource: MCP_RESOURCE,
    authorization_servers: [OAUTH_ISSUER],
    bearer_methods_supported: ["header"],
    scopes_supported: [REQUIRED_SCOPE]
  };
}

function authorizationServerMetadata() {
  return {
    issuer: OAUTH_ISSUER,
    authorization_endpoint: OAUTH_ISSUER + "/oauth/authorize",
    token_endpoint: OAUTH_ISSUER + "/oauth/token",
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    scopes_supported: [REQUIRED_SCOPE],
    authorization_response_iss_parameter_supported: false
  };
}

async function validateClient(clientId, redirectUri) {
  let documentUrl;
  let callback;
  try {
    documentUrl = new URL(clientId);
    callback = new URL(redirectUri);
  } catch {
    throw new Error("INVALID_CLIENT_OR_REDIRECT_URI");
  }
  if (
    documentUrl.protocol !== "https:" ||
    documentUrl.hostname !== "chatgpt.com" ||
    documentUrl.username || documentUrl.password ||
    documentUrl.port ||
    documentUrl.search || documentUrl.hash ||
    !/^\/oauth\/(?:client\.json|[A-Za-z0-9_-]+\/client\.json)$/.test(documentUrl.pathname) ||
    callback.protocol !== "https:" ||
    callback.username || callback.password || callback.hash
  ) {
    throw new Error("UNTRUSTED_CLIENT_OR_REDIRECT_URI");
  }
  const response = await fetch(documentUrl.toString(), {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error("CLIENT_METADATA_UNAVAILABLE");
  const metadata = await response.json();
  if (
    !metadata ||
    metadata.client_id !== clientId ||
    !Array.isArray(metadata.redirect_uris) ||
    !metadata.redirect_uris.includes(redirectUri) ||
    (metadata.token_endpoint_auth_method && metadata.token_endpoint_auth_method !== "none")
  ) {
    throw new Error("CLIENT_METADATA_INVALID");
  }
  return metadata;
}

function redirectWithQuery(redirectUri, values) {
  const target = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
  }
  return target.toString();
}

function bearerChallenge() {
  return 'Bearer realm="TESLAFIELD", resource_metadata="' +
    OAUTH_ISSUER + '/.well-known/oauth-protected-resource", scope="' + REQUIRED_SCOPE + '"';
}

function sendOAuthError(res, status, error, description) {
  sendJson(res, status, {
    error,
    error_description: description || error
  });
}

async function handleAuthorize(req, res) {
  if (!getOAuthSecret()) {
    return sendOAuthError(res, 503, "temporarily_unavailable", "TESLAFIELD OAuth is not configured on the API service.");
  }
  const url = new URL(req.url, PUBLIC_BASE_URL);
  const responseType = url.searchParams.get("response_type");
  const clientId = url.searchParams.get("client_id") || "";
  const redirectUri = url.searchParams.get("redirect_uri") || "";
  const challenge = url.searchParams.get("code_challenge") || "";
  const challengeMethod = url.searchParams.get("code_challenge_method") || "";
  const state = url.searchParams.get("state") || "";
  const resource = url.searchParams.get("resource") || "";
  const requestedScopes = (url.searchParams.get("scope") || REQUIRED_SCOPE).split(/\s+/).filter(Boolean);

  if (
    responseType !== "code" ||
    !clientId || clientId.length > 2048 ||
    !redirectUri || redirectUri.length > 2048 ||
    challengeMethod !== "S256" ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) ||
    !state || state.length > 512 ||
    resource !== MCP_RESOURCE ||
    !requestedScopes.includes(REQUIRED_SCOPE) ||
    requestedScopes.some((scope) => scope !== REQUIRED_SCOPE)
  ) {
    return sendOAuthError(res, 400, "invalid_request", "A valid authorization-code request with S256 PKCE and the TESLAFIELD resource is required.");
  }

  try {
    await validateClient(clientId, redirectUri);
  } catch (error) {
    const unavailable = error.message === "CLIENT_METADATA_UNAVAILABLE";
    return sendOAuthError(res, unavailable ? 503 : 400, unavailable ? "temporarily_unavailable" : "invalid_client", "The ChatGPT client metadata or registered redirect URI could not be verified.");
  }

  const requestId = crypto.randomBytes(24).toString("base64url");
  pendingAuthorizations.set(requestId, {
    clientId,
    redirectUri,
    challenge,
    state,
    resource,
    scope: REQUIRED_SCOPE,
    expiresAt: Date.now() + 5 * 60 * 1000
  });
  const target = new URL(OAUTH_PAGE_URL);
  target.searchParams.set("request_id", requestId);
  res.writeHead(302, {
    Location: target.toString(),
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer"
  });
  res.end();
}

async function handleConsent(req, res, context) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) {
    return sendOAuthError(res, 415, "invalid_request", "Send a JSON consent request.");
  }
  let input;
  try {
    input = await readJson(req, 16 * 1024);
  } catch (error) {
    return sendOAuthError(res, error.message === "BODY_TOO_LARGE" ? 413 : 400, "invalid_request", "The consent request is invalid.");
  }
  const requestId = typeof input.request_id === "string" ? input.request_id : "";
  const idToken = typeof input.id_token === "string" ? input.id_token : "";
  const pending = pendingAuthorizations.get(requestId);
  if (!pending || pending.expiresAt <= Date.now()) {
    pendingAuthorizations.delete(requestId);
    return sendOAuthError(res, 400, "invalid_request", "This sign-in request expired. Return to ChatGPT and connect again.");
  }
  if (!idToken || idToken.length > 8192) {
    return sendOAuthError(res, 401, "login_required", "Sign in with your TESLAFIELD account first.");
  }
  let firebaseUser;
  try {
    firebaseUser = await context.verifyFirebaseIdToken(idToken);
  } catch {
    return sendOAuthError(res, 401, "login_required", "Your TESLAFIELD session is invalid or expired. Sign in again.");
  }
  if (!firebaseUser || typeof firebaseUser.sub !== "string" || !firebaseUser.sub) {
    return sendOAuthError(res, 401, "login_required", "Your TESLAFIELD account could not be verified.");
  }

  pendingAuthorizations.delete(requestId);
  const code = crypto.randomBytes(32).toString("base64url");
  authorizationCodes.set(code, {
    uid: firebaseUser.sub,
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    challenge: pending.challenge,
    resource: pending.resource,
    scope: pending.scope,
    expiresAt: Date.now() + 3 * 60 * 1000
  });
  const redirect = redirectWithQuery(pending.redirectUri, {
    code,
    state: pending.state
  });
  sendJson(res, 200, { ok: true, redirect });
}

async function handleDeny(req, res) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) {
    return sendOAuthError(res, 415, "invalid_request", "Send a JSON request.");
  }
  let input;
  try {
    input = await readJson(req, 4096);
  } catch {
    return sendOAuthError(res, 400, "invalid_request", "The request is invalid.");
  }
  const requestId = typeof input.request_id === "string" ? input.request_id : "";
  const pending = pendingAuthorizations.get(requestId);
  if (!pending || pending.expiresAt <= Date.now()) {
    pendingAuthorizations.delete(requestId);
    return sendOAuthError(res, 400, "invalid_request", "This sign-in request expired. Return to ChatGPT and connect again.");
  }
  pendingAuthorizations.delete(requestId);
  const redirect = redirectWithQuery(pending.redirectUri, {
    error: "access_denied",
    error_description: "The user denied TESLAFIELD access.",
    state: pending.state
  });
  sendJson(res, 200, { ok: true, redirect });
}

async function handleToken(req, res) {
  if (!getOAuthSecret()) {
    return sendOAuthError(res, 503, "temporarily_unavailable", "TESLAFIELD OAuth is not configured.");
  }
  if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers["content-type"] || "")) {
    return sendOAuthError(res, 415, "invalid_request", "The token endpoint requires form-encoded data.");
  }
  let raw;
  try {
    raw = await readBody(req, 12 * 1024);
  } catch {
    return sendOAuthError(res, 413, "invalid_request", "The token request is too large.");
  }
  const input = new URLSearchParams(raw);
  const grantType = input.get("grant_type") || "";
  const code = input.get("code") || "";
  const clientId = input.get("client_id") || "";
  const redirectUri = input.get("redirect_uri") || "";
  const verifier = input.get("code_verifier") || "";
  const resource = input.get("resource") || "";
  if (grantType !== "authorization_code") {
    return sendOAuthError(res, 400, "unsupported_grant_type", "Only authorization_code is supported.");
  }
  if (
    !code || code.length > 256 ||
    !clientId || clientId.length > 2048 ||
    !redirectUri || redirectUri.length > 2048 ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
    resource !== MCP_RESOURCE
  ) {
    return sendOAuthError(res, 400, "invalid_grant", "The authorization code or PKCE parameters are invalid.");
  }
  const grant = authorizationCodes.get(code);
  if (
    !grant ||
    grant.expiresAt <= Date.now() ||
    grant.clientId !== clientId ||
    grant.redirectUri !== redirectUri ||
    grant.resource !== resource
  ) {
    authorizationCodes.delete(code);
    return sendOAuthError(res, 400, "invalid_grant", "The authorization code is invalid, expired, or already used.");
  }
  const actualChallenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const expected = Buffer.from(grant.challenge);
  const actual = Buffer.from(actualChallenge);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return sendOAuthError(res, 400, "invalid_grant", "The PKCE verifier did not match the authorization request.");
  }

  authorizationCodes.delete(code);
  const accessToken = createAccessToken(grant.uid);
  sendJson(res, 200, {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    scope: grant.scope,
    resource: grant.resource
  });
}

async function callTeslafield(messages, context) {
  const upstream = await fetch(context.chatSpaceUrl + "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, max_new_tokens: 384 }),
    signal: AbortSignal.timeout(240000)
  });
  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const error = new Error(upstream.status === 429 ? "The TESLAFIELD V1 model is busy. Please try again shortly." :
      "TESLAFIELD V1 could not complete the request because its model service is waking up or unavailable.");
    error.status = upstream.status === 429 ? 429 : 502;
    throw error;
  }
  const reply = data && data.response;
  if (typeof reply !== "string" || !reply.trim()) {
    const error = new Error("TESLAFIELD V1 returned an empty response. Please retry.");
    error.status = 502;
    throw error;
  }
  return {
    reply: reply.trim(),
    model: data.model || "TESLAFIELD V1",
    model_id: data.model_id || "Qwen/Qwen3-0.6B"
  };
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id: id === undefined ? null : id,
    error: { code, message }
  };
}

function sendMcp(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

async function handleMcp(req, res, context) {
  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer ([A-Za-z0-9._~-]{20,8192})$/);
  const claims = match ? verifyAccessToken(match[1]) : null;
  if (!claims) {
    res.setHeader("WWW-Authenticate", bearerChallenge());
    sendJson(res, 401, { error: "AUTH_REQUIRED", message: "Connect with your TESLAFIELD account to use TESLAFIELD V1." });
    return true;
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { error: "METHOD_NOT_ALLOWED", message: "Use POST for the TESLAFIELD MCP endpoint." });
    return true;
  }
  const accept = req.headers.accept || "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    sendJson(res, 406, { error: "NOT_ACCEPTABLE", message: "MCP requests must accept application/json and text/event-stream." });
    return true;
  }
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) {
    sendJson(res, 415, { error: "UNSUPPORTED_MEDIA_TYPE" });
    return true;
  }
  let message;
  try {
    message = await readJson(req, 48 * 1024);
  } catch (error) {
    sendMcp(res, error.message === "BODY_TOO_LARGE" ? 413 : 400, jsonRpcError(null, -32700, "Invalid JSON-RPC request."));
    return true;
  }
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string" || !message.method) {
    sendMcp(res, 400, jsonRpcError(message && message.id, -32600, "Invalid JSON-RPC request."));
    return true;
  }
  if (message.method.startsWith("notifications/")) {
    res.writeHead(202, { "Cache-Control": "no-store" });
    res.end();
    return true;
  }
  const id = message.id;
  if (id === undefined || id === null) {
    sendMcp(res, 400, jsonRpcError(null, -32600, "A request id is required."));
    return true;
  }
  const params = message.params && typeof message.params === "object" ? message.params : {};

  if (message.method === "initialize") {
    const version = typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-11-25";
    if (!KNOWN_PROTOCOL_VERSIONS.has(version)) {
      sendMcp(res, 400, jsonRpcError(id, -32602, "Unsupported MCP protocol version."));
      return true;
    }
    sendMcp(res, 200, {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "TESLAFIELD V1", version: "1.0.0" },
        instructions: "Use ask_teslafield to send a question to the authenticated TESLAFIELD V1 AI engine. Only the TESLAFIELD chat capability is exposed."
      }
    });
    return true;
  }

  if (message.method === "ping") {
    sendMcp(res, 200, { jsonrpc: "2.0", id, result: {} });
    return true;
  }

  if (message.method === "tools/list") {
    sendMcp(res, 200, {
      jsonrpc: "2.0",
      id,
      result: {
        tools: [{
          name: "ask_teslafield",
          title: "Ask TESLAFIELD V1",
          description: "Send a question to TESLAFIELD V1 and receive an answer generated by its connected AI model. Requires the user's TESLAFIELD account authorization.",
          inputSchema: {
            type: "object",
            properties: {
              question: { type: "string", minLength: 1, maxLength: 12000, description: "The question or task to send to TESLAFIELD V1." },
              context: { type: "string", maxLength: 12000, description: "Optional recent conversation context to help TESLAFIELD V1 answer consistently." }
            },
            required: ["question"],
            additionalProperties: false
          },
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
        }]
      }
    });
    return true;
  }

  if (message.method === "tools/call") {
    const name = params.name;
    const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
    if (name !== "ask_teslafield") {
      sendMcp(res, 200, jsonRpcError(id, -32602, "Unknown TESLAFIELD tool."));
      return true;
    }
    const question = typeof args.question === "string" ? args.question.trim() : "";
    const extraContext = typeof args.context === "string" ? args.context.trim() : "";
    if (!question || question.length > 12000 || extraContext.length > 12000 || Object.keys(args).some((key) => !["question", "context"].includes(key))) {
      sendMcp(res, 200, jsonRpcError(id, -32602, "Provide a question of up to 12,000 characters and optional context of up to 12,000 characters."));
      return true;
    }
    if (extraContext.length + question.length > 24000) {
      sendMcp(res, 200, jsonRpcError(id, -32602, "Reduce the combined context and question to 24,000 characters."));
      return true;
    }
    if (!context.allowRate(req, res, "chat", "mcp-user:" + claims.sub)) return true;
    const prompt = extraContext
      ? "Conversation context:\n" + extraContext + "\n\nCurrent request:\n" + question
      : question;
    try {
      const generated = await callTeslafield([{ role: "user", content: prompt }], context);
      if (typeof context.audit === "function") context.audit("mcp.chat.completed", claims.sub, "/mcp");
      sendMcp(res, 200, {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: generated.reply }],
          structuredContent: { model: generated.model, model_id: generated.model_id },
          isError: false
        }
      });
    } catch (error) {
      sendMcp(res, 200, {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: error.message || "TESLAFIELD V1 could not complete the request." }],
          isError: true
        }
      });
    }
    return true;
  }

  sendMcp(res, 200, jsonRpcError(id, -32601, "Method not found."));
  return true;
}

async function handleOAuthMcp(req, res, context) {
  const url = new URL(req.url, PUBLIC_BASE_URL);
  const path = url.pathname;

  if (req.method === "GET" && path === "/.well-known/oauth-protected-resource") {
    sendJson(res, 200, protectedResourceMetadata());
    return true;
  }
  if (req.method === "GET" && path === "/.well-known/oauth-authorization-server") {
    sendJson(res, 200, authorizationServerMetadata());
    return true;
  }
  if (req.method === "GET" && path === "/oauth/authorize") {
    await handleAuthorize(req, res);
    return true;
  }
  if (req.method === "POST" && path === "/oauth/consent") {
    await handleConsent(req, res, context);
    return true;
  }
  if (req.method === "POST" && path === "/oauth/deny") {
    await handleDeny(req, res);
    return true;
  }
  if (req.method === "POST" && path === "/oauth/token") {
    await handleToken(req, res);
    return true;
  }
  if (path === "/mcp") {
    await handleMcp(req, res, context);
    return true;
  }
  return false;
}

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of pendingAuthorizations) {
    if (now >= value.expiresAt) pendingAuthorizations.delete(key);
  }
  for (const [key, value] of authorizationCodes) {
    if (now >= value.expiresAt) authorizationCodes.delete(key);
  }
  if (pendingAuthorizations.size > 5000) pendingAuthorizations.clear();
  if (authorizationCodes.size > 5000) authorizationCodes.clear();
}, 60_000);
if (typeof cleanup.unref === "function") cleanup.unref();

module.exports = { handleOAuthMcp };
