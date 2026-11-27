# TeslafieldAI API

Node.js API for the TESLAFIELD web app and ChatGPT MCP connection.

## Render service settings

- Runtime: Node
- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`
- Keep one service instance while OAuth authorization codes are stored in the process-local one-time code store. Use shared persistent storage before scaling horizontally.

## Core endpoints

- `GET /` — service information
- `GET /health` — Render health check
- `GET /api/v1/status` — integration status
- `GET /api/v1/warmup` — warmup checks for the AI integrations
- `POST /api/v1/chat/completions` — Firebase-authenticated TeslafieldAI chat
- `POST /api/v1/chat/stream` — Firebase-authenticated chat stream
- `POST /api/v1/speech/transcribe` — Firebase-authenticated speech transcription
- `POST /api/v1/voice/synthesize` — Firebase-authenticated voice synthesis

## ChatGPT MCP connection

- MCP endpoint: `https://teslafield-api.onrender.com/mcp`
- Protected resource metadata: `/.well-known/oauth-protected-resource`
- Authorization server metadata: `/.well-known/oauth-authorization-server`
- OAuth authorization endpoint: `/oauth/authorize`
- OAuth token endpoint: `/oauth/token`
- Firebase sign-in and consent page: `https://teslafieldai.web.app/oauth`
- MCP tool: `ask_teslafield`

The MCP service exposes only the TeslafieldAI text-chat capability. Users sign in with the existing Google/Firebase account, explicitly approve the connection, and receive a short-lived OAuth access token scoped to `teslafield:chat`. The Google password and Firebase ID token are never sent to ChatGPT. OAuth uses authorization code + PKCE (S256), validates ChatGPT's Client ID Metadata Document, and binds issued tokens to the MCP resource.

## Required Render environment variable

Set `TESLAFIELD_OAUTH_SECRET` to a random secret of at least 32 characters. Generate one securely with:

```bash
openssl rand -base64 48
```

Keep this value only in Render's environment settings. Do not commit it or paste it into GitHub. Rotating it immediately invalidates existing MCP access tokens.

Optional settings:
- `PUBLIC_BASE_URL` — defaults to `https://teslafield-api.onrender.com`
- `TESLAFIELD_OAUTH_PAGE` — defaults to `https://teslafieldai.web.app/oauth`
- `FIREBASE_PROJECT_ID` — defaults to `teslafieldai`
- `CORS_ORIGIN` — comma-separated trusted web origins; the default includes the TESLAFIELD Firebase Hosting domains

Firebase Authentication must have the Google provider enabled and `teslafieldai.web.app` registered as an authorized domain.

## Security and scaling notes

Chat completion requests may send an `Idempotency-Key` header. The API scopes this key to the authenticated Firebase user and request payload, coalesces concurrent retries and caches successful responses for five minutes. Reusing the same key with different request content returns HTTP 409. This first implementation is process-local and bounded to 1,000 entries; it protects retries on a single API instance only. It is not a distributed lock. Keep a single Render instance until both OAuth authorization state and idempotency state are moved to a shared store.

OAuth authorization requests and single-use authorization codes are held in process memory with short expirations; access tokens are HMAC-signed and resource-scoped. Keep this Render service at one instance for this initial release. Before scaling to multiple instances or using multiple regions, move the short-lived authorization state and one-time code store to shared Redis/Key Value or a database.

Do not add model provider keys, OAuth signing secrets, Firebase service-account keys or user tokens to frontend files or the public repository.
