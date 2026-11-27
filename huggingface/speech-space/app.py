import logging
import os
from functools import lru_cache

import gradio as gr
from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("TESLAFIELD.Speech")
MODEL_NAME = "base"


@lru_cache(maxsize=1)
def get_model():
    logger.info("Loading faster-whisper %s on CPU (INT8)", MODEL_NAME)
    return WhisperModel(
        MODEL_NAME,
        device="cpu",
        compute_type="int8",
        cpu_threads=max(1, min(2, os.cpu_count() or 2)),
        num_workers=1,
    )


def transcribe(audio_path, language_choice):
    if not audio_path:
        raise gr.Error("Please record or upload an audio file.")

    language_map = {
        "Auto detect": None,
        "Tamil": "ta",
        "English": "en",
    }
    selected_language = language_map.get(language_choice)
    model = get_model()
    segments, info = model.transcribe(
        audio_path,
        language=selected_language,
        task="transcribe",
        beam_size=1,
        best_of=1,
        temperature=0.0,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    transcript = " ".join(segment.text.strip() for segment in segments).strip()
    if not transcript:
        return "No speech detected. Please try a clearer recording."
    logger.info("Transcription complete; detected language=%s", info.language)
    return transcript


demo = gr.Interface(
    fn=transcribe,
    inputs=[
        gr.Audio(type="filepath", label="Record or upload audio"),
        gr.Dropdown(
            choices=["Auto detect", "Tamil", "English"],
            value="Auto detect",
            label="Spoken language",
        ),
    ],
    outputs=gr.Textbox(label="Transcript", lines=6),
    title="TESLAFIELD Speech Engine",
    description="Local Whisper Base speech recognition for Tamil and English. Audio is transcribed in its original language.",
    examples=None,
    delete_cache=(60, 600),
)

demo.queue()
demo.launch()
