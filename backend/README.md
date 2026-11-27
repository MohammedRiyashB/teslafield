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
- `GET /api/v1/models` — available free and paid text models; paid catalogue requires OpenRouter configuration
- `GET /api/v1/warmup` — warmup checks for the AI integrations
- `GET /api/v1/conversations` — Firebase-authenticated list of the signed-in user's cloud conversations
- `PUT /api/v1/conversations` — Firebase-authenticated create/update of one owned conversation
- `DELETE /api/v1/conversations?id=<conversation-id>` — delete one owned cloud conversation
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
- `OPENROUTER_API_KEY` — optional server-side key for OpenRouter free and paid chat models. Store only in Render environment settings. The local TeslafieldAI Qwen model remains the default when this is absent. Paid models are selected explicitly by the user and can incur OpenRouter charges; there is no automatic paid fallback.
- `PUBLIC_BASE_URL` — defaults to `https://teslafield-api.onrender.com`
- `TESLAFIELD_OAUTH_PAGE` — defaults to `https://teslafieldai.web.app/oauth`
- `FIREBASE_PROJECT_ID` — defaults to `teslafieldai`
- `CORS_ORIGIN` — comma-separated trusted web origins; the default includes the TESLAFIELD Firebase Hosting domains

Firebase Authentication must have the Google provider enabled and `teslafieldai.web.app` registered as an authorized domain.

## Security and scaling notes

Chat completion requests may send an `Idempotency-Key` header. The API scopes this key to the authenticated Firebase user and request payload, coalesces concurrent retries and caches successful responses for five minutes. Reusing the same key with different request content returns HTTP 409. This first implementation is process-local and bounded to 1,000 entries; it protects retries on a single API instance only. It is not a distributed lock. Keep a single Render instance until both OAuth authorization state and idempotency state are moved to a shared store.

OAuth authorization requests and single-use authorization codes are held in process memory with short expirations; access tokens are HMAC-signed and resource-scoped. Keep this Render service at one instance for this initial release. Before scaling to multiple instances or using multiple regions, move the short-lived authorization state and one-time code store to shared Redis/Key Value or a database.

Do not add model provider keys, OAuth signing secrets, Firebase service-account keys or user tokens to frontend files or the public repository.

## Model selection

The browser model selector defaults to the existing TeslafieldAI Qwen3-0.6B Space. If `OPENROUTER_API_KEY` is configured, the API loads the current OpenRouter text-chat catalogue, separates zero-priced models from paid models, and returns price-per-million-token metadata for the UI. The browser sends only the selected model ID; the provider key remains on the server. The API validates model IDs against the live provider catalogue before making a request and includes the selected model in the idempotency fingerprint. Free provider models can still be rate-limited or unavailable. Paid models are never selected automatically; users must explicitly choose one.


## Cloud conversation history (Stage 6)

The API stores conversations in the existing Firebase project's default Cloud Firestore database. It uses the caller's Firebase ID token with the Firestore REST API, so Firestore Security Rules enforce ownership; no service-account private key or paid database is added to the backend.

Before cloud sync can work, the project owner must:
1. Open the Firebase console for project `teslafieldai` and create/enable the default Cloud Firestore database (choose a region after reviewing data-residency needs).
2. From a trusted local checkout with Firebase CLI authenticated as a project administrator, run `firebase deploy --only firestore:rules --project teslafieldai`. The repository's `firestore.rules` allows a signed-in user to access only `users/{their-uid}/conversations/*`.
3. Confirm the Firestore API is enabled for the project. The app will continue using browser-local history if Firestore is not ready.

The Firebase Spark plan currently includes a no-cost Firestore Standard quota of 1 GiB stored data, 50,000 document reads/day, 20,000 writes/day, 20,000 deletes/day and 10 GiB/month outbound transfer. The free quota applies to one database per project; on Spark, reaching a quota can stop that product until the next monthly cycle. Check the current Firebase pricing and quotas before enabling public usage.\n\nThe web client keeps its localStorage cache for offline resilience, merges remote and local conversations by their `updated` timestamp on sign-in and refreshes when the page regains focus. Changes are uploaded through the authenticated API. Cloud sync is not a realtime Firestore listener; it refreshes on sign-in, page focus and local edits. A failed cloud request never deletes the local copy.

Each conversation is validated (safe document ID, message role/content limits and a 400 KiB serialized size cap). API user identity always comes from the verified Firebase token, never from a client-supplied UID. Cloud data is not automatically erased when a Firebase account is deleted; account deletion/export lifecycle and conflict/tombstone handling remain follow-up work before public release.
