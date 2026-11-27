# TeslafieldAI

TeslafieldAI is an independent AI assistant project with a browser-based chat interface, Google sign-in, a Node.js API, a Hugging Face-hosted Qwen chat engine, speech/voice integrations, and a ChatGPT MCP/OAuth connector.

## Current architecture

| Layer | Current implementation | Status |
|---|---|---|
| Web client | Static HTML, CSS and JavaScript; installable PWA shell | Implemented |
| Authentication | Firebase Authentication with Google sign-in; API verifies Firebase ID tokens | Implemented |
| Chat API | Node.js HTTP service on Render | Implemented |
| Chat model | TeslafieldAI Qwen3-0.6B; optional OpenRouter `:free` text-chat models | Exact selected ID only; no paid models or automatic fallback |
| Response UX | Complete-response chat with a thinking indicator; token-by-token rendering is intentionally not used by the current web client | Implemented |
| Speech input | Browser MediaRecorder + speech transcription endpoint | Implemented; provider availability varies |
| Voice output | Text-to-speech endpoint | Implemented; provider availability varies |
| MCP connector | OAuth authorization-code flow with PKCE and teslafield:chat scope | Implemented |
| Hosting | Firebase Hosting for the web client; Render for the API; Hugging Face Spaces for model services | Configured in repository |
| Persistence | Browser cache plus optional Firebase Cloud Firestore conversation storage | Stage 6 implementation; Firestore setup required |
| Live duplex voice | No end-to-end WebRTC conversational voice session is currently implemented | Not implemented |
| File understanding | Attachments are selected locally but file analysis/upload is not enabled | Not implemented |
| Billing / credits | No payment processor or durable credit ledger is configured | Not implemented |

The project is an AI chat assistant. It is not the unrelated static creative-studio prototype described in an earlier version of this README.

## Repository layout

- index.html, styles.css, app.js — TeslafieldAI web application.
- theme-init.js, manifest.webmanifest, sw.js — theme initialization and PWA support.
- oauth.html, oauth.js — Firebase sign-in and consent page for the ChatGPT connector.
- backend/server.js — API, Firebase token verification, rate limiting, chat, speech and voice routes.
- backend/model-catalog.js — server-side OpenRouter text-model catalogue and pricing metadata.\n- backend/conversation-store.js and firestore.rules — owner-scoped Firestore conversation storage and security rules.
- backend/oauth-mcp.js — OAuth and MCP resource/authorization endpoints.
- huggingface/chat-space/ — Qwen3-0.6B chat Space.
- huggingface/speech-space/, huggingface/voice-space/ — speech and voice Space integrations.
- huggingface/image-space/, huggingface/video-space/ — optional media-generation Space projects.
- .github/workflows/ — validation and deployment workflows.
- chatgpt-privacy.html, chatgpt-terms.html — legal pages for the ChatGPT connector.

## Run the web client locally

The web client is static and does not require a root-level package installation.

1. Clone this repository.
2. Run a static server from the repository root, for example:

   ```bash
   python -m http.server 8000
   ```

3. Open http://localhost:8000.

The Firebase web configuration and authorized domains must match the deployed project for sign-in to work.

## Run the API locally

Requirements: Node.js 20 or newer.

```bash
cd backend
npm install
npm start
```

Set the required environment variables before using protected features. See backend/README.md for Render configuration, OAuth secret handling, provider settings and API routes.

Never put model-provider API keys, Firebase service-account credentials, OAuth signing secrets or user tokens in browser files or public GitHub commits.

## ChatGPT connector

The MCP endpoint is:

https://teslafield-api.onrender.com/mcp

The connector uses Firebase/Google sign-in on the TeslafieldAI consent page and an OAuth authorization-code flow with PKCE. It requests the teslafield:chat scope. The backend must have a strong TESLAFIELD_OAUTH_SECRET configured in its private environment.

See backend/README.md and the connector legal pages for details.

## Free-tier and reliability notes

- Hugging Face Spaces and free hosting tiers may sleep, queue requests, impose limits or change availability.
- A successful health check does not prove that a model is loaded or that inference will succeed.
- The local TeslafieldAI model remains the default and does not require an OpenRouter key.
- Optional OpenRouter routing is disabled until `OPENROUTER_API_KEY` is configured on the backend. Only explicitly `:free` model IDs are accepted; paid model IDs are rejected and no model/provider fallback is used. Requests require ZDR-eligible endpoints and deny non-transient data collection, so they can fail when no eligible free endpoint is available.
- Model preferences are saved in this browser. The composer now uses a branded Teslafield B1 capsule and an upward-opening model catalogue. Provider keys are never stored in the frontend. No automatic paid-model fallback is performed.
- No paid provider should be enabled without an explicit budget decision.
- Stage 6 adds authenticated Firestore cloud-history endpoints and local-cache synchronization. Cloud sync remains inactive until the owner creates the default Firestore database and deploys `firestore.rules`; see backend/README.md. Browser-local history remains the fallback.
- The current Render Free API is a single instance. Rate-limit buckets, OAuth authorization state/codes and idempotency results are process-local; do not scale horizontally until all of these stores are migrated to a shared, same-region store and verified.
- The current text chat uses a non-streaming response contract in the browser, even though the model Space and API retain a separate stream endpoint.
- The current microphone workflow is speech capture/transcription, not a full low-latency, interruptible duplex voice conversation.

## Engineering upgrade

See docs/ENGINEERING_UPGRADE.md for the repository audit, verified limitations, staged roadmap and acceptance criteria across the nine engineering categories. See docs/PRODUCTION_SECURITY_REVIEW_2026-11-27.md for the current security review, production smoke-test scope and remaining go-live gates.

## Security

- Protected API routes require a verified Firebase ID token.
- Keep CORS origins restricted to trusted frontend origins.
- Keep secrets in Render/Hugging Face/GitHub secret settings, never in source files.
- Read `privacy.html` and `docs/PRODUCTION_SECURITY_REVIEW_2026-11-27.md` for provider data flows, retention limits and unresolved production risks. Request-level OpenRouter privacy controls are not a blanket no-logging guarantee.
- Do not claim uptime, latency, model quality or global scale without measurements.

## Licence

No root-level licence file is currently present. Add and review a licence before accepting external contributions or granting broad reuse rights.
