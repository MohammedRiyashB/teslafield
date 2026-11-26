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
