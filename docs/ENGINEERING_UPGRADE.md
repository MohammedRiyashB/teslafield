# TeslafieldAI Engineering Upgrade

**Audit baseline:** 27 November 2026  
**Repository:** MohammedRiyashB/teslafield  
**Default branch:** main  
**Upgrade branch:** engineering/teslafieldai-upgrade-2026-11-27  
**Constraint:** Free-tier / no new paid services  
**Preservation rule:** Keep existing user-facing features and production branch unchanged until reviewed and verified.

## Audit findings verified from source

1. The root README was stale and described a disconnected creative-studio prototype. The actual application is TeslafieldAI Chat with Firebase authentication, a Node API, Qwen chat, speech/voice routes and an MCP/OAuth bridge.
2. The API reports database: false; conversation history is stored client-side. Cross-device durable history and account-level data lifecycle are not implemented by a server database.
3. The OAuth authorization request and one-time authorization-code stores are in process memory. The backend README correctly warns to keep a single instance until shared state storage is introduced.
4. The browser uses /api/v1/chat/completions and expects one complete response. It intentionally does not render the backend's token stream.
5. The current frontend guards the PWA banner callback with a typeof window.showBannerWhenDue check. The earlier reported undefined-function failure was not reproduced in the current source.
6. File attachments are not uploaded or analyzed. The frontend explicitly tells users that file reading is not connected.
7. The backend has speech transcription and voice synthesis endpoints, but there is no end-to-end WebRTC duplex voice session, barge-in or live audio synchronization.
8. The current model identifier is Qwen/Qwen3-0.6B. A 0.6B model is a lightweight baseline, not evidence of frontier-level reasoning.
9. The latest Firebase Hosting workflow run on the audited main commit succeeded. Earlier failed runs stopped in the MCP/OAuth security smoke test at a strict WWW-Authenticate header grep; the current workflow accepts the quoted/unquoted parameter form and the later run passed.
10. The frontend originally acquired its send lock only after awaiting Firebase authentication. Two rapid submissions during that wait could both pass the initial guard and append duplicate user turns. The current upgrade branch now locks send and regenerate operations before the authentication await.
11. The normal chat-completion endpoint previously had no idempotency handling even though the frontend retries selected 502/503/504 failures. The upgrade adds per-user request fingerprints, concurrent request coalescing, short-lived successful-response caching and HTTP 409 for key/payload mismatches. This cache is process-local and therefore does not coordinate multiple API instances.

## Nine engineering categories and acceptance criteria

### 1. Product and intelligence

- Preserve Qwen3-0.6B as the no-cost baseline while keeping model/provider routing explicit.
- Do not advertise a larger or more capable model until an actually available free endpoint is configured and tested.
- Add a repeatable evaluation set for instruction following, reasoning, coding, Tamil, English and Tanglish.
- Separate model identity, provider status, model loading state and actual inference success in the UI.

**Acceptance:** benchmark results are reproducible and model claims match the configured endpoint.

### 2. Backend architecture

- Keep the existing Node API contract stable while adding focused modules and tests.
- Add request correlation, explicit timeouts, bounded payloads and consistent error responses.
- Make duplicate submission/idempotency behaviour explicit before enabling automatic inference retries.
- Do not add Redis, Postgres or other paid infrastructure under the free-only constraint without approval.

**Acceptance:** API route tests cover success, malformed input, timeout, cancellation, duplicate requests and provider failure.

### 3. Authentication and account security

- Keep Firebase ID-token signature, issuer, audience and expiry verification server-side.
- Add regression tests for invalid signatures, expired tokens, wrong project/audience and missing credentials.
- Verify user-data ownership on every future persisted resource.
- Keep OAuth PKCE, redirect URI validation, resource audience and scope checks.

**Acceptance:** protected endpoints reject invalid identities and OAuth tests cover the authorization-code lifecycle.

### 4. Model capability and routing

- Retain a working free model path.
- Add capability metadata and a safe fallback only when the alternate provider is truly configured.
- Add evaluation and regression tests before changing model defaults.
- Never expose provider secrets in the browser.

**Acceptance:** each model route has a verified health check, request contract and measured evaluation record.

### 5. User experience

- Preserve the existing chat layout, Google sign-in, conversation history, thinking indicator, regenerate and cancel behaviour.
- Prevent concurrent submissions and ensure one logical user action produces one visible assistant result.
- Keep error notices distinct from model responses and avoid adding a second unsolicited response.
- Keep mobile composer and microphone controls accessible.

**Acceptance:** browser-level tests cover send, cancel, regenerate, auth recovery, history switching and mobile layout.

### 6. Voice

- Treat current recording/transcription and TTS as separate capabilities.
- Design a later WebRTC session around explicit listening, thinking, speaking, interruption and reconnect states.
- Do not claim peer-to-peer model inference: model inference still needs a server-side provider.
- Do not replace the current working microphone flow until the new path passes device tests.

