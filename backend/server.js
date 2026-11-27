const http = require("node:http");
const crypto = require("node:crypto");
const { handleOAuthMcp } = require("./oauth-mcp");
const { IdempotencyStore } = require("./idempotency");
const { createOpenRouterCatalog } = require("./model-catalog");
const { createConversationStore } = require("./conversation-store");
const { pruneExpiredEntries, hasCapacity } = require("./security-collections");

const PORT = Number(process.env.PORT || 10000);
const SERVICE_NAME = "teslafield-api";
const API_VERSION = "v1";
const chatIdempotencyStore = new IdempotencyStore({ ttlMs: 5 * 60 * 1000, maxEntries: 1000 });
const openRouterCatalog = createOpenRouterCatalog({ apiKey: process.env.OPENROUTER_API_KEY || "" });
const allowedOrigins = (process.env.CORS_ORIGIN || "https://teslafieldai.web.app,https://teslafieldai.firebaseapp.com")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "teslafieldai";
const conversationStore = createConversationStore({ projectId: FIREBASE_PROJECT_ID });
let firebaseSigningKeys = null;
let firebaseSigningKeysExpiresAt = 0;

async function getFirebaseSigningKey(kid) {
  const now = Date.now();
  if (!firebaseSigningKeys || now >= firebaseSigningKeysExpiresAt) {
    const response = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com", {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error("FIREBASE_SIGNING_KEYS_UNAVAILABLE");
    const document = await response.json();
    if (!document || !Array.isArray(document.keys)) throw new Error("FIREBASE_SIGNING_KEYS_INVALID");
    firebaseSigningKeys = document.keys.filter((key) =>
      key && key.kty === "RSA" && key.use === "sig" && key.alg === "RS256" && typeof key.kid === "string"
    );
    const cacheControl = response.headers.get("cache-control") || "";
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
    const maxAgeSeconds = maxAgeMatch ? Math.min(21600, Math.max(60, Number(maxAgeMatch[1]))) : 3600;
    firebaseSigningKeysExpiresAt = now + maxAgeSeconds * 1000;
  }
  const key = firebaseSigningKeys.find((candidate) => candidate.kid === kid);
  if (!key) {
    firebaseSigningKeys = null;
    firebaseSigningKeysExpiresAt = 0;
    throw new Error("FIREBASE_SIGNING_KEY_NOT_FOUND");
  }
  return key;
}

async function verifyFirebaseIdToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("MALFORMED_FIREBASE_ID_TOKEN");
  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("MALFORMED_FIREBASE_ID_TOKEN");
  }
  if (!header || header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("UNSUPPORTED_FIREBASE_ID_TOKEN");
  const projectIssuer = "https://securetoken.google.com/" + FIREBASE_PROJECT_ID;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    claims.aud !== FIREBASE_PROJECT_ID ||
    claims.iss !== projectIssuer ||
    typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128 ||
    !Number.isFinite(claims.exp) || claims.exp <= nowSeconds ||
    !Number.isFinite(claims.iat) || claims.iat > nowSeconds + 300 ||
    !Number.isFinite(claims.auth_time) || claims.auth_time > nowSeconds + 300
  ) {
    throw new Error("INVALID_FIREBASE_ID_TOKEN_CLAIMS");
  }
  const jwk = await getFirebaseSigningKey(header.kid);
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const signingInput = Buffer.from(parts[0] + "." + parts[1]);
  const signature = Buffer.from(parts[2], "base64url");
  if (!crypto.verify("RSA-SHA256", signingInput, publicKey, signature)) {
    throw new Error("INVALID_FIREBASE_ID_TOKEN_SIGNATURE");
  }
  return claims;
}

const RATE_LIMITS = {
  global: { limit: 120, windowMs: 60_000 },
  chat: { limit: 20, windowMs: 60_000 },
  speech: { limit: 5, windowMs: 60_000 },
  voice: { limit: 10, windowMs: 60_000 },
  image: { limit: 3, windowMs: 60_000 },
  video: { limit: 2, windowMs: 60_000 }
};
const MAX_RATE_BUCKETS = 10_000;
const rateBuckets = new Map();

function requestClientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",").pop().trim().slice(0, 80);
  }
  return String(req.socket && req.socket.remoteAddress || "unknown").slice(0, 80);
}

function allowRate(req, res, bucketName, actorKey) {
  const policy = RATE_LIMITS[bucketName] || RATE_LIMITS.global;
  const key = bucketName + ":" + (actorKey || requestClientKey(req));
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    if (!bucket) {
      pruneExpiredEntries(rateBuckets, now, "resetAt");
      // Fail closed at capacity; never clear active limits to make room for new keys.
      if (!hasCapacity(rateBuckets, MAX_RATE_BUCKETS)) {
        res.setHeader("Retry-After", "60");
        sendJson(res, 503, { error: "RATE_LIMIT_CAPACITY", message: "The request limiter is temporarily at capacity. Please retry shortly." });
        return false;
      }
    }
    bucket = { count: 0, resetAt: now + policy.windowMs };
    rateBuckets.set(key, bucket);
  }
  if (bucket.count >= policy.limit) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    sendJson(res, 429, { error: "RATE_LIMITED", message: "Too many requests. Please wait and try again." });
    return false;
  }
  bucket.count += 1;
  return true;
}

function audit(eventName, userId, route) {
  const actor = userId
    ? crypto.createHash("sha256").update(String(userId)).digest("hex").slice(0, 12)
    : "anonymous";
  // Never log message bodies, prompts, file names, audio, tokens, email or IP addresses.
  console.info(JSON.stringify({
    type: "security_audit",
    event: eventName,
    actor,
    route,
    at: new Date().toISOString()
  }));
}

