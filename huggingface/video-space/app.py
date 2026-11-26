import os
import tempfile
import gradio as gr
import spaces
import torch
from diffusers import AutoencoderKLWan, WanPipeline
from diffusers.schedulers.scheduling_unipc_multistep import UniPCMultistepScheduler
from diffusers.utils import export_to_video

MODEL_ID = "Wan-AI/Wan2.2-TI2V-5B-Diffusers"

# Keep model placement at module scope for ZeroGPU compatibility.
vae = AutoencoderKLWan.from_pretrained(
    MODEL_ID, subfolder="vae", torch_dtype=torch.float32
)
pipe = WanPipeline.from_pretrained(
    MODEL_ID, vae=vae, torch_dtype=torch.bfloat16
)
pipe.scheduler = UniPCMultistepScheduler.from_config(
    pipe.scheduler.config, flow_shift=5.0
)
pipe.to("cuda")
pipe.set_progress_bar_config(disable=True)

# ZeroGPU applies a hardware-dependent duration multiplier. 180s keeps
# the effective request below the free-tier 300s ceiling.
@spaces.GPU(duration=180)
def generate_video(prompt, seed):
    prompt = (prompt or "").strip()
    if not prompt:
        raise gr.Error("Enter a prompt before generating.")
    if len(prompt) > 1600:
        raise gr.Error("Prompt must be 1,600 characters or fewer.")
    actual_seed = int(seed) if seed is not None and int(seed) >= 0 else 12345
    generator = torch.Generator(device="cuda").manual_seed(actual_seed)
    with torch.inference_mode():
        frames = pipe(
            prompt=prompt,
            negative_prompt="low quality, blurry, static image, distorted motion, text, watermark",
            height=704,
            width=1280,
            num_frames=49,
            num_inference_steps=20,
            guidance_scale=5.0,
            generator=generator,
        ).frames[0]
    output_path = os.path.join(tempfile.gettempdir(), f"teslafield-{actual_seed}.mp4")
    export_to_video(frames, output_path, fps=24)
    return output_path, actual_seed

with gr.Blocks(title="TESLAFIELD Video Studio", theme=gr.themes.Soft()) as demo:
    gr.Markdown("# TESLAFIELD · Video Studio\nExperimental short-form video generation using Wan 2.2 on eligible free ZeroGPU quota.")
    prompt = gr.Textbox(label="Describe your video", lines=4, placeholder="A cinematic tracking shot...")
    seed = gr.Number(value=-1, precision=0, label="Seed (-1 = default)")
    run = gr.Button("Generate 2-second video", variant="primary")
    output = gr.Video(label="Generated MP4")
    used_seed = gr.Number(label="Used seed", precision=0)
    run.click(generate_video, inputs=[prompt, seed], outputs=[output, used_seed], api_name="generate_video")

demo.queue(default_concurrency_limit=1).launch()