**Acceptance:** voice tests cover permission denial, recording stop, transcription errors, playback, cancellation and reconnect.

### 7. Reliability and observability

- Keep health checks separate from model readiness.
- Add structured request IDs and privacy-safe metrics; never log prompts, tokens, audio or personal content.
- Track API errors, model cold starts, p50/p95 latency and cancellation rates before setting SLOs.
- Add regression tests for known production incidents.

**Acceptance:** deployment checks and runtime health can distinguish API-up from model-ready.

### 8. Global readiness and privacy

- Keep mobile-first assets and accessible controls.
- Document provider region, retention, terms and rate limits before enabling each integration.
- Add localization only with reviewed translations.
- Add export/delete controls when server-side user data storage is introduced.

**Acceptance:** privacy disclosures match actual data flows and deployment regions.

### 9. Adoption and operations

- Add a public status/help path and clear support/error reporting.
- Measure opt-in beta retention and satisfaction; do not fabricate users, reviews or performance claims.
- Keep free-tier quotas and abuse controls transparent.
- Publish only after security, accessibility and reliability gates pass.

**Acceptance:** real usage metrics and incident response procedures exist before growth claims.

## Safe implementation sequence

1. **Baseline and documentation:** make repository documentation match the live architecture; preserve main.
2. **Regression protection:** turn current security and chat invariants into repeatable tests.
3. **Duplicate-request safety:** add request IDs/idempotency and test retry/cancel behaviour before changing generation flow.
4. **Authentication hardening:** add focused token and OAuth regression tests.
5. **Voice reliability:** improve the existing capture/transcribe path without replacing it.
6. **Model evaluation and routing:** measure model performance and provide explicit free/paid model choice with server-side provider keys and cost visibility.
7. **Persistence decision:** compare free-tier options and constraints before selecting a durable store.
8. **UX and accessibility:** improve only after regression tests protect existing flows.
9. **Release readiness:** run all checks on a review branch/PR; deploy only after explicit review.

## Current status

- **Stage 1 complete on the upgrade branch:** corrected the root README and added this audit/roadmap document.
- **Stage 2 complete on the upgrade branch:** added a non-deploying GitHub Actions validation workflow, seven backend API smoke tests, five response-style unit tests, and two frontend concurrency regression checks.
- **Functional fixes on the upgrade branch:** the selected response style now reaches the Qwen system prompt for both chat routes; send and regenerate now share a lock acquired before waiting for Firebase authentication.
- **Latest PR validation:** GitHub Actions run 45935576444 completed successfully on code commit cbc4377c38966fa5a20b86c7b08278e2171b88f4; JavaScript/Python syntax checks and 23 Node.js plus 5 Python tests (28 total) passed.
- **Stage 3 complete on the upgrade branch:** added a bounded five-minute, process-local idempotency store scoped by Firebase user and request fingerprint; the browser reuses one idempotency key across automatic retries; mismatched key/payload pairs return HTTP 409; CORS preflight allows the new header. Added tests for coalesced concurrent calls, cached results, conflict rejection, failed-operation retry, expiry, capacity, invalid Firebase project claims and OAuth/MCP rejection boundaries.
- **Not deployed:** all changes remain isolated on the engineering branch. The production main branch and existing deployments were not changed.

This document is a measured engineering roadmap, not a claim that every category is already complete or that a 10/10 score can be guaranteed. A category is complete only when its acceptance criteria are tested against the actual deployed system.


### Stage 4 — voice capture reliability (implemented; CI verified)

- Prevent duplicate microphone permission requests while a permission prompt is pending or a recorder is active.
- Invalidate pending permission requests when the user cancels; if the browser grants permission later, stop every returned media track instead of starting a recording.
- Release media tracks and clear recorder state after recorder errors.
- Mark failed recordings so the stop callback cannot mistakenly submit damaged or partial audio for transcription.
- Preserve the existing record → transcribe → review → send flow and the current 45-second / 8 MiB capture limits.
- Add source-level regression tests for duplicate permission requests, late permission grants after cancellation, recorder cleanup and failed-recording handling.

**Still not claimed:** physical-device microphone testing, end-to-end speech provider availability, full-duplex WebRTC, barge-in or peer-to-peer inference. These require live browser/device and provider tests; no production deployment is part of this stage.


### Stage 5 — free and paid model choice (implemented; CI verified)

- Preserve the existing TeslafieldAI Qwen3-0.6B Space as the default free model.
- Add an optional OpenRouter catalogue that dynamically lists text-chat models and their prompt/completion price per million tokens.
- Offer OpenRouter Free Auto and zero-priced catalogue models separately from paid models.
- Add a responsive composer model selector and persist the preferred model in browser preferences.
- Keep provider credentials server-side in `OPENROUTER_API_KEY`; no browser key entry or secret exposure.
- Require explicit paid model selection. Do not silently fall back from a paid model to another model.
- Include selected model ID in the idempotency fingerprint so retries cannot replay a response generated by a different model.
- Validate selected models against the live OpenRouter catalogue before routing; provider model availability and pricing can change.
- Add unit and API tests for catalogue filtering, pricing normalization, provider credential gating, browser preference/request propagation, and ensuring paid models remain visible when the free catalogue is large.

