---
title: TESLAFIELD Video Studio
emoji: 🎬
colorFrom: blue
colorTo: indigo
sdk: gradio
sdk_version: 5.49.1
python_version: 3.10
app_file: app.py
pinned: false
suggested_hardware: zero-a10g
---

# TESLAFIELD Video Studio

Experimental text-to-video Space targeting eligible Hugging Face ZeroGPU.

- Model: `Wan-AI/Wan2.2-TI2V-5B-Diffusers` (Apache 2.0).
- Model card indicates 24GB minimum GPU memory for its single-GPU 720p recipe.
- Free ZeroGPU `large` advertises 48GB VRAM, but queues, quota and runtime can still prevent a generation.
- To protect the free daily quota, the first integration is capped to a short 2-second 720p clip.
- No paid hardware is selected by this repository.
