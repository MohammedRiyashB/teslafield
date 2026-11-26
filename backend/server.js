const http = require("node:http");

const PORT = Number(process.env.PORT || 10000);
const SERVICE_NAME = "teslafield-api";
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
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });

    req.on("error", reject);
  });
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
    const imageProviderConfigured = Boolean(process.env.POLLINATIONS_API_KEY);
    sendJson(res, 200, {
      service: SERVICE_NAME,
      apiVersion: "v1",
      mode: "prototype",
      integrations: {
        imageGeneration: imageProviderConfigured,
        imageProvider: imageProviderConfigured ? "Pollinations" : null,
        videoGeneration: false,
        audioGeneration: false,
        authentication: false,
        database: false
      }
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/image/generate") {
    try {
      const input = await readJson(req, 8 * 1024);
      const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
      const ratio = typeof input.aspectRatio === "string" ? input.aspectRatio : "1:1";
      const dimensions = {
        "1:1": [1024, 1024],
        "16:9": [1536, 864],
        "9:16": [864, 1536]
      };

      if (!prompt) {
        sendJson(res, 400, { error: "PROMPT_REQUIRED", message: "Enter an image prompt first." });
        return;
      }
      if (prompt.length > 2000) {
        sendJson(res, 400, { error: "PROMPT_TOO_LONG", message: "Image prompts must be 2,000 characters or fewer." });
        return;
      }
      if (!dimensions[ratio]) {
        sendJson(res, 400, { error: "INVALID_ASPECT_RATIO", message: "Choose 1:1, 16:9 or 9:16." });
        return;
      }

      const apiKey = process.env.POLLINATIONS_API_KEY;
      if (!apiKey) {
        sendJson(res, 503, {
          error: "IMAGE_PROVIDER_NOT_CONFIGURED",
          message: "Image generation is not enabled yet. Add a provider key to Render after reviewing its pricing. No generation request was sent."
        });
        return;
      }

      const [width, height] = dimensions[ratio];
      const providerResponse = await fetch("https://gen.pollinations.ai/v1/images/generations", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "black-forest-labs/flux.1-schnell",
          prompt,
          n: 1,
          size: width + "x" + height,
          response_format: "b64_json"
        }),
        signal: AbortSignal.timeout(120000)
      });

      const providerBody = await providerResponse.json().catch(() => ({}));
      if (!providerResponse.ok) {
        const providerStatus = providerResponse.status;
        if (providerStatus === 401) {
          sendJson(res, 502, { error: "IMAGE_PROVIDER_AUTH_FAILED", message: "The image provider rejected its API key. Check the Render secret." });
        } else if (providerStatus === 402) {
          sendJson(res, 402, { error: "IMAGE_PROVIDER_BALANCE_REQUIRED", message: "The provider account has no available generation balance. No further request will be attempted." });
        } else {
          sendJson(res, 502, { error: "IMAGE_PROVIDER_ERROR", message: "The image provider could not complete this request. Try again later." });
        }
        return;
      }

      const item = providerBody && Array.isArray(providerBody.data) ? providerBody.data[0] : null;
      if (!item || (!item.b64_json && !item.url)) {
        sendJson(res, 502, { error: "IMAGE_PROVIDER_EMPTY_RESULT", message: "The provider returned no image. Try again later." });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        provider: "Pollinations",
        model: "black-forest-labs/flux.1-schnell",
        image: item.b64_json ? "data:image/png;base64," + item.b64_json : item.url,
        aspectRatio: ratio
      });
    } catch (error) {
      if (error.message === "BODY_TOO_LARGE") {
        sendJson(res, 413, { error: "REQUEST_TOO_LARGE" });
      } else if (error.message === "INVALID_JSON") {
        sendJson(res, 400, { error: "INVALID_JSON" });
      } else {
        sendJson(res, 504, { error: "IMAGE_REQUEST_FAILED", message: "The image request timed out or could not be completed." });
      }
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
      if (error.message === "BODY_TOO_LARGE") {
        sendJson(res, 413, { error: "REQUEST_TOO_LARGE" });
      } else if (error.message === "INVALID_JSON") {
        sendJson(res, 400, { error: "INVALID_JSON" });
      } else {
        sendJson(res, 400, { error: "INVALID_REQUEST" });
      }
    }
    return;
  }

  sendJson(res, 404, { error: "NOT_FOUND" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}`);
});
