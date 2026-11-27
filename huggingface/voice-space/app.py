import logging
import os
import sys
import tempfile
import threading
from functools import lru_cache

import gradio as gr
import torch
from huggingface_hub import snapshot_download

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("TESLAFIELD.Voice")
MODEL_ID = "Oomni/mithi-v2-flash"
LANGUAGES = {
    "Tamil": "ta",
    "English": "en",
    "Hindi": "hi",
    "Bengali": "bn",
    "Gujarati": "gu",
    "Kannada": "kn",
    "Malayalam": "ml",
    "Marathi": "mr",
    "Odia": "or",
    "Punjabi": "pa",
    "Telugu": "te",
}
VOICES = ["satvik", "anirban", "nakul", "vasant", "siddhant", "charvi", "ahana", "vaidehi", "malini", "jahnavi"]


@lru_cache(maxsize=1)
def get_tts():
    torch.set_num_threads(max(1, min(2, os.cpu_count() or 2)))
    model_dir = snapshot_download(repo_id=MODEL_ID)
    if model_dir not in sys.path:
        sys.path.insert(0, model_dir)
    from run import Mithi
    logger.info("Loading %s on CPU", MODEL_ID)
    return Mithi(device="cpu")


def remove_temp_file(path):
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError:
        logger.warning("Could not remove an expired temporary voice file.")


def synthesize(text, language, voice):
    if not text or not text.strip():
        raise gr.Error("Enter the text you want spoken.")
    if len(text) > 1500:
        raise gr.Error("Please keep each request under 1,500 characters.")
    lang_code = LANGUAGES.get(language, "ta")
    tts = get_tts()
    output_path = None
    try:
        audio = tts.synthesize(text.strip(), lang=lang_code, voice=(voice or "ahana").lower())
        with tempfile.NamedTemporaryFile(prefix="teslafield-voice-", suffix=".wav", delete=False) as output_file:
            output_path = output_file.name
        tts.save(audio, output_path)
        cleanup = threading.Timer(600, remove_temp_file, args=(output_path,))
        cleanup.daemon = True
        cleanup.start()
        return output_path
    except Exception:
        if output_path:
            remove_temp_file(output_path)
        logger.exception("TTS synthesis failed")
        raise gr.Error("Voice generation failed. Please try shorter text or another voice.")


demo = gr.Interface(
    fn=synthesize,
    inputs=[
        gr.Textbox(label="Text to speak", lines=4, placeholder="வணக்கம்! TESLAFIELD-க்கு வரவேற்கிறோம்."),
        gr.Dropdown(choices=list(LANGUAGES.keys()), value="Tamil", label="Language"),
        gr.Dropdown(choices=VOICES, value="ahana", label="Voice"),
    ],
    outputs=gr.Audio(type="filepath", label="Generated speech"),
    title="TESLAFIELD Voice Engine",
    description="Natural multilingual speech generation with Mithi v2 Flash. Tamil and English are supported. Runs on CPU.",
    examples=None,
    delete_cache=(60, 600),
)

demo.queue(default_concurrency_limit=1)
demo.launch()
