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

  // Set CORS_ORIGIN in Render to your exact Firebase Hosting origin(s),
  // comma-separated, once the frontend URL is known.
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
    sendJson(res, 200, {
      service: SERVICE_NAME,
      apiVersion: "v1",
      mode: "prototype",
      integrations: {
        imageGeneration: false,
        videoGeneration: false,
        audioGeneration: false,
        authentication: false,
        database: false
      }
    });
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
