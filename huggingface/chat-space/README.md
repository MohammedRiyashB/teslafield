---
title: TESLAFIELD Chat Engine
emoji: 💬
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
models:
  - Qwen/Qwen3-0.6B
---

# TESLAFIELD Chat Engine

Restored stable CPU inference with `Qwen/Qwen3-0.6B` using Transformers and PyTorch. Non-thinking mode is enabled for lower latency. Exposes FastAPI `/chat`, `/stream`, `/health`, and `/info` endpoints.

This is the original TESLAFIELD Chat Engine runtime (v1.0.0). The llama.cpp / GGUF upgrade is not used.

No paid inference API or external model provider is used.
