# TESLAFIELD — Product & UX Blueprint

**Version:** 1.0  
**Research date:** 26 November 2026  
**Status:** Public-product research + original front-end prototype  
**Product direction:** AI creative production studio

---

## 1. Executive product definition

TESLAFIELD should be built as a connected creative-production environment, not as a single prompt box that happens to call an image or video API.

The user should be able to move through a repeatable production loop:

1. Describe the creative outcome.
2. Plan the visual direction and sequence.
3. Prepare references, characters, products and locations.
4. Choose the right generation workflow.
5. Generate one or more assets.
6. Review, edit and refine.
7. Assemble the final sequence.
8. Save, reuse, share and export the project.

A core product opportunity is the **creative direction layer**: helping a user translate a vague brief into structured shots, camera instructions, references and a repeatable production plan. This is an original TESLAFIELD product direction, not a claim that a specific AI director is already implemented.

## 2. Scope and research method

This research uses publicly accessible Higgsfield web pages, product descriptions, Help Center articles, pricing information and changelog entries. It analyses the visible information architecture and documented workflows.

It does not claim to extract private logged-in screens, hidden APIs, source code, proprietary assets, private account behaviour or every possible state in the product. The implementation therefore uses the public product concepts as category-level references and creates TESLAFIELD's own information architecture, labels, visual identity and code.

Primary references:

- Homepage: https://higgsfield.ai/
- Product overview: https://higgsfield.ai/creator-hub/help-center/getting-started/what-is-higgsfield
- Tool selection guide: https://higgsfield.ai/creator-hub/help-center/tools/which-higgsfield-tool-should-i-use
- Cinema Studio guide: https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-cinema-studio
- Canvas guide: https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-canvas
- Supercomputer guide: https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-supercomputer
- Soul ID guide: https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-create-and-use-a-soul-id-character
- Pricing: https://higgsfield.ai/pricing
- Changelog: https://higgsfield.ai/creator-hub/changelog

## 3. Product architecture observed in the public reference

The public Higgsfield product is structured as a suite with multiple entry points and specialist workflows.

### 3.1 Top-level public product areas

The public navigation and product catalogue surface the following areas:

- Explore / discovery
- Image creation and image editing
- Video creation and video editing
- Audio
- Model/API/developer access
- Specialist studios
- Agentic project execution
- Community and learning resources
- Pricing and enterprise information

The homepage also uses product announcements, featured work, community examples and model/tool discovery to help users understand what can be made before they enter a workflow.

### 3.2 Specialist workflow categories

| Category | User's job to be done | TESLAFIELD equivalent |
|---|---|---|
| Image generation/editing | Create or refine a visual asset | Image Studio |
| Text/image-to-video | Create motion from a brief or frame | Video Studio |
| Cinema production | Direct scenes with camera and shot controls | Cinema Director |
| Marketing production | Turn a product brief/reference into ad concepts | Ad Studio |
| Character consistency | Keep a reusable character identity/reference | Characters & Assets |
| Multi-model pipeline | Connect sequential or parallel creative steps | Creative Canvas |
| Audio | Create voice, sound and music direction | Audio Studio |
| Agentic project planning | Turn one brief into a multi-step production plan | AI Director |
| Post-production | Organise clips into an edit and export | Motion Editor |
| Asset management | Reuse past generations and references | Generations Library |

### 3.3 Key product insight

The strength of a suite is not merely the number of models. It is the way the tools work together. A character reference created once should be available in later image and video projects; a storyboard should be convertible into shot prompts; a generated clip should be available in the editor and library; a saved workflow should be reusable.

TESLAFIELD's long-term architecture should therefore be project-centric and asset-centric. Avoid building each page as an isolated app.

## 4. UX principles for TESLAFIELD

### Principle A — Start with the user's goal

Users often do not know which model, parameter or tool to select. Give them clear intent-based choices such as:

- Make a video
- Create an image
- Direct a cinematic scene
- Create a product advertisement
- Build a reusable character
- Plan a complete creative project

The first screen should explain the outcome of each workflow, not ask the user to understand model names.

