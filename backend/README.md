# TESLAFIELD API

This is the Node.js backend starter for Render.

## Render settings

- Runtime / Language: Node
- Root Directory: backend
- Build Command: npm install
- Start Command: npm start
- Health Check Path: /health
- Region: Singapore
- Instance: Free ($0/month) for prototype testing

## Endpoints

- GET / — service information
- GET /health — Render health check
- GET /api/v1/status — reports which integrations are currently connected
- POST /api/v1/creative/plan — intentionally returns 503 until the AI Director is connected

## Environment

Set CORS_ORIGIN in Render after Firebase Hosting is deployed. Use the exact frontend origin, for example:

CORS_ORIGIN=https://YOUR_FIREBASE_HOSTING_DOMAIN

For multiple trusted origins, separate them with commas. Do not add trailing paths such as /dashboard.

No API keys or secrets are needed for this starter backend.

## Important

This is only a backend foundation. It does not generate images, videos or audio. Do not put model provider keys in frontend files or public GitHub code. Add real provider integrations behind server-side routes later.
