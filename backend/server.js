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

const CHAT_SPACE_URL = process.env.HF_CHAT_SPACE_URL || "https://earthaioa-earth-os-v10-docker.hf.space";
const SPEECH_SPACE_ID = process.env.HF_SPEECH_SPACE_ID || "Earthaioa/OpenWhisper-Small";
const VOICE_SPACE_ID = process.env.HF_VOICE_SPACE_ID || "Earthaioa/Earthaioa-Kokoro-TTS";

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
  const target = fileUrl.startsWith("http") ? fileUrl : new URL(fileUrl, "https://earthaioa-earthaioa-kokoro-tts.hf.space").toString();
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
      mode: "assistant-chat",
      engine: "TESLAFIELD Chat API",
      integrations: {
        imageGeneration: Boolean(provider),
        imageProvider: provider ? provider.name : null,
        videoGeneration: Boolean(process.env.HF_VIDEO_SPACE_URL || process.env.POLLINATIONS_API_KEY),
        audioGeneration: Boolean(process.env.HF_VOICE_SPACE_ID || true),
        speechToText: true,
        voiceGeneration: true,
        authentication: false,
        database: false,
        textChat: Boolean(CHAT_SPACE_URL)
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
      engine: "TESLAFIELD Chat API",
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
      const safeMessages = messages.map((m) => ({ role: m && ["user", "assistant"].includes(m.role) ? m.role : "user", content: typeof (m && m.content) === "string" ? m.content.slice(0, 12000) : "" })).filter((m) => m.content.trim());
      if (!safeMessages.length) return sendJson(res, 400, { error: "MESSAGE_REQUIRED", message: "Enter a message first." });
      const upstream = await fetch(CHAT_SPACE_URL + "/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: safeMessages, max_new_tokens: 384 }),
        signal: AbortSignal.timeout(240000)
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) return sendJson(res, upstream.status === 429 ? 429 : 502, { error: "CHAT_SPACE_ERROR", message: data.detail || "The TESLAFIELD Chat Space could not complete this request. It may still be waking up or loading its model." });
      const reply = data.response;
      if (typeof reply !== "string" || !reply.trim()) return sendJson(res, 502, { error: "EMPTY_CHAT_RESPONSE", message: "The Chat Space returned no text." });
      return sendJson(res, 200, { ok: true, model: data.model || "Qwen/Qwen3-0.6B", reply });
    } catch (error) {
      if (error.message === "BODY_TOO_LARGE") return sendJson(res, 413, { error: "REQUEST_TOO_LARGE" });
      if (error.message === "INVALID_JSON") return sendJson(res, 400, { error: "INVALID_JSON" });
      return sendJson(res, 504, { error: "CHAT_REQUEST_FAILED", message: "The Chat Space timed out or is still loading. Please retry in a moment." });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/v1/speech/transcribe") {
    try {
      const input = await readJson(req, 12 * 1024 * 1024);
      const encoded = typeof input.audioBase64 === "string" ? input.audioBase64.replace(/^data:[^,]+,/, "") : "";
      if (!encoded) return sendJson(res, 400, { error: "AUDIO_REQUIRED", message: "Record or upload audio first." });
      const transcript = await transcribeWithSpace(encoded, input.mimeType, input.language);
      return sendJson(res, 200, { ok: true, transcript, model: "Systran/faster-whisper-base" });
    } catch (error) {
      if (error.message === "BODY_TOO_LARGE") return sendJson(res, 413, { error: "AUDIO_TOO_LARGE", message: "Please record a shorter audio clip." });
      if (error.message === "EMPTY_TRANSCRIPT") return sendJson(res, 200, { ok: true, transcript: "", message: "No speech detected." });
      if (error.message === "AUDIO_SIZE_INVALID") return sendJson(res, 413, { error: "AUDIO_TOO_LARGE", message: "Audio must be under 8 MB." });
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