### Principle B — Progressive disclosure

Show essential settings first: prompt, reference, format and create action. Place advanced controls in grouped sections, such as model routing, duration, camera, lens, quality and seed. Beginners should not face a wall of parameters before they can make their first project.

### Principle C — Keep context across the workflow

Projects should own:
- Brief and creative intent
- Reference files
- Characters / reusable elements
- Shot plans and storyboard frames
- Model and generation settings
- Generated media
- Revisions and final exports

Changing from Cinema Director to Video Studio should not force the user to re-enter the same brief.

### Principle D — Make generation state visible

A real product must make each job's state understandable:
- Draft
- Validating
- Queued
- Running
- Succeeded
- Failed
- Cancelled

Every running job needs progress/status, provider/model, estimated cost, cancel/retry behaviour and a way to inspect errors. Never display a fake progress percentage if the provider does not supply one.

### Principle E — Design for iteration

Creative work is rarely one-and-done. Give the user clear ways to:
- Create a variation
- Reuse prompt/settings
- Change one shot without rebuilding the entire project
- Compare outputs
- Mark favourites
- Replace a reference
- Restore an earlier version

### Principle F — Communicate limitations honestly

A disabled provider, unavailable model, unsupported reference type, credit shortage or failed generation should be surfaced before the user commits. The present prototype uses explicit demo notices because its AI services are not connected.

## 5. TESLAFIELD information architecture

### Main navigation

**Workspace**
- Overview
- AI Director

**Create**
- Video Studio
- Image Studio
- Cinema Director
- Ad Studio
- Audio Studio
- Motion Editor

**Your Library**
- Characters & Assets
- Creative Canvas
- Generations

**Account**
- Workspace
- Credits / Plans
- Notifications
- Settings
- Profile

### Why this grouping

- Overview is the starting point for a new project and a return visit.
- AI Director is an intent-based starting point for people who do not know which tool to select.
- Create pages are specialist production workspaces.
- Library pages hold reusable context and generated output.
- Account controls stay separate from creative work.

## 6. Principal user journeys

### Journey 1 — Text idea to video

**User goal:** Make a short motion clip from a written idea.

1. Overview → Video Studio.
2. Select text-to-video.
3. Write subject, action, environment, look and camera movement.
4. Optionally attach an image or visual reference.
5. Select aspect ratio and duration.
6. Choose a supported model route.
7. Review the estimated generation cost and output constraints.
8. Start generation.
9. Monitor job status.
10. Review result, create variations, save to project or send to Motion Editor.

Production acceptance criteria:
- Prompt cannot be submitted empty.
- User sees model availability and cost before submitting.
- References are checked for file type and size.
- Provider errors are understandable and recoverable.
- Results are stored in the project and library.

### Journey 2 — Image to video

**User goal:** Animate a still image.

1. Enter Video Studio and select image-to-video.
2. Upload or choose a saved image.
3. Show the image preview and selected file information.
4. Describe what should move and what should remain stable.
5. Select camera movement, duration, aspect ratio and model.
6. Explain any provider-specific restrictions on reference images.
7. Estimate cost and submit.
8. Review the clip and compare variations.

Important UX detail: reference image, starting frame and identity reference are not interchangeable in every model. The integration layer must map each provider's exact media roles and expose only supported inputs.

### Journey 3 — Cinema project

**User goal:** Produce a sequence rather than one disconnected clip.

1. Create a project and provide a scene brief.
2. Choose genre / tone and broad visual direction.
3. Draft a storyboard or shot sequence.
4. Each shot includes: subject, action, environment, framing, lens intent, camera movement, lighting, duration and references.
5. Review and edit every shot.
6. Reuse the same project characters / locations / props.
7. Generate shots individually or in a controlled batch.
8. Review continuity and replace weak shots.
9. Assemble the best clips in Motion Editor.
10. Export with resolution, ratio, frame rate and audio settings.

### Journey 4 — Product advertisement

**User goal:** Turn a product brief into a short ad concept.

