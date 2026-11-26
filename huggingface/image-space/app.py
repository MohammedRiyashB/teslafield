import os
import random
import gradio as gr
import spaces
import torch
from diffusers import FluxPipeline

MODEL_ID = "black-forest-labs/FLUX.1-schnell"
HF_TOKEN = os.getenv("HF_TOKEN")

# ZeroGPU requires model placement at module scope.
pipe = FluxPipeline.from_pretrained(
    MODEL_ID,
    torch_dtype=torch.bfloat16,
    token=HF_TOKEN,
)
pipe.to("cuda")
pipe.set_progress_bar_config(disable=True)

SIZES = {
    "1:1": (1024, 1024),
    "16:9": (1280, 720),
    "9:16": (720, 1280),
}

@spaces.GPU(duration=120)
def generate_image(prompt, aspect_ratio, seed):
    prompt = (prompt or "").strip()
    if not prompt:
        raise gr.Error("Enter a prompt before generating.")
    if len(prompt) > 1800:
        raise gr.Error("Prompt must be 1,800 characters or fewer.")
    width, height = SIZES.get(aspect_ratio, SIZES["1:1"])
    actual_seed = int(seed) if seed is not None and int(seed) >= 0 else random.randint(0, 2**31 - 1)
    generator = torch.Generator(device="cpu").manual_seed(actual_seed)
    with torch.inference_mode():
        image = pipe(
            prompt=prompt,
            width=width,
            height=height,
            guidance_scale=0.0,
            num_inference_steps=4,
            max_sequence_length=256,
            generator=generator,
        ).images[0]
    return image, actual_seed

with gr.Blocks(title="TESLAFIELD Image Studio", theme=gr.themes.Soft()) as demo:
    gr.Markdown("# TESLAFIELD · Image Studio\nGenerate images with an open-weight model on eligible free ZeroGPU quota.")
    prompt = gr.Textbox(label="Describe your image", lines=4, placeholder="A cinematic product photograph...")
    with gr.Row():
        ratio = gr.Dropdown(choices=list(SIZES.keys()), value="1:1", label="Aspect ratio")
        seed = gr.Number(value=-1, precision=0, label="Seed (-1 = random)")
    run = gr.Button("Generate image", variant="primary")
    output = gr.Image(label="Generated image", type="pil")
    used_seed = gr.Number(label="Used seed", precision=0)
    run.click(generate_image, inputs=[prompt, ratio, seed], outputs=[output, used_seed], api_name="generate_image")

demo.queue(default_concurrency_limit=1).launch()
