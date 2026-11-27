# Production Security Review — 27 November 2026

## Scope and status

This review combines source inspection, repository regression tests, provider-policy review and non-destructive production endpoint checks. It is not an independent penetration test, a compliance audit, a provider contract review or a guarantee that the service is 100% secure.

The currently deployed Render API is a Free web service in Singapore with one instance. The free plan cannot scale beyond one instance. The service must remain single-instance until all process-local state is migrated and tested.

## Changes in this review branch

- OpenRouter requests now ask for ZDR-eligible inference endpoints, deny non-transient data collection and disable provider fallback. The exact selected :free model ID remains in the request. Paid model IDs are rejected. No alternate model/provider is automatically selected; a request may fail if no eligible endpoint is available.
- OAuth consent now reserves its one-time pending state before awaiting Firebase token verification, preventing two concurrent consent posts from consuming the same state.
- OAuth regression tests exercise a complete authorization-code + PKCE flow, redirect URI mismatch, wrong verifier, successful redemption, code replay, consent replay and concurrent consent submissions.
- Production smoke probes exercise health, OAuth discovery, unauthenticated chat/MCP rejection, CORS rejection and malformed OAuth requests. They do not use production user credentials or modify accounts.
- The Speech Space's Gradio temporary-file cache is configured to delete files older than 10 minutes on a 1-minute sweep.
- The Voice Space applies the same Gradio cache cleanup and schedules deletion of its generated source WAV file after 10 minutes.
- The public privacy policy and README files describe the actual external data flows and limitations.

## Remaining security constraints

### 1. Rate limiting and process-local state

The HTTP rate limiter is a bounded, process-local Map. OAuth pending authorization state, authorization codes and the idempotency cache are also process-local. This is consistent with the current one-instance Render Free deployment, but it is not a distributed design.

Render Free services cannot scale beyond one instance. Do not increase instance count or migrate to a multi-instance plan until:
1. Rate-limit counters use a shared atomic store with TTLs.
2. OAuth authorization state and one-time codes use a shared store with atomic single-use consumption.
3. Idempotency records use a shared store.
4. Cross-instance replay, race and outage tests pass.

A shared Key Value store must be explicitly linked in the same region as the API. Do not use an unrelated store or a cross-region external URL as a substitute.

### 2. GitHub main-branch protection

The repository has no rulesets in the rulesets listing. The GitHub integration used for this review cannot read the branch-protection endpoint (403) or create/update branch protection. Although the repository owner account has Admin permission, branch protection has not been enabled by this review.

Before relying on main as a protected production branch, configure a rule for main in GitHub settings:
- Require pull requests before merging.
- Require the engineering validation status check.
- Require the Firebase deployment verification check where applicable.
- Block force pushes and branch deletion.
- Require an independent approval only if another reviewer is available; a solo-maintainer approval requirement can block all merges.

### 3. OAuth

The code uses authorization code + PKCE S256, validates the ChatGPT Client Metadata Document, checks the exact registered redirect URI and resource, issues a short-lived resource-scoped token, and consumes authorization codes after successful exchange. Automated tests are being added for success, mismatch, replay and concurrent-consent cases.

The automated tests do not replace an independent assessment of the live OAuth integration, client metadata changes, browser consent UX, token theft scenarios, or real-world abuse.

### 4. Provider data handling

- The default chat model runs in a custom public Hugging Face Space (Earthaioa/EARTH_OS_V10_DOCKER). This is not Hugging Face Inference Providers or an Inference Endpoint; those products' separate request-retention statements do not automatically apply to this custom Space.
- Speech and voice use custom public Hugging Face Spaces. Application-level Gradio cache cleanup is best-effort and does not control infrastructure logs, backups or copies retained by the hosting provider.
- The custom chat, speech and voice Spaces are public endpoints. Firebase authentication protects the Teslafield backend, not direct calls to a public Space URL. Direct Space access is an outstanding exposure and must be addressed with Space-level private access or equivalent backend-to-Space authentication before claiming the entire inference surface is protected by website sign-in.
- OpenRouter receives selected chat inputs when an OpenRouter model is selected. Request flags constrain routing but do not erase all OpenRouter operational metadata or guarantee deletion by every intermediary/provider. Provider terms and eligible endpoints can change.

### 5. External security assessment

No full external penetration test has been performed. The new production checks are safe negative/health probes only. They do not test destructive flows, authenticated user accounts, credential compromise, high-volume denial of service, all API parameters, or third-party platform infrastructure.

## Required go-live gates before expanding public usage

- Enable GitHub branch protection and require successful validation checks.
- Decide how to close direct access to the public Hugging Face Spaces; verify backend-to-Space authentication before changing Space visibility.
- Keep Render on one instance unless all in-memory stores are migrated to shared storage.
- Review the current Hugging Face, OpenRouter, Firebase and Render terms, privacy terms, retention settings and any required data-processing agreements.
- Arrange an independent, authorized penetration test of the production web app, API, OAuth flow, Firebase rules and model-provider ingress.

## References

- Render Free service limits: https://render.com/docs/free
- Render scaling limits: https://render.com/docs/scaling
- OpenRouter provider routing: https://openrouter.ai/docs/guides/routing/provider-selection
- OpenRouter privacy policy: https://openrouter.ai/privacy
- Hugging Face Spaces security and sharing guidance: https://huggingface.co/docs/hub/spaces-overview
- Gradio temporary-file cleanup: https://www.gradio.app/guides/resource-cleanup