1. Enter Ad Studio.
2. Provide product name, product page URL or approved product image.
3. Describe target audience, key benefit, offer and campaign goal.
4. Select a format: UGC review, unboxing, tutorial, product demonstration or premium spot.
5. Choose tone and aspect ratio.
6. Draft hook, scene beats, CTA and storyboard.
7. Review product fidelity, wording and claim accuracy.
8. Generate and edit clips.
9. Review rights, brand safety and final output before export.

For a future URL input, do not fetch arbitrary pages without SSRF protections. Use a secure backend fetcher with URL allowlists, private-IP blocking, timeouts and content-type limits.

### Journey 5 — Reusable character reference

**User goal:** Reuse a character across multiple projects.

1. Create a character record.
2. Upload only images the user owns or has permission to use.
3. Show a consent and likeness-rights statement.
4. Name the character and add visual continuity notes.
5. If a training model is later integrated, explain required number/quality of photos, training time, retention and deletion.
6. Once trained, select the character as a reference in supported workflows.
7. Show when the selected model does not support a character element.

Do not imply that the current reference-card prototype trains or recognises a face. It does not.

### Journey 6 — Multi-step Creative Canvas

**User goal:** Build a repeatable workflow.

1. Start a blank or template canvas.
2. Add prompt/reference nodes.
3. Add image, video, audio or editing nodes.
4. Connect a node output to a compatible input.
5. Configure each node.
6. Validate missing input and unsupported model roles.
7. Estimate total credits before running.
8. Run nodes individually or in sequence.
9. Review each output and continue from a chosen result.
10. Save a reusable template.

Long-term features: node validation, undo/redo, autosave, versions, zoom/pan, minimap, collaboration and reusable templates.

### Journey 7 — AI Director

**User goal:** Describe the outcome, let the product propose the plan, then approve it.

1. Enter one natural-language brief.
2. Clarify missing essentials only: output type, audience, aspect ratio, duration or references.
3. Produce a transparent plan showing each task and chosen tool/model.
4. Let the user approve the plan before expensive generation.
5. Execute tasks with visible status.
6. Allow a user to edit or rerun one step without repeating successful stages.
7. Return a structured project with assets and export options.

The current AI Director screen is only a local planning demonstration. The displayed starter shot outline is a template, not model-generated reasoning.

## 7. Page-by-page prototype specification

| Screen | Current prototype behaviour | Production work still needed |
|---|---|---|
| Overview | Navigation, entry-point cards, activity list | Real project feed, onboarding, recommendations |
| Explore presets | Curated visual directions that prefill a creative brief | Add server-managed templates, attribution and user collections |
| Video Studio | Prompt, reference upload preview, ratio and camera controls, local demo job | Provider adapter, cost quote, job queue, outputs |
| Image Studio | Image brief and shared settings UI | Image models, editing, variations |
| Cinema Director | Editable starter shot list and scene brief | Storyboard model, shot prompt builder, continuity graph |
| Ad Studio | Product brief form and template campaign outline | URL ingestion, brand assets, ad generation, claim checks |
| Audio Studio | Script and sound direction controls | Speech/music provider, licences, audio editing |
| Motion Editor | Preview frame and sample tracks | Real timeline engine, media processing, export |
| Characters & Assets | Reference organiser and consent copy | Secure object storage, identity model, deletion/export |
| Creative Canvas | Addable node cards and workflow concept | Real graph, typed ports, execution engine, persistence |
| Generations | Local demo history | Real job database, filters, playback, download, retries |
| AI Director | Local storyboard template | LLM orchestration, tools, approvals, job routing |

## 8. Visual design system

TESLAFIELD uses its own identity:

- Background: deep graphite / near-black.
- Panels: layered charcoal surfaces.
- Accent: fresh electric lime.
- Secondary accents: muted violet, blue and warm amber.
- Typography: Manrope for headings, DM Sans for interface text.
- Rounded but restrained panels.
- Thin separators and subtle hover states.
- Wide cinematic preview canvas.
- Clear primary action on every creation page.
- Dense settings are grouped and do not dominate the work preview.

