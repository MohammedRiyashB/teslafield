const http = require("node:http");

const PORT = Number(process.env.PORT || 10000);
const SERVICE_NAME = "teslafield-api";
const API_VERSION = "v1";
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

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
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("BODY_TOO_LARGE"));
        req.destroy();
        return;
      }
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (!body.trim()) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("INVALID_JSON")); }
    });
    req.on("error", reject);
  });
}

/*
 * TESLAFIELD Universal AI Engine
 * Provider adapters are isolated from routes so new providers can be added
 * without changing the frontend contract.
 */
function getImageProvider() {
  const requested = (process.env.IMAGE_PROVIDER || "").trim().toLowerCase();
  const selfHostedEndpoint = (process.env.SELF_HOSTED_IMAGE_ENDPOINT || "").trim();
  const selfHostedModel = (process.env.SELF_HOSTED_IMAGE_MODEL || "").trim();

  const providers = {
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
  if (requested === "pollinations" && providers.pollinations.configured) return providers.pollinations;
  if (!requested && providers.selfHosted.configured) return providers.selfHosted;
  if (!requested && providers.pollinations.configured) return providers.pollinations;
  return null;
}

function getProviderCatalog() {
  const selected = getImageProvider();
  return [
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

async function generateWithPollinations(input) {
  const [width, height] = input.dimensions;
  const response = await fetch("https://gen.pollinations.ai/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + process.env.POLLINATIONS_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "black-forest-labs/flux.1-schnell",
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
  if (provider.id === "pollinations") return generateWithPollinations(input);
  if (provider.id === "self-hosted") return generateWithSelfHosted(input);
  throw new Error("IMAGE_PROVIDER_UNSUPPORTED");
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
      sendJson(res, 403, { error: "ORIGIN_NOT_ALLOWED" });
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", allowedOrigins.length ? origin : "*");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

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

  if (req.method === "GET" && url.pathname === "/api/v1/status") {
    const provider = getImageProvider();
    sendJson(res, 200, {
      service: SERVICE_NAME,
      apiVersion: API_VERSION,
      mode: "hybrid-foundation",
      engine: "TESLAFIELD Universal AI Engine",
      integrations: {
        imageGeneration: Boolean(provider),
        imageProvider: provider ? provider.name : null,
        videoGeneration: false,
        audioGeneration: false,
        authentication: false,
        database: false
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
      engine: "TESLAFIELD Universal AI Engine",
      version: API_VERSION,
      capabilities: [
        { id: "image.generate", status: getImageProvider() ? "available" : "provider-required", method: "POST", endpoint: "/api/v1/image/generate" },
        { id: "video.generate", status: "planned" },
        { id: "audio.generate", status: "planned" },
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

      const provider = getImageProvider();
      if (!provider) {
        return sendJson(res, 503, {
          error: "IMAGE_PROVIDER_NOT_CONFIGURED",
          message: "No image provider is configured. Configure a provider only after checking its costs, usage limits and terms. No generation request was sent."
        });
      }

      const result = await generateImage({ prompt, aspectRatio: ratio, dimensions: dimensions[ratio] }, provider);
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
      if (error.message === "IMAGE_PROVIDER_EMPTY_RESULT") return sendJson(res, 502, { error: "IMAGE_PROVIDER_EMPTY_RESULT", message: "The provider returned no image." });
      if (error.providerStatus === 401) return sendJson(res, 502, { error: "IMAGE_PROVIDER_AUTH_FAILED", message: "The image provider rejected its credentials. Check the server-side secret." });
      if (error.providerStatus === 402) return sendJson(res, 402, { error: "IMAGE_PROVIDER_BALANCE_REQUIRED", message: "The provider reports that payment or balance is required. No automatic retry was made." });
      sendJson(res, 504, { error: "IMAGE_REQUEST_FAILED", message: "The image request timed out or the provider could not complete it." });
    }
    return;
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