async function authenticateFirebase(req, res) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer ([A-Za-z0-9._~-]{20,8192})$/);
  if (!match) {
    sendJson(res, 401, { error: "AUTH_REQUIRED", message: "Sign in to TESLAFIELD to continue." });
    audit("auth.denied", null, "protected-api");
    return null;
  }
  try {
    const decoded = await verifyFirebaseIdToken(match[1]);
    if (!decoded || !decoded.sub || decoded.aud !== FIREBASE_PROJECT_ID) throw new Error("INVALID_FIREBASE_ID_TOKEN");
    decoded.uid = decoded.sub;
    return decoded;
  } catch (error) {
    sendJson(res, 401, { error: "INVALID_AUTH_TOKEN", message: "Your session is invalid or expired. Sign in again." });
    audit("auth.invalid_token", null, "protected-api");
    return null;
  }
}

const protectedApiRoutes = new Map([
  ["/api/v1/chat/completions", "chat"],
  ["/api/v1/chat/stream", "chat"],
  ["/api/v1/speech/transcribe", "speech"],
  ["/api/v1/voice/synthesize", "voice"],
  ["/api/v1/image/generate", "image"],
  ["/api/v1/video/generate", "video"],
  ["/api/v1/creative/plan", "chat"]
]);

const rateCleanup = setInterval(() => {
  pruneExpiredEntries(rateBuckets, Date.now(), "resetAt");
}, 60_000);
if (typeof rateCleanup.unref === "function") rateCleanup.unref();

function validateAudioPayload(base64, mimeType) {
  const normalizedType = String(mimeType || "").split(";")[0].trim().toLowerCase();
  const supportedTypes = new Set(["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg"]);
  if (!supportedTypes.has(normalizedType)) throw new Error("AUDIO_TYPE_INVALID");
  if (!base64 || base64.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error("AUDIO_SIZE_INVALID");
  }
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error("AUDIO_SIZE_INVALID");
  const starts = (text) => bytes.subarray(0, text.length).toString("ascii") === text;
  const signatureValid =
    (normalizedType === "audio/webm" && bytes.length > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) ||
    (normalizedType === "audio/mp4" && bytes.length > 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") ||
    ((normalizedType === "audio/wav" || normalizedType === "audio/x-wav") && starts("RIFF") && bytes.subarray(8, 12).toString("ascii") === "WAVE") ||
    (normalizedType === "audio/ogg" && starts("OggS")) ||
    (normalizedType === "audio/mpeg" && (starts("ID3") || (bytes.length > 1 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)));
  if (!signatureValid) throw new Error("AUDIO_TYPE_INVALID");
  return bytes;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

function readJson(req, maxBytes = 32 * 1024) {
  return new Promise((resolve, reject) => {
    const contentLength = req.headers["content-length"];
    if (contentLength !== undefined &&
        (!/^[0-9]+$/.test(String(contentLength)) || Number(contentLength) > maxBytes)) {
      req.resume();
      reject(new Error("BODY_TOO_LARGE"));
      return;
    }
    let body = "";
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        body = "";
        return;
      }
      if (!tooLarge) body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (tooLarge) return reject(new Error("BODY_TOO_LARGE"));
      if (!body.trim()) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("INVALID_JSON")); }
    });
    req.on("aborted", () => reject(new Error("REQUEST_ABORTED")));
    req.on("error", reject);
  });
}

/*
 * TESLAFIELD Creative Studio
 * Provider adapters are isolated from routes so new providers can be added
 * without changing the frontend contract.
 */
function getImageProvider() {
  const requested = (process.env.IMAGE_PROVIDER || "").trim().toLowerCase();
  const selfHostedEndpoint = (process.env.SELF_HOSTED_IMAGE_ENDPOINT || "").trim();
  const selfHostedModel = (process.env.SELF_HOSTED_IMAGE_MODEL || "").trim();

  const providers = {
    huggingface: {
      id: "huggingface",
      name: "TESLAFIELD Hugging Face ZeroGPU Space",
      type: "huggingface-space",
      configured: Boolean(process.env.HF_IMAGE_SPACE_URL),
      requiresApiKey: false
    },
    pollinations: {
      id: "pollinations",
      name: "Pollinations",
      type: "external-api",
      configured: Boolean(process.env.POLLINATIONS_API_KEY),
      requiresApiKey: true
    },
    selfHosted: {
      id: "self-hosted",
      name: "Self-hosted OpenAI-compatible image model",
      type: "self-hosted",
      configured: Boolean(selfHostedEndpoint && selfHostedModel),
      requiresApiKey: false
    }
  };

  if (requested === "self-hosted" && providers.selfHosted.configured) return providers.selfHosted;
  if (requested === "huggingface" && providers.huggingface.configured) return providers.huggingface;
  if (requested === "pollinations" && providers.pollinations.configured) return providers.pollinations;
  if (!requested && providers.selfHosted.configured) return providers.selfHosted;
  if (!requested && providers.huggingface.configured) return providers.huggingface;
  if (!requested && providers.pollinations.configured) return providers.pollinations;
  return null;
}

function getProviderCatalog() {
  const selected = getImageProvider();
  return [
    {
      id: "huggingface",
      name: "TESLAFIELD Hugging Face ZeroGPU Space",
      type: "huggingface-space",
      configured: Boolean(process.env.HF_IMAGE_SPACE_URL),
      selected: Boolean(selected && selected.id === "huggingface"),
      note: "Your own Gradio Space. Free ZeroGPU quota and model access conditions apply."
    },
    {
      id: "pollinations",
      name: "Pollinations",
      type: "external-api",
      configured: Boolean(process.env.POLLINATIONS_API_KEY),
      selected: Boolean(selected && selected.id === "pollinations"),
      note: "External provider. Check current pricing, limits and terms before enabling."
    },
    {
      id: "self-hosted",
      name: "Self-hosted OpenAI-compatible image model",
      type: "self-hosted",
      configured: Boolean(process.env.SELF_HOSTED_IMAGE_ENDPOINT && process.env.SELF_HOSTED_IMAGE_MODEL),
      selected: Boolean(selected && selected.id === "self-hosted"),
      note: "Connect an endpoint you control. This requires an accessible inference server and compute; it is not hosted by Render."
    }
  ];
}