Responsive layout:
- Desktop: fixed left navigation, compact topbar, working area and a right-hand settings column on creation screens.
- Tablet: collapsible navigation and stacked settings.
- Mobile: slide-in navigation, single-column creation layout, full-width controls and simplified top actions.

## 9. Current prototype implementation

Files:
- index.html — app shell and navigation.
- styles.css — design system, desktop/tablet/mobile layouts.
- app.js — view routing, controls, local preview jobs and prototype interactions.
- README.md — run and GitHub Pages instructions.

Current interactions:
- Navigation switches between workspaces.
- Prompt inputs are validated before demo job creation.
- Video/image demo requests appear in the local Generations view.
- Reference image selection can update the preview locally.
- Ratio controls change preview framing.
- Cinema Director allows adding/removing starter shots.
- Creative Canvas allows adding and resetting nodes.
- Ad Studio produces a template outline.
- AI Director produces a template shot plan.
- Character references can be named and saved in the current session.
- Notifications, credits and account actions explain the current demo state.

Prototype limitations:
- Jobs are in memory and disappear on refresh.
- No real user authentication.
- No durable database or object storage.
- No video/image/audio generation.
- No real timeline rendering or export.
- No payments or credit billing.
- No team collaboration.
- No deployed production backend.

## 10. Recommended zero-budget build sequence

1. Test and refine the static prototype using GitHub Pages.
2. Ask 5–10 creators or small businesses to try the workflows.
3. Record where users get stuck and which workflow they value enough to pay for.
4. Choose one launch wedge: product-ad planning, creator video workflow, or cinematic shot planning.
5. Connect one low-cost or permitted model provider through a backend adapter. Keep secrets off the client.
6. Add authentication, project persistence and object storage.
7. Add job status tracking, cost estimation, credit ledger and cancellation.
8. Measure retention, successful generations, cost per successful output and repeat usage.
9. Add additional models only after the first workflow is reliable.
10. Invest in proprietary technology only when there is evidence that a specific capability is a differentiator worth training or engineering.

## 11. Production architecture target

A sensible first production architecture:

- Frontend: React / Next.js or keep the static app until validation.
- Backend API: Node.js / TypeScript or Python.
- Database: PostgreSQL.
- Object storage: S3-compatible storage.
- Queue: Redis-backed job queue.
- Workers: isolated provider/model adapters.
- Payments: compliant checkout and webhook verification.
- Observability: structured logs, job traces, error monitoring and spend alerts.

Core entities:
- User
- Workspace
- Project
- Asset
- CharacterReference
- PromptVersion
- GenerationJob
- Provider
- Model
- CreditTransaction
- Workflow
- WorkflowNode
- Export

Core job lifecycle:
- draft
- validated
- quoted
- queued
- running
- succeeded / failed / cancelled

The backend must be authoritative for provider credentials, user balances, job states and billing. Never trust a client-supplied cost or user balance.

## 12. Non-negotiable trust and safety controls

- Ask for permission before training or generating a real person's likeness.
- Provide deletion and retention controls for user uploads and trained identity data.
- Enforce provider terms, model licences and commercial-use restrictions.
- Moderate abusive, illegal or non-consensual content.
- Prevent prompt injection and SSRF when reading product URLs or external files.
- Keep API keys on the server.
- Use signed, time-limited upload/download URLs.
- Show estimated cost and require confirmation where a generation could incur charges.
- Keep audit logs for billing, identity training, sharing and deletion.
- Do not claim a model, output quality, speed or feature is available until it is actually integrated and tested.

## 13. Definition of a good first public beta

A beta is ready only when a user can:

1. Create an account.
2. Create a project.
3. Submit a prompt and optional reference.
4. See a clear cost estimate.
5. Generate through one real provider.
6. Track the job and understand failures.
7. Review, download and delete the output.
8. Reuse the prompt and project assets.
9. Understand data handling and usage rights.
10. Contact support when something goes wrong.

The goal is not to launch every tool at once. The goal is to make one complete workflow genuinely useful, reliable and economically sustainable.
