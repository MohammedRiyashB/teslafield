# TESLAFIELD Studio

An original, responsive AI creative-production workspace prototype.

TESLAFIELD is inspired by the broader product category demonstrated by modern AI creative suites. It does **not** copy another company's source code, private product screens, brand assets, or proprietary design files.

## Current status

**Version:** 0.1.0 — Front-end prototype  
**Runtime:** Static HTML, CSS and JavaScript  
**Backend:** Not connected  
**AI providers:** Not connected  
**Authentication / payments / storage:** Not connected

The interface is intentionally honest about its current state. Generate actions create local demo entries only. They do not call an AI model, upload user files, spend credits, or create actual video/audio/image outputs.

## Included workspaces

- Overview dashboard
- Video Studio
- Image Studio
- Cinema Director with editable starter shot list
- Ad Studio with a local campaign-outline template
- AI Director planning demonstration
- Characters & Assets reference organiser
- Creative Canvas with addable workflow nodes
- Audio Studio planning interface
- Motion Editor layout preview
- Generations library for local demo jobs

## Run locally

No build system or package installation is required.

1. Download or clone this repository.
2. Open the index.html file in a modern browser.
3. For a local web server, use any static server, for example:
   - Python: python -m http.server 8000
   - Node: npx serve .
4. Visit http://localhost:8000.

The app uses Google Fonts and a few Unsplash preview images. The rest of the application is plain HTML, CSS and JavaScript.

## Publish with GitHub Pages

1. Open the repository on GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch main and folder / (root).
5. Save. GitHub will provide the published Pages URL after deployment.

GitHub Pages is a static host. It can publish this prototype, but it cannot securely run private API keys, background video-generation jobs, payment processing or a production database.

## Before production

A production release needs, at minimum:

1. A secure backend that keeps provider API keys server-side.
2. An authenticated user and project model.
3. A generation-job queue, provider adapters, status polling and failure handling.
4. Per-model cost estimation, credit ledger and billing safeguards.
5. Object storage for user uploads and generated media.
6. Consent, moderation, copyright, privacy and retention controls.
7. Media processing and export infrastructure.
8. Monitoring, rate limits, abuse controls and support tooling.

Never place provider secrets in app.js, index.html, browser storage or public GitHub files.

## Product and UX research

Read PRODUCT_BLUEPRINT.md for the public product analysis, information architecture, interaction principles, user journeys, implementation status and next roadmap.

Public references consulted:
- https://higgsfield.ai/
- https://higgsfield.ai/creator-hub/help-center/getting-started/what-is-higgsfield
- https://higgsfield.ai/creator-hub/help-center/tools/which-higgsfield-tool-should-i-use
- https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-cinema-studio
- https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-canvas
- https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-supercomputer
- https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-create-and-use-a-soul-id-character
- https://higgsfield.ai/pricing
- https://higgsfield.ai/creator-hub/changelog

The public website and feature set change frequently. Re-check provider availability, features, pricing and terms before implementing integrations.

## Licence

This repository's prototype code is original project code. Add a project licence before accepting outside contributions or distributing it as a commercial product.