**Configuration not yet applied:** OpenRouter remains disabled until the owner adds `OPENROUTER_API_KEY` to Render's private environment. This implementation does not create an account, purchase credits, add secrets or deploy. The existing local Qwen model remains available as the default.


### Latest validation snapshot

- GitHub Actions run [45937059069](https://github.com/MohammedRiyashB/teslafield/actions/runs/45937059069) completed successfully on Stage 5 code commit `0f87bbc44513b532274b032c19707419db6fd5aa`.
- JavaScript syntax checks (including `backend/model-catalog.js`) and Python compilation passed.
- **35 Node.js tests and 5 Python tests passed; zero failures.**
- This validates code in the engineering branch only; no production deployment or merge was performed.


### Stage 5 UX refinement — branded model capsule (implementation in progress)

- Replace the file-plus control position with a compact model capsule; retain file selection through a paperclip control immediately beside it. The paperclip morphs to the cancel X during microphone recording.\n- Keep the native select hidden as the existing model-selection contract so preference persistence and request routing remain compatible.
- Open an anchored popup above the capsule, with Teslafield B1 and its own brand logo first, followed by OpenRouter free and paid models with the OpenRouter mark and provider-supplied model names.
- Keep the native select hidden as the existing model-selection contract so preference persistence and request routing remain compatible.
- The OpenRouter free section is capped at 13 displayed catalogue entries; the catalogue is dynamic and can return fewer than 13 when fewer compatible free text models are available. Paid models remain in their own section.
- Manual Android browser/device visual testing is still required.

### Stage 6 — cloud conversation history (implementation complete; owner activation pending)

- Add a Firestore REST storage adapter with per-user document paths derived only from the verified Firebase UID.
- Add authenticated GET, PUT and DELETE conversation endpoints; use the caller's Firebase ID token so Firestore Security Rules enforce owner-only access.
- Add safe conversation/document ID validation, message role and length validation, and a 400 KiB per-conversation size cap.
- Add owner-only rules for both conversation documents and durable deletion tombstones in `firestore.rules`, registered in `firebase.json`.
- Keep localStorage as the offline cache; merge local and cloud conversations on sign-in, refresh on page focus, and upload local edits.
- Persist deletion markers locally while offline and remotely in Firestore before deleting the conversation document. Sync consumes these markers so stale offline copies cannot silently resurrect deleted chats.
- Paginate tombstone retrieval and preserve markers across devices; a deliberate explicit save of a conversation ID clears its marker.
- Add JSON export of the current signed-in user's locally synchronized conversation history.
- Account deletion first attempts to delete all known cloud conversations and their tombstones while the Firebase ID token is still valid, then deletes the Firebase Auth account and local chat data. If cloud cleanup fails, account deletion is stopped rather than leaving known cloud content behind.
- Keep the service free-tier compatible: use the existing Firebase project and caller ID tokens; no service-account private key or paid database is added.
- Add regression coverage for Firestore serialization, owner-scoped paths, tombstone create/list/delete lifecycle, safe validation, and the existing authenticated API/UI contracts.

**Owner activation still required before cross-device sync works:** create the default Firestore database for project `teslafieldai`, confirm the project Firestore API is enabled, and deploy `firestore.rules` with `firebase deploy --only firestore:rules --project teslafieldai`. Review the database region and current Firebase Spark quotas first. No database was provisioned and no rules were deployed by this code change.

**Live verification still required:** run the Firestore Emulator or a dedicated test database, test real authorization and cross-device behavior, and visually verify the popup/history controls on Android. Automated mocks and CI do not prove that the owner's live Firebase project is configured.

**Current status:** implementation is complete on the engineering branch; production activation and live-device verification remain owner/environment tasks. No production merge or deployment has been performed.


### Stage 6 implementation validation

- GitHub Actions run [45939988239](https://github.com/MohammedRiyashB/teslafield/actions/runs/45939988239) completed successfully on code commit `ebf31fbe8beda681a8d9b441ca6ce61cbaeb0e0a`.
- JavaScript syntax checks and Python compilation passed.
- **47 Node.js tests and 5 Python unit tests passed; zero failures.**
- The new tests cover conversation serialization, user-scoped Firestore paths, durable tombstone create/list/delete behavior, and the existing authentication, UI and sync regressions.
- This is automated code validation. Firestore database creation/rules deployment and live emulator/device cross-account tests remain pending; no production merge or deployment was performed.
