# Third-Party Provider Privacy Review — 27 November 2026

This is a technical review of public provider documentation for the services currently used by TeslafieldAI. It is not legal advice, a negotiated data-processing agreement review, or proof of the actual retention settings on the account.

## Data flows in this application

- Firebase Authentication supplies user identity tokens. The backend validates those tokens and uses the user's bearer token for user-scoped Firestore conversation reads/writes. Firestore rules limit conversation documents to the matching authenticated UID.
- Render hosts the Node API. The current API is on the Render Free/Hobby plan, one instance, in Singapore. Render's privacy policy describes retention of personal data for as long as needed for service/business purposes and may retain device/IP data as needed for operations. Render's log documentation says Hobby log retention is 7 days; application logs and request logs are not a contractual deletion guarantee for every underlying system.
- OpenRouter receives prompts and model outputs for requests where an OpenRouter model is selected. Its privacy policy says it transmits inputs to selected model providers, and provider terms govern independent provider processing. The API requests zdr=true, data_collection=deny and allow_fallbacks=false. These are routing controls, not a guarantee that all operational metadata is erased or that every provider complies with its published policy. OpenRouter's ZDR guidance distinguishes ZDR from its Safety Retention tier. Do not describe Safety Retention endpoints as ZDR.
- Hugging Face hosts custom public Spaces for chat, speech and voice. These are not Hugging Face Inference Providers. Hugging Face's Inference Providers statement about not storing request bodies and keeping diagnostic logs up to 30 days does not automatically apply to custom Spaces. The Hugging Face general privacy policy describes retention as necessary for service delivery, legal requirements, security and legitimate interests, and processing in the US or other countries where it operates.
- Gradio's delete_cache=(60, 600) removes eligible cached files older than 10 minutes during the periodic cleanup. This is application-level temporary-file cleanup only; it cannot erase platform logs, backups, crash dumps, provider-side copies or a user's downloaded copy.

## Important exposure

All three Hugging Face Spaces are currently public. Hugging Face's documentation says a public Space's source and running app are publicly accessible and clonable. Website Firebase login does not authenticate a person who directly visits a public Space URL. This is a material separation between website access control and inference endpoint access control.

Do not switch these Spaces to private until the backend has a working Hugging Face token configured in Render and every backend-to-Space request has been tested with authenticated access. The Hugging Face connector manages its own session and does not expose the token bytes for copying into Render. The GitHub Actions deployment secret is not automatically available to the Render service.

## Provider policy references reviewed

- OpenRouter Privacy Policy: https://openrouter.ai/privacy
- OpenRouter Zero Data Retention and Safety Retention explanation: https://openrouter.ai/blog/insights/zero-data-retention/
- OpenRouter Safety Retention announcement: https://openrouter.ai/blog/announcements/introducing-safety-retention/
- OpenRouter Data Processing Agreement: https://openrouter.ai/assets/data-processing-agreement.pdf
- Hugging Face general Privacy Policy: https://huggingface.co/privacy
- Hugging Face Spaces visibility and access model: https://huggingface.co/docs/hub/en/spaces-overview
- Hugging Face Inference Providers security statement (different product from custom Spaces): https://huggingface.co/docs/inference-providers/security
- Gradio temporary-file cleanup: https://www.gradio.app/guides/resource-cleanup
- Render Privacy Policy: https://render.com/privacy
- Render log retention: https://render.com/docs/logging
- Firebase privacy and processor/controller roles: https://firebase.google.com/support/privacy
- Firebase Data Processing and Security Terms: https://firebase.google.com/terms/data-processing-terms/

## Operational decisions

- Keep the Render API on one instance while limiter, OAuth pending state, authorization codes and idempotency state are process-local.
- Do not treat per-user Firestore ID-token access as a secure shared rate-limit store: a client-controlled user token and user-writable counter would allow a user to reset or tamper with their own limit. A server-only service credential and atomic shared transaction store are required.
- A proper multi-instance limiter needs shared atomic storage with TTLs; OAuth state/code single-use consumption and idempotency also need shared storage.
- Before changing Hugging Face visibility, add a secret token to Render via the Render dashboard (never commit it) and add authenticated backend-to-Space requests, then verify all three paths.
- Review the current account-level OpenRouter privacy settings and any available DPA/contract terms. API routing flags alone do not establish a contractual ZDR configuration.
- Review Firebase project data location, account settings and applicable DPA acceptance in the Firebase console.

## Security assessment boundary

The separate ZAP baseline workflow is a passive, unauthenticated DAST check of public website/API surfaces. It is useful for headers, passive findings and reachable routes, but it is not a full penetration test and does not exercise authenticated user flows, business logic, race abuse at scale, credential compromise, infrastructure escape or third-party systems.
