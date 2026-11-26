---
title: Teslafield Chat Engine
emoji: 💬
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Teslafield Chat Engine

Stable CPU inference powered by `Qwen/Qwen3-0.6B` using Transformers and PyTorch.
Non-thinking mode is enabled for lower latency. The API exposes `/chat`, `/stream`,
`/health`, and `/info` endpoints.

This Space uses the original Teslafield Chat Engine runtime.
No llama.cpp build, GGUF download, or paid inference API is required.

## TESLAFIELD V1 identity and founder profile

The assistant presents itself as **TESLAFIELD V1**. The technical model weights remain
`Qwen/Qwen3-0.6B`; the product name does not imply newly trained model weights.

Founder facts are loaded from `founder_profile.json`. The current founder-provided
profile names **Mohammed Riyash B** as founder, CEO and owner of TESLAFIELD and BMR INC.
The profile intentionally stores only facts that have been supplied; it does not invent
a biography or create thousands of repetitive, unsupported Q&A records.

Optional Hugging Face Space variables:

- `TESLAFIELD_FOUNDER_NAME`: overrides the founder display name.
- `BMRINC_WEBSITE_URL`: the exact official BMR INC website URL. Leave unset until
  the founder supplies/confirms the URL. The assistant will not guess a similarly
  named company's website.

Set these as Space secrets/variables in the Hugging Face Space settings, not in
frontend code or a public repository.

## Live global weather

When a user asks for weather and names a city/region, the backend resolves that
location with Open-Meteo geocoding and retrieves current conditions plus a
three-day outlook. Weather is location-specific; a request without a place should
ask the user which city or region they mean. The service requires outbound network
access but no Open-Meteo API key for this use.
