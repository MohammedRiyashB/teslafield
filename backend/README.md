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
- `GET /api/v1/models` — Teslafield B1 plus eligible OpenRouter `:free` text-chat models only
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
- `OPENROUTER_API_KEY` — optional server-side key for eligible OpenRouter `:free` chat models only. Store it only in Render environment settings. The local TeslafieldAI Qwen model remains the default when this is absent. Paid model IDs are rejected by the API; there is no paid routing or automatic model fallback.
- `PUBLIC_BASE_URL` — defaults to `https://teslafield-api.onrender.com`
- `TESLAFIELD_OAUTH_PAGE` — defaults to `https://teslafieldai.web.app/oauth`
- `FIREBASE_PROJECT_ID` — defaults to `teslafieldai`
- `CORS_ORIGIN` — comma-separated trusted web origins; the default includes the TESLAFIELD Firebase Hosting domains

Firebase Authentication must have the Google provider enabled and `teslafieldai.web.app` registered as an authorized domain.

## Security and scaling notes

Chat completion requests may send an `Idempotency-Key` header. The API scopes this key to the authenticated Firebase user and request payload, coalesces concurrent retries and caches successful responses for five minutes. Reusing the same key with different request content returns HTTP 409. This first implementation is process-local and bounded to 1,000 entries; it protects retries on a single API instance only. It is not a distributed lock. Keep a single Render instance until both OAuth authorization state and idempotency state are moved to a shared store.

OAuth authorization requests and single-use authorization codes are held in process memory with short expirations; access tokens are HMAC-signed and resource-scoped. Keep this Render service at one instance for this initial release. Before scaling to multiple instances or using multiple regions, move the short-lived authorization state and one-time code store to shared Redis/Key Value or a database.

The configured Render Free web service supports one instance only and cannot be horizontally scaled. The request rate limiter is therefore deliberately process-local for the current deployment. OAuth pending requests/codes and the idempotency cache are also process-local. Do not change the service to multiple instances until all three stores are moved to shared storage and multi-instance tests pass. A Redis/Key Value store must be explicitly provisioned for this service in the Singapore region; do not point this service at a resource in another region or reuse an unrelated workspace store. The Free tier is suitable for a single-instance hobby deployment, not a production scaling guarantee.

OpenRouter chat requests include `provider.zdr=true`, `provider.data_collection="deny"` and `provider.allow_fallbacks=false`. Paid model IDs remain rejected and the exact selected `:free` model ID is sent. If no eligible provider endpoint exists, the request is expected to fail rather than use an unapproved provider. These flags are endpoint filters, not a promise that OpenRouter's operational metadata is never retained.

The custom chat, speech and voice Hugging Face Spaces are public Spaces. Firebase authentication and API rate limits protect the Teslafield backend routes, not direct requests made to a public Space URL. The current design must therefore be treated as a public inference surface with provider-side quotas; do not assume website login prevents direct Space use. The speech and voice applications now configure Gradio cache cleanup for files older than 10 minutes, and generated voice source files are scheduled for deletion after 10 minutes. Hosting-provider logs and infrastructure copies are outside those application cleanup controls.

Do not add model provider keys, OAuth signing secrets, Firebase service-account keys or user tokens to frontend files or the public repository.

## Model selection

The browser model selector defaults to the TeslafieldAI Qwen3-0.6B Space. If `OPENROUTER_API_KEY` is configured, the API loads only current OpenRouter text-chat model IDs that explicitly end in `:free`, accept text input/output and report zero prompt/completion pricing. The browser sends only the exact selected model ID; the provider key remains on the server. The API revalidates the selected ID against the live eligible catalogue before each request. Paid IDs are rejected, and the API never uses a router or fallback model. Free provider models can still be rate-limited, unavailable or removed upstream.

Each OpenRouter completion additionally requests Zero Data Retention routing, denies non-transient data collection and disables provider fallback. These preferences can make some otherwise-listed models unavailable at request time; no alternate model is selected automatically.


## Cloud conversation history (Stage 6)

The API stores conversations in the existing Firebase project's default Cloud Firestore database. It uses the caller's Firebase ID token with the Firestore REST API, so Firestore Security Rules enforce ownership; no service-account private key or paid database is added to the backend.

Before cross-device cloud sync can work, the project owner must:
1. Open the Firebase console for project `teslafieldai` and create/enable the default Cloud Firestore database. Choose a region only after reviewing data-residency needs.
2. Confirm the Cloud Firestore API is enabled.
3. From a trusted local checkout with Firebase CLI authenticated as a project administrator, run `firebase deploy --only firestore:rules --project teslafieldai`. The repository's `firestore.rules` permits a signed-in user to access only their own `users/{uid}/conversations/*` and `users/{uid}/deletedConversations/*` documents.

The web client retains localStorage as an offline cache, merges remote and local conversations on sign-in, refreshes when the page regains focus, and uploads local edits through the authenticated API. This is foreground/online synchronization, not a realtime Firestore listener.

Deletion is protected against stale offline devices: the client saves a local deletion marker immediately, the API writes a durable owner-scoped Firestore tombstone before deleting the conversation document, and sync filters tombstoned IDs before merging local and remote history. Tombstones are retained and paginated so an old offline copy cannot silently restore a deleted chat. A deliberate explicit save of the same ID clears its tombstone.

The chat-history Export action downloads the currently synchronized local history as JSON. Account deletion first attempts to delete known cloud conversation documents while the Firebase ID token is valid, then deletes the Firebase Auth account and local data on the current browser. The conversation-delete endpoint also writes minimal deletion tombstones (conversation IDs and timestamps) to prevent stale offline devices from restoring removed conversations; these markers can remain after account deletion and do not contain message bodies. If cloud cleanup fails, account deletion is stopped. This does not delete data retained by external AI providers or local browser copies on other devices.

Each conversation is validated (safe document ID, message role/content limits and a 400 KiB serialized size cap). API user identity always comes from the verified Firebase token, never from a client-supplied UID.

The Firebase Spark plan has historically included a no-cost Firestore Standard quota, but quotas, pricing and eligibility can change. Check the current Firebase pricing and quotas before enabling public usage. On free quotas, reaching a limit may stop Firestore operations until the quota resets. This implementation does not create a database, select its region, deploy rules, or enable billing.