async function generateWithHuggingFaceImage(input) {
  const { Client } = require("@gradio/client");
  const spaceUrl = process.env.HF_IMAGE_SPACE_URL;
  const client = await Client.connect(spaceUrl, process.env.HF_TOKEN ? { hf_token: process.env.HF_TOKEN } : {});
  const result = await client.predict("/generate_image", [input.prompt, input.aspectRatio, -1]);
  const file = result.data && result.data[0];
  const fileUrl = typeof file === "string" ? file : file && (file.url || file.path);
  if (!fileUrl) throw new Error("HUGGINGFACE_IMAGE_EMPTY_RESULT");
  const response = await fetch(fileUrl, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error("HUGGINGFACE_IMAGE_DOWNLOAD_FAILED");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error("HUGGINGFACE_IMAGE_SIZE_INVALID");
  return { image: "data:image/png;base64," + bytes.toString("base64"), provider: "Hugging Face ZeroGPU", model: "black-forest-labs/FLUX.1-schnell" };
}

async function generateWithPollinations(input) {
  const [width, height] = input.dimensions;
  const response = await fetch("https://gen.pollinations.ai/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + process.env.POLLINATIONS_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: input.model || "black-forest-labs/flux.1-schnell",
      prompt: input.prompt,
      n: 1,
      size: width + "x" + height,
      response_format: "b64_json"
    }),
    signal: AbortSignal.timeout(120000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("IMAGE_PROVIDER_ERROR");
    error.providerStatus = response.status;
    throw error;
  }
  const item = Array.isArray(body.data) ? body.data[0] : null;
  if (!item || (!item.b64_json && !item.url)) throw new Error("IMAGE_PROVIDER_EMPTY_RESULT");
  return {
    image: item.b64_json ? "data:image/png;base64," + item.b64_json : item.url,
    provider: "Pollinations",
    model: "black-forest-labs/flux.1-schnell"
  };
}

async function generateWithHuggingFaceVideo(prompt) {
  const { Client } = require("@gradio/client");
  const client = await Client.connect(process.env.HF_VIDEO_SPACE_URL, process.env.HF_TOKEN ? { hf_token: process.env.HF_TOKEN } : {});
  const result = await client.predict("/generate_video", [prompt, -1]);
  const file = result.data && result.data[0];
  const fileUrl = typeof file === "string" ? file : file && (file.url || file.path);
  if (!fileUrl) throw new Error("HUGGINGFACE_VIDEO_EMPTY_RESULT");
  const response = await fetch(fileUrl, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error("HUGGINGFACE_VIDEO_DOWNLOAD_FAILED");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("HUGGINGFACE_VIDEO_SIZE_INVALID");
  return "data:video/mp4;base64," + bytes.toString("base64");
}

const trimTrailingSlashes = (value) => { while (value.endsWith("/")) value = value.slice(0, -1); return value; };
const CHAT_SPACE_URL = trimTrailingSlashes(process.env.HF_CHAT_SPACE_URL || "https://earthaioa-earth-os-v10-docker.hf.space");
const SPEECH_SPACE_ID = process.env.HF_SPEECH_SPACE_ID || "Earthaioa/OpenWhisper-Small";
const VOICE_SPACE_ID = process.env.HF_VOICE_SPACE_ID || "Earthaioa/Earthaioa-Kokoro-TTS";
const SPEECH_SPACE_URL = trimTrailingSlashes(process.env.HF_SPEECH_SPACE_URL || "https://earthaioa-openwhisper-small.hf.space");
const VOICE_SPACE_URL = trimTrailingSlashes(process.env.HF_VOICE_SPACE_URL || "https://earthaioa-earthaioa-kokoro-tts.hf.space");
async function endpointReady(baseUrl, path) {
  try {
    const response = await fetch(baseUrl + path, { signal: AbortSignal.timeout(12000) });
    return response.ok;
  } catch { return false; }
}

async function transcribeWithSpace(audioBase64, mimeType, language) {
  const { Client, handle_file } = require("@gradio/client");
  const audio = Buffer.from(audioBase64, "base64");
  if (!audio.length || audio.length > 8 * 1024 * 1024) throw new Error("AUDIO_SIZE_INVALID");
  const client = await Client.connect(SPEECH_SPACE_ID);
  const result = await client.predict("/predict", [
    handle_file(new Blob([audio], { type: mimeType || "audio/webm" })),
    language || "Auto detect"
  ]);
  const transcript = result.data && result.data[0];
  if (typeof transcript !== "string" || !transcript.trim()) throw new Error("EMPTY_TRANSCRIPT");
  return transcript.trim();
}

async function synthesizeWithSpace(text, language, voice) {
  const { Client } = require("@gradio/client");
  const client = await Client.connect(VOICE_SPACE_ID);
  const result = await client.predict("/predict", [
    text,
    language || "Tamil",
    voice || "ahana"
  ]);
  const file = result.data && result.data[0];
  const fileUrl = typeof file === "string" ? file : file && (file.url || file.path);
  if (!fileUrl) throw new Error("VOICE_EMPTY_RESULT");
  const target = fileUrl.startsWith("http") ? fileUrl : new URL(fileUrl, VOICE_SPACE_URL).toString();
  const response = await fetch(target, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error("VOICE_DOWNLOAD_FAILED");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw new Error("VOICE_SIZE_INVALID");
  return "data:audio/wav;base64," + bytes.toString("base64");
}

async function generateWithSelfHosted(input) {
  const endpoint = process.env.SELF_HOSTED_IMAGE_ENDPOINT;
  const model = process.env.SELF_HOSTED_IMAGE_MODEL;
  const headers = { "Content-Type": "application/json" };
  if (process.env.SELF_HOSTED_IMAGE_API_KEY) {
    headers.Authorization = "Bearer " + process.env.SELF_HOSTED_IMAGE_API_KEY;
  }
  const [width, height] = input.dimensions;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      prompt: input.prompt,
      n: 1,
      size: width + "x" + height,
      response_format: "b64_json"
    }),
    signal: AbortSignal.timeout(120000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("IMAGE_PROVIDER_ERROR");
    error.providerStatus = response.status;
    throw error;
  }
  const item = Array.isArray(body.data) ? body.data[0] : body;
  const base64 = item && (item.b64_json || item.image);
  const imageUrl = item && item.url;
  if (!base64 && !imageUrl) throw new Error("IMAGE_PROVIDER_EMPTY_RESULT");
  return {
    image: base64 ? (String(base64).startsWith("data:") ? base64 : "data:image/png;base64," + base64) : imageUrl,
    provider: "Self-hosted",
    model
  };
}

