---
title: TESLAFIELD Voice Engine
emoji: 🔊
colorFrom: purple
colorTo: pink
sdk: gradio
sdk_version: 6.19.0
python_version: "3.11"
app_file: app.py
pinned: false
---

# TESLAFIELD Voice Engine

Tamil and multilingual text-to-speech using `Oomni/mithi-v2-flash` (99.1M parameters, Apache-2.0). Runs locally on CPU; no external TTS API.

Generated WAV source files are scheduled for removal after 10 minutes. Gradio's temporary cache is also cleaned on a one-minute sweep for files older than 10 minutes. This is application-level best-effort cleanup, not a guarantee that hosting-provider logs or infrastructure copies are immediately erased.
