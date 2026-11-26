# TESLAFIELD Hugging Face ZeroGPU setup

This folder contains two separate Gradio Spaces. Keeping image and video in separate Spaces avoids loading both large model pipelines into the same GPU process.

## Models

- Image: `black-forest-labs/FLUX.1-schnell` — Apache 2.0. The model page may require you to sign in and accept its access conditions. If required, add an HF read token as a **Space Secret** named `HF_TOKEN` to the image Space only.
- Video: `Wan-AI/Wan2.2-TI2V-5B-Diffusers` — Apache 2.0. Initial profile is capped at a short 2-second 720p clip because free ZeroGPU quota is very limited.

## Create the Spaces

Your Hugging Face account must be in good standing, have a verified email, and be at least 30 days old to host free ZeroGPU Spaces. Free personal accounts can host up to two ZeroGPU Spaces.

1. Open https://huggingface.co/new-space
2. Create a **Gradio** Space named `teslafield-image`.
3. Select **ZeroGPU** hardware only if it is offered as a free option. Do not select a paid GPU.
4. Copy the files from `huggingface/image-space/` into the root of that Space repository.
5. Repeat for a second Gradio Space named `teslafield-video`, copying files from `huggingface/video-space/`.
6. For FLUX, open https://huggingface.co/black-forest-labs/FLUX.1-schnell and accept the model access conditions. If the Space build requires authentication, add your HF read token in the image Space's Settings → Secrets as `HF_TOKEN`. Never put this token in GitHub source code or the website.

## Connect Spaces to the existing Render backend

After both Spaces show **Running**, add these environment variables to the existing Render API service:

- `HF_IMAGE_SPACE_URL` = `https://YOUR-IMAGE-SPACE-SLUG.hf.space`
- `HF_VIDEO_SPACE_URL` = `https://YOUR-VIDEO-SPACE-SLUG.hf.space`

The Hugging Face Space slugs are shown on each Space page. Keep the Spaces public for this first integration; private Spaces require an additional server-side access token. Do not set `HF_TOKEN` on Render for the public-space setup.

The backend uses the Gradio client to call `/generate_image` and `/generate_video`. No paid inference API key is needed for this route.

## Free-tier limits and safety

- ZeroGPU free accounts currently receive 5 minutes of GPU quota per day; the allowance is shared across ZeroGPU usage and resets 24 hours after first use.
- Free personal accounts can host up to two ZeroGPU Spaces only if eligible.
- Queue times and cold starts are expected.
- Video generation is experimental and may time out or exhaust the daily allowance. The starter Space returns a short 2-second clip.
- Do not add prepaid credits or switch to paid GPU hardware. If ZeroGPU is unavailable for this account, stop and ask before choosing another option.
- A model being open-weight does not mean TESLAFIELD owns its original weights. These are third-party open models hosted by your Space. Fine-tuning original TESLAFIELD weights is a later project.
