---
title: TESLAFIELD Speech Engine
emoji: 🎙️
colorFrom: green
colorTo: blue
sdk: gradio
sdk_version: 6.19.0
python_version: "3.11"
app_file: app.py
pinned: false
---

# TESLAFIELD Speech Engine

Fast multilingual speech-to-text using `Systran/faster-whisper-base` through faster-whisper CPU INT8. Tamil and English are supported, with automatic language detection.

Gradio temporary upload/output cache cleanup is enabled: files older than 10 minutes are removed on a one-minute sweep. This is application-level best-effort cleanup; Hugging Face infrastructure logs and backups are governed by the hosting provider's policies.