async function generateImage(input, provider) {
  if (provider.id === "huggingface") return generateWithHuggingFaceImage(input);
  if (provider.id === "pollinations") return generateWithPollinations(input);
  if (provider.id === "self-hosted") return generateWithSelfHosted(input);
  throw new Error("IMAGE_PROVIDER_UNSUPPORTED");
}

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader("Cache-Control", "no-store");
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.includes(origin)) {
    sendJson(res, 403, { error: "ORIGIN_NOT_ALLOWED" });
    return;
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID");
  res.setHeader("Access-Control-Max-Age", "600");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (!allowRate(req, res, "global")) return;
  if (await handleOAuthMcp(req, res, {
    verifyFirebaseIdToken,
    chatSpaceUrl: CHAT_SPACE_URL,
    allowRate,
    audit
  })) return;
  if (req.method === "POST" && protectedApiRoutes.has(url.pathname)) {
    if (!allowRate(req, res, protectedApiRoutes.get(url.pathname))) return;
    if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) {
      sendJson(res, 415, { error: "UNSUPPORTED_MEDIA_TYPE" });
      return;
    }
    const authUser = await authenticateFirebase(req, res);
    if (!authUser) return;
    if (!allowRate(req, res, protectedApiRoutes.get(url.pathname), "user:" + authUser.uid)) return;
    req.authUser = authUser;
    audit("api.request_authorized", authUser.uid, url.pathname);
  }

  if (["GET", "PUT", "DELETE"].includes(req.method) && url.pathname === "/api/v1/conversations") {
    if (!allowRate(req, res, "history")) return;
    if (req.method === "PUT" && !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) {
      sendJson(res, 415, { error: "UNSUPPORTED_MEDIA_TYPE" });
      return;
    }
    const authUser = await authenticateFirebase(req, res);
    if (!authUser) return;
    if (!allowRate(req, res, "history", "user:" + authUser.uid)) return;
    req.authUser = authUser;
    req.firebaseIdToken = (req.headers.authorization || "").slice(7);
    audit("api.request_authorized", authUser.uid, url.pathname);
    try {
      if (req.method === "GET") {
        const [conversations, deleted] = await Promise.all([
          conversationStore.list(authUser.uid, req.firebaseIdToken),
          conversationStore.listDeleted(authUser.uid, req.firebaseIdToken)
        ]);
        return sendJson(res, 200, { ok: true, conversations, deleted });
      }
      if (req.method === "PUT") {
        const input = await readJson(req, 512 * 1024);
        const conversation = await conversationStore.upsert(authUser.uid, req.firebaseIdToken, input.conversation);
        audit("conversation.saved", authUser.uid, url.pathname);
        return sendJson(res, 200, { ok: true, conversation });
      }
      const id = url.searchParams.get("id") || "";
      await conversationStore.remove(authUser.uid, req.firebaseIdToken, id);
      audit("conversation.deleted", authUser.uid, url.pathname);
      return sendJson(res, 200, { ok: true, deleted: id });
    } catch (error) {
      if (["INVALID_CONVERSATION", "INVALID_CONVERSATION_ID", "INVALID_CONVERSATION_MESSAGES", "INVALID_CONVERSATION_MESSAGE", "CONVERSATION_TOO_LARGE", "INVALID_USER_ID"].includes(error.message)) {
        return sendJson(res, 400, { error: error.message });
      }
      if (error.status === 404 || error.status === 403) {
        return sendJson(res, 503, { error: "FIRESTORE_NOT_READY", message: "Cloud history needs the TeslafieldAI Firestore database and owner-only security rules to be enabled." });
      }
      return sendJson(res, 503, { error: "CLOUD_HISTORY_UNAVAILABLE", message: "Cloud history is temporarily unavailable. Your local conversation is still saved on this device." });
    }
  }

  if (req.method === "GET" && url.pathname === "/") {
    sendJson(res, 200, {
      service: SERVICE_NAME,
      message: "TESLAFIELD API is running.",
      documentation: "See the repository README for setup."
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, service: SERVICE_NAME });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/models") {
    const models = [{
      id: "teslafield",
      name: "Teslafield B1",
      free: true,
      freeTier: true,
      provider: "TeslafieldAI",
      promptPerMillion: 0,
      completionPerMillion: 0,
      available: true
    }];
    let catalogAvailable = true;
    let catalogError = openRouterCatalog.configured ? null : "OPENROUTER_API_KEY_MISSING";
    if (openRouterCatalog.configured) {
      try {
        const remoteModels = await openRouterCatalog.listModels();
        for (const model of remoteModels) {
          models.push({ ...model, provider: "OpenRouter", available: true });
        }
      } catch (error) {
        catalogAvailable = false;
        catalogError = typeof error.code === "string" ? error.code : "OPENROUTER_CATALOG_REQUEST_FAILED";
        console.warn(JSON.stringify({ type: "openrouter_catalog_error", code: catalogError }));
      }
    }
    sendJson(res, 200, {
      ok: true,
      defaultModel: "teslafield",
      openRouterConfigured: openRouterCatalog.configured,
      catalogAvailable,
      catalogError,
      openRouterModelCount: models.filter((model) => model.provider === "OpenRouter").length,
      models
    });
    return;
  }

  if (req.method === "GET" && (url.pathname === "/api/v1/status" || url.pathname === "/api/v1/warmup")) {
    const provider = getImageProvider();
    const [chatReady, speechReady, voiceReady] = await Promise.all([
      endpointReady(CHAT_SPACE_URL, "/health"),
      endpointReady(SPEECH_SPACE_URL, "/config"),
      endpointReady(VOICE_SPACE_URL, "/config")
    ]);
    sendJson(res, 200, {
      service: SERVICE_NAME,
      apiVersion: API_VERSION,
      mode: "assistant-chat",
      warmup: url.pathname === "/api/v1/warmup",
      checkedAt: new Date().toISOString(),
      engine: "TeslafieldAI",
      integrations: {
        imageGeneration: Boolean(provider),
        imageProvider: provider ? provider.name : null,
        videoGeneration: Boolean(process.env.HF_VIDEO_SPACE_URL || process.env.POLLINATIONS_API_KEY),
        audioGeneration: voiceReady,
        speechToText: speechReady,
        voiceGeneration: voiceReady,
        authentication: true,
        database: false,
        textChat: chatReady
      },
      engines: {
        chat: chatReady ? "online" : "sleeping-or-unavailable",
        speech: speechReady ? "online" : "sleeping-or-unavailable",
        voice: voiceReady ? "online" : "sleeping-or-unavailable"
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/providers") {
    sendJson(res, 200, {
      ok: true,
      selectedImageProvider: (getImageProvider() || {}).id || null,
      providers: getProviderCatalog()
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/capabilities") {
    sendJson(res, 200, {
      ok: true,
      engine: "TeslafieldAI",
      version: API_VERSION,
      capabilities: [
        { id: "image.generate", status: getImageProvider() ? "available" : "provider-required", method: "POST", endpoint: "/api/v1/image/generate" },
        { id: "video.generate", status: process.env.HF_VIDEO_SPACE_URL || process.env.POLLINATIONS_API_KEY ? "available" : "provider-required", method: "POST", endpoint: "/api/v1/video/generate" },
        { id: "audio.transcribe", status: "available", method: "POST", endpoint: "/api/v1/speech/transcribe" },
        { id: "audio.speak", status: "available", method: "POST", endpoint: "/api/v1/voice/synthesize" },
        { id: "creative.plan", status: "prototype" },
        { id: "provider.routing", status: "active" },
        { id: "self-hosted-adapter", status: process.env.SELF_HOSTED_IMAGE_ENDPOINT && process.env.SELF_HOSTED_IMAGE_MODEL ? "configured" : "ready-for-configuration" }
      ]
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/image/generate") {
    try {
      const input = await readJson(req, 8 * 1024);
      const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
      const ratio = typeof input.aspectRatio === "string" ? input.aspectRatio : "1:1";
      const dimensions = { "1:1": [1024, 1024], "16:9": [1536, 864], "9:16": [864, 1536] };

      if (!prompt) return sendJson(res, 400, { error: "PROMPT_REQUIRED", message: "Enter an image prompt first." });
      if (prompt.length > 2000) return sendJson(res, 400, { error: "PROMPT_TOO_LONG", message: "Image prompts must be 2,000 characters or fewer." });
      if (!dimensions[ratio]) return sendJson(res, 400, { error: "INVALID_ASPECT_RATIO", message: "Choose 1:1, 16:9 or 9:16." });

      const model = typeof input.model === "string" && input.model.trim() ? input.model.trim() : "black-forest-labs/FLUX.1-schnell";
      const allowedModels = new Set(["black-forest-labs/FLUX.1-schnell"]);
      if (!allowedModels.has(model)) return sendJson(res, 400, { error: "INVALID_IMAGE_MODEL", message: "Choose a supported image model." });

      const provider = getImageProvider();
      if (!provider) {
        return sendJson(res, 503, {
          error: "IMAGE_PROVIDER_NOT_CONFIGURED",
          message: "No image provider is configured. Configure a provider only after checking its costs, usage limits and terms. No generation request was sent."
        });
      }

      const result = await generateImage({ prompt, aspectRatio: ratio, dimensions: dimensions[ratio], model }, provider);
      sendJson(res, 200, {
        ok: true,
        provider: result.provider,
        model: result.model,
        image: result.image,
        aspectRatio: ratio
      });
    } catch (error) {
      if (error.message === "BODY_TOO_LARGE") return sendJson(res, 413, { error: "REQUEST_TOO_LARGE" });
      if (error.message === "INVALID_JSON") return sendJson(res, 400, { error: "INVALID_JSON" });
      if (error.message === "HUGGINGFACE_IMAGE_EMPTY_RESULT" || error.message === "HUGGINGFACE_IMAGE_DOWNLOAD_FAILED") return sendJson(res, 502, { error: error.message, message: "The Hugging Face Space did not return a downloadable image." });
      if (error.message === "HUGGINGFACE_IMAGE_SIZE_INVALID") return sendJson(res, 502, { error: error.message, message: "The generated image exceeded the response size limit." });
      if (error.message === "IMAGE_PROVIDER_EMPTY_RESULT") return sendJson(res, 502, { error: "IMAGE_PROVIDER_EMPTY_RESULT", message: "The provider returned no image." });
      if (error.providerStatus === 401) return sendJson(res, 502, { error: "IMAGE_PROVIDER_AUTH_FAILED", message: "The image provider rejected its credentials. Check the server-side secret." });
      if (error.providerStatus === 402) return sendJson(res, 402, { error: "IMAGE_PROVIDER_BALANCE_REQUIRED", message: "The provider reports that payment or balance is required. No automatic retry was made." });
      sendJson(res, 504, { error: "IMAGE_REQUEST_FAILED", message: "The image request timed out or the provider could not complete it." });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/video/generate") {
    try {
      const input = await readJson(req, 8 * 1024);
      const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
      const model = typeof input.model === "string" ? input.model.trim() : "bytedance/seedance-2.0-mini";
      const duration = Number(input.duration || 5);
      const allowedModels = new Set([
        "google/veo-3.1-fast",
        "bytedance/seedance-2.0-mini",
        "bytedance/seedance-2.0-fast",
        "alibaba/wan-2.2-fast",
        "x-ai/grok-imagine-video-1.5-lite",
        "Wan-AI/Wan2.2-TI2V-5B-Diffusers"
      ]);
      if (!prompt) return sendJson(res, 400, { error: "PROMPT_REQUIRED", message: "Enter a video prompt first." });
      if (prompt.length > 2000) return sendJson(res, 400, { error: "PROMPT_TOO_LONG", message: "Video prompts must be 2,000 characters or fewer." });
      if (!allowedModels.has(model)) return sendJson(res, 400, { error: "INVALID_VIDEO_MODEL", message: "Choose a supported video model." });
      if (process.env.HF_VIDEO_SPACE_URL ? duration !== 2 : ![5, 8, 10].includes(duration)) return sendJson(res, 400, { error: "INVALID_DURATION", message: process.env.HF_VIDEO_SPACE_URL ? "The free ZeroGPU starter profile supports 2-second clips." : "Choose 5, 8 or 10 seconds." });
      if (process.env.HF_VIDEO_SPACE_URL) {
        const video = await generateWithHuggingFaceVideo(prompt);
        return sendJson(res, 200, {
          ok: true,
          provider: "Hugging Face ZeroGPU",
          model: "Wan-AI/Wan2.2-TI2V-5B-Diffusers",
          duration: 2,
          video
        });
      }
      if (!process.env.POLLINATIONS_API_KEY) {
        return sendJson(res, 503, { error: "VIDEO_PROVIDER_NOT_CONFIGURED", message: "Connect your Hugging Face Video Space URL to enable Wan 2.2 generation. No generation request was sent." });
      }
      const target = "https://gen.pollinations.ai/video/" + encodeURIComponent(prompt) +
        "?model=" + encodeURIComponent(model) + "&duration=" + duration;
      const upstream = await fetch(target, {
        headers: { "Authorization": "Bearer " + process.env.POLLINATIONS_API_KEY },
        signal: AbortSignal.timeout(300000)
      });
      if (!upstream.ok) {
        const error = new Error("VIDEO_PROVIDER_ERROR");
        error.providerStatus = upstream.status;
        throw error;
      }
      const contentType = upstream.headers.get("content-type") || "";
      if (!contentType.includes("video/")) throw new Error("VIDEO_PROVIDER_INVALID_RESULT");
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("VIDEO_RESULT_SIZE_INVALID");
      sendJson(res, 200, {
        ok: true,
        provider: "Pollinations",
        model,
        duration,
        video: "data:video/mp4;base64," + bytes.toString("base64")
      });
    } catch (error) {
      if (error.message === "BODY_TOO_LARGE") return sendJson(res, 413, { error: "REQUEST_TOO_LARGE" });
      if (error.message === "INVALID_JSON") return sendJson(res, 400, { error: "INVALID_JSON" });
      if (error.message === "HUGGINGFACE_VIDEO_EMPTY_RESULT" || error.message === "HUGGINGFACE_VIDEO_DOWNLOAD_FAILED") return sendJson(res, 502, { error: error.message, message: "The Hugging Face Space did not return a downloadable video." });
      if (error.message === "HUGGINGFACE_VIDEO_SIZE_INVALID") return sendJson(res, 502, { error: error.message, message: "The generated video exceeded the response size limit." });
      if (error.message === "VIDEO_PROVIDER_INVALID_RESULT") return sendJson(res, 502, { error: "VIDEO_PROVIDER_INVALID_RESULT", message: "The provider did not return an MP4 video." });
      if (error.message === "VIDEO_RESULT_SIZE_INVALID") return sendJson(res, 502, { error: "VIDEO_RESULT_SIZE_INVALID", message: "The video was empty or exceeded the 20 MB response limit." });
      if (error.providerStatus === 401) return sendJson(res, 502, { error: "VIDEO_PROVIDER_AUTH_FAILED", message: "The provider rejected its credentials. Check the server-side secret." });
      if (error.providerStatus === 402) return sendJson(res, 402, { error: "VIDEO_PROVIDER_BALANCE_REQUIRED", message: "The provider requires available balance. No automatic retry was made." });
      if (error.providerStatus === 429) return sendJson(res, 429, { error: "VIDEO_PROVIDER_RATE_LIMITED", message: "The provider rate limit was reached. Try again later." });
      sendJson(res, 504, { error: "VIDEO_REQUEST_FAILED", message: "The video request timed out or the provider could not complete it." });
    }
    return;
  }


  if (req.method === "POST" && url.pathname === "/api/v1/chat/completions") {
    try {
      const input = await readJson(req, 48 * 1024);
      const messages = Array.isArray(input.messages) ? input.messages : [];
      if (!messages.length || messages.length > 30) return sendJson(res, 400, { error: "INVALID_MESSAGES", message: "Send between 1 and 30 chat messages." });
      if (messages.some((m) => !m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string" || m.content.length > 12000)) {
        return sendJson(res, 400, { error: "INVALID_MESSAGE_CONTENT", message: "Messages must contain valid text and be 12,000 characters or fewer." });
      }
      const safeMessages = messages.map((m) => ({ role: m.role, content: m.content.trim() })).filter((m) => m.content);
      if (!safeMessages.length) return sendJson(res, 400, { error: "MESSAGE_REQUIRED", message: "Enter a message first." });
      if (safeMessages.reduce((total, message) => total + message.content.length, 0) > 36000) {
        return sendJson(res, 413, { error: "CHAT_CONTEXT_TOO_LARGE", message: "Reduce the conversation length and try again." });
      }

      const idempotencyKey = req.headers["idempotency-key"] || "";
      if (idempotencyKey && (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey))) {
        return sendJson(res, 400, { error: "INVALID_IDEMPOTENCY_KEY", message: "Use a request id between 16 and 128 safe characters." });
      }
      const responseStyle = ["concise", "balanced", "detailed"].includes(input.response_style) ? input.response_style : "balanced";
      const selectedModel = typeof input.model === "string" && input.model.trim() ? input.model.trim() : "teslafield";
      if (selectedModel.length > 160 || !/^[A-Za-z0-9._:/-]+$/.test(selectedModel)) {
        return sendJson(res, 400, { error: "INVALID_MODEL", message: "Choose a model from the TeslafieldAI model selector." });
      }

      const createCompletion = async () => {
        if (selectedModel !== "teslafield") {
          if (!openRouterCatalog.configured) {
            const error = new Error("OpenRouter is not connected. Add OPENROUTER_API_KEY to the backend environment to enable these models.");
            error.statusCode = 503;
            error.errorCode = "MODEL_PROVIDER_NOT_CONFIGURED";
            throw error;
          }
          let model;
          try { model = await openRouterCatalog.findModel(selectedModel); }
          catch (catalogError) {
            const error = new Error("The OpenRouter model catalogue is temporarily unavailable. Try again or choose TeslafieldAI Free.");
            error.statusCode = 503;
            error.errorCode = "MODEL_CATALOG_UNAVAILABLE";
            throw error;
          }
          if (!model || model.freeTier !== true || !model.id.endsWith(":free")) {
            const error = new Error("Only OpenRouter models explicitly marked :free are allowed.");
            error.statusCode = 400;
            error.errorCode = "FREE_MODEL_ONLY";
            throw error;
          }
          let upstream;
          try {
            upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + process.env.OPENROUTER_API_KEY,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://teslafieldai.web.app",
              "X-Title": "TeslafieldAI"
            },
            body: JSON.stringify({
              // Send only the user's exact selected model ID. No router or model fallback.
              model: model.id,
              messages: [{ role: "system", content: "You are TeslafieldAI, a helpful, accurate and respectful AI assistant. Be clear about uncertainty and never claim actions you have not performed. Response style: " + ({ concise: "be brief and direct", balanced: "give a clear answer with useful context", detailed: "provide thorough explanations and examples when useful" }[responseStyle] || "give a clear answer with useful context") + "." }, ...safeMessages],
              // Enforce the strictest provider-side privacy route available.
              // If no eligible endpoint exists, the request fails rather than falling back.
              provider: {
                zdr: true,
                data_collection: "deny",
                allow_fallbacks: false
              },
              max_tokens: 384
            }),
            signal: AbortSignal.timeout(240000)
            });
          } catch (providerError) {
            const error = new Error("OpenRouter could not be reached. Check provider status and try again.");
            error.statusCode = 504;
            error.errorCode = "MODEL_PROVIDER_UNAVAILABLE";
            throw error;
          }
          const data = await upstream.json().catch(() => ({}));
          if (!upstream.ok) {
            const error = new Error("OpenRouter could not complete this request. Check provider access, account limits and model availability.");
            error.statusCode = upstream.status === 429 ? 429 : upstream.status === 402 ? 402 : 502;
            error.errorCode = upstream.status === 402 ? "MODEL_CREDITS_REQUIRED" : upstream.status === 429 ? "MODEL_RATE_LIMITED" : "MODEL_PROVIDER_ERROR";
            throw error;
          }
          const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          if (typeof reply !== "string" || !reply.trim()) {
            const error = new Error("The selected model returned no text.");
            error.statusCode = 502;
            error.errorCode = "EMPTY_MODEL_RESPONSE";
            throw error;
          }
          return { ok: true, model: model.name, model_id: model.id, provider: "OpenRouter", free: model.free, reply: reply.trim() };
        }
        const upstream = await fetch(CHAT_SPACE_URL + "/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: safeMessages, max_new_tokens: 384, response_style: responseStyle }),
          signal: AbortSignal.timeout(240000)
        });
        const data = await upstream.json().catch(() => ({}));
        if (!upstream.ok) {
          const error = new Error(
            typeof data.detail === "string" && data.detail
              ? data.detail
              : "The TESLAFIELD Chat Space could not complete this request. It may still be waking up or loading its model."
          );
          error.statusCode = upstream.status === 429 ? 429 : 502;
          error.errorCode = "CHAT_SPACE_ERROR";
          throw error;
        }
        const reply = data.response;
        if (typeof reply !== "string" || !reply.trim()) {
          const error = new Error("The Chat Space returned no text.");
          error.statusCode = 502;
          error.errorCode = "EMPTY_CHAT_RESPONSE";
          throw error;
        }
        return {
          ok: true,
          model: data.model || "TeslafieldAI",
          model_id: data.model_id || "Qwen/Qwen3-0.6B",
          reply
        };
      };

      let result;
      if (idempotencyKey) {
        const fingerprint = crypto.createHash("sha256")
          .update(JSON.stringify({ messages: safeMessages, response_style: responseStyle, model: selectedModel }))
          .digest("hex");
        const scopedKey = String(req.authUser && req.authUser.uid || "unknown") + ":" + idempotencyKey;
        result = await chatIdempotencyStore.run(scopedKey, fingerprint, createCompletion);
      } else {
        result = await createCompletion();
      }

      audit("chat.completed", req.authUser && req.authUser.uid, url.pathname);
      return sendJson(res, 200, result);
    } catch (error) {
      if (error.code === "IDEMPOTENCY_KEY_CONFLICT") {
        return sendJson(res, 409, { error: error.code, message: error.message });
      }
      if (error.code === "IDEMPOTENCY_STORE_FULL") {
        return sendJson(res, 503, { error: error.code, message: error.message });
      }
      if (error.message === "BODY_TOO_LARGE") return sendJson(res, 413, { error: "REQUEST_TOO_LARGE" });
      if (error.message === "INVALID_JSON") return sendJson(res, 400, { error: "INVALID_JSON" });
      if (Number.isInteger(error.statusCode)) {
        return sendJson(res, error.statusCode, { error: error.errorCode || "CHAT_SPACE_ERROR", message: error.message });
      }
      return sendJson(res, 504, { error: "CHAT_REQUEST_FAILED", message: "The Chat Space timed out or is still loading. Please retry in a moment." });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/v1/chat/stream") {
    const upstreamController = new AbortController();
    const timeout = setTimeout(() => upstreamController.abort(), 240000);
    const onClientClose = () => { if (!res.writableEnded) upstreamController.abort(); };
    res.once("close", onClientClose);
    try {
      const input = await readJson(req, 48 * 1024);
      const messages = Array.isArray(input.messages) ? input.messages : [];
      if (!messages.length || messages.length > 30) {
        sendJson(res, 400, { error: "INVALID_MESSAGES", message: "Send between 1 and 30 chat messages." });
        return;
      }
      if (messages.some((m) => !m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string" || m.content.length > 12000)) {
        sendJson(res, 400, { error: "INVALID_MESSAGE_CONTENT", message: "Messages must contain valid text and be 12,000 characters or fewer." });
        return;
      }
      const safeMessages = messages.map((m) => ({ role: m.role, content: m.content.trim() })).filter((m) => m.content);
      if (!safeMessages.length) {
        sendJson(res, 400, { error: "MESSAGE_REQUIRED", message: "Enter a message first." });
        return;
      }
      if (safeMessages.reduce((total, message) => total + message.content.length, 0) > 36000) {
        sendJson(res, 413, { error: "CHAT_CONTEXT_TOO_LARGE", message: "Reduce the conversation length and try again." });
        return;
      }
      const responseStyle = ["concise", "balanced", "detailed"].includes(input.response_style) ? input.response_style : "balanced";
      const upstream = await fetch(CHAT_SPACE_URL + "/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "text/plain" },
        body: JSON.stringify({ messages: safeMessages, max_new_tokens: 384, response_style: responseStyle }),
        signal: upstreamController.signal
      });
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => "");
        sendJson(res, upstream.status === 429 ? 429 : 502, {
          error: "CHAT_STREAM_PROVIDER_ERROR",
          message: detail.slice(0, 500) || "The TESLAFIELD Chat Space is waking up or loading its model."
        });
        return;
      }
      if (!upstream.body) {
        sendJson(res, 502, { error: "CHAT_STREAM_EMPTY", message: "The Chat Space did not open a response stream." });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Content-Type-Options": "nosniff",
        "X-Accel-Buffering": "no"
      });
      const reader = upstream.body.getReader();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done || res.destroyed) break;
          if (part.value && part.value.length) {
            const canContinue = res.write(Buffer.from(part.value));
            if (!canContinue && !res.destroyed) {
              await new Promise((resolve) => {
                const finish = () => { res.off("drain", finish); res.off("close", finish); resolve(); };
                res.once("drain", finish);
                res.once("close", finish);
              });
            }
          }
        }
      } finally {
        try { reader.releaseLock(); } catch (error) {}
      }
      if (!res.destroyed) {
        audit("chat.stream_completed", req.authUser && req.authUser.uid, url.pathname);
        res.end();
      }
    } catch (error) {
      if (!res.headersSent && !res.destroyed) {
        if (error.message === "BODY_TOO_LARGE") sendJson(res, 413, { error: "REQUEST_TOO_LARGE" });
        else if (error.message === "INVALID_JSON") sendJson(res, 400, { error: "INVALID_JSON" });
        else sendJson(res, 504, { error: "CHAT_STREAM_FAILED", message: "The Chat Space timed out or is still loading. Please retry." });
      } else if (!res.destroyed && !res.writableEnded) {
        res.end();
      }
    } finally {
      clearTimeout(timeout);
      res.off("close", onClientClose);
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/speech/transcribe") {
    try {
      const input = await readJson(req, 12 * 1024 * 1024);
      const encoded = typeof input.audioBase64 === "string" ? input.audioBase64.replace(/^data:[^,]+,/, "") : "";
      if (!encoded) return sendJson(res, 400, { error: "AUDIO_REQUIRED", message: "Record or upload audio first." });
      validateAudioPayload(encoded, input.mimeType);
      const transcript = await transcribeWithSpace(encoded, input.mimeType, input.language);
      return sendJson(res, 200, { ok: true, transcript, model: "Systran/faster-whisper-base" });
    } catch (error) {
      if (error.message === "BODY_TOO_LARGE") return sendJson(res, 413, { error: "AUDIO_TOO_LARGE", message: "Please record a shorter audio clip." });
      if (error.message === "EMPTY_TRANSCRIPT") return sendJson(res, 200, { ok: true, transcript: "", message: "No speech detected." });
      if (error.message === "AUDIO_SIZE_INVALID") return sendJson(res, 413, { error: "AUDIO_TOO_LARGE", message: "Audio must be under 8 MB." });
      if (error.message === "AUDIO_TYPE_INVALID") return sendJson(res, 415, { error: "UNSUPPORTED_AUDIO_TYPE", message: "Upload a supported audio recording only." });
      audit("speech.failed", req.authUser && req.authUser.uid, url.pathname);
      return sendJson(res, 502, { error: "SPEECH_REQUEST_FAILED", message: "The Whisper Space is unavailable or still loading. Please retry." });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/v1/voice/synthesize") {
    try {
      const input = await readJson(req, 8 * 1024);
      const text = typeof input.text === "string" ? input.text.trim() : "";
      if (!text) return sendJson(res, 400, { error: "TEXT_REQUIRED", message: "Enter text to speak." });
      if (text.length > 1500) return sendJson(res, 400, { error: "TEXT_TOO_LONG", message: "Voice requests must be 1,500 characters or fewer." });
      const audio = await synthesizeWithSpace(text, input.language, input.voice);
      return sendJson(res, 200, { ok: true, audio, model: "Oomni/mithi-v2-flash" });
    } catch (error) {
      return sendJson(res, 502, { error: "VOICE_REQUEST_FAILED", message: "The Mithi Voice Space is unavailable or still loading. Please retry." });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/v1/creative/plan") {
    try {
      await readJson(req);
      sendJson(res, 503, {
        error: "AI_DIRECTOR_NOT_CONNECTED",
        message: "The TESLAFIELD planning engine is not connected yet. No AI request was sent."
      });
    } catch (error) {
      if (error.message === "BODY_TOO_LARGE") sendJson(res, 413, { error: "REQUEST_TOO_LARGE" });
      else if (error.message === "INVALID_JSON") sendJson(res, 400, { error: "INVALID_JSON" });
      else sendJson(res, 400, { error: "INVALID_REQUEST" });
    }
    return;
  }

  sendJson(res, 404, { error: "NOT_FOUND" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}`);
});
