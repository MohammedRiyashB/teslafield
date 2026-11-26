import asyncio
import logging
import os
from threading import Lock, Thread
from typing import Any

import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Teslafield.Chat")
MODEL_ID = "Qwen/Qwen3-0.6B"
SYSTEM_PROMPT = (
    "You are Teslafield AI, a helpful multilingual assistant created by "
    "the Teslafield team. Be accurate, practical, and concise. Support Tamil "
    "and English naturally. If you are unsure, say so. Do not claim to have "
    "performed actions you have not performed."
)

api = FastAPI(title="Teslafield Chat Engine", version="1.0.0")
_tokenizer = None
_model = None
_model_lock = Lock()


class ChatRequest(BaseModel):
    message: str | None = None
    messages: list[dict[str, Any]] | None = None
    max_new_tokens: int = Field(default=256, ge=16, le=768)


def load_model():
    global _tokenizer, _model
    if _model is not None:
        return _tokenizer, _model
    with _model_lock:
        if _model is None:
            torch.set_num_threads(max(1, min(2, os.cpu_count() or 2)))
            logger.info("Loading %s on CPU", MODEL_ID)
            _tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
            _model = AutoModelForCausalLM.from_pretrained(
                MODEL_ID,
                torch_dtype=torch.float32,
                low_cpu_mem_usage=True,
            ).to("cpu")
            _model.eval()
            logger.info("Model loaded")
    return _tokenizer, _model


def prepare_messages(request: ChatRequest):
    clean = [{"role": "system", "content": SYSTEM_PROMPT}]
    if request.messages:
        for item in request.messages[-16:]:
            role = item.get("role")
            content = item.get("content")
            if role in ("user", "assistant") and isinstance(content, str) and content.strip():
                clean.append({"role": role, "content": content[:12000]})
    elif request.message and request.message.strip():
        clean.append({"role": "user", "content": request.message[:12000]})
    else:
        raise HTTPException(status_code=400, detail="Provide message or messages.")
    return clean


def make_inputs(messages):
    tokenizer, model = load_model()
    prompt = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False,
    )
    return tokenizer(prompt, return_tensors="pt"), tokenizer, model


def generate(messages, max_new_tokens):
    inputs, tokenizer, model = make_inputs(messages)
    with torch.inference_mode():
        output = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=True,
            temperature=0.7,
            top_p=0.8,
            top_k=20,
            repetition_penalty=1.08,
            pad_token_id=tokenizer.eos_token_id,
        )
    return tokenizer.decode(
        output[0][inputs["input_ids"].shape[1]:],
        skip_special_tokens=True,
    ).strip()


@api.get("/")
async def root():
    return {"name": "Teslafield Chat Engine", "model": MODEL_ID, "status": "ready"}


@api.get("/health")
async def health():
    return {"status": "ok", "model_loaded": _model is not None, "model": MODEL_ID}


@api.get("/info")
async def info():
    return {"name": "Teslafield Chat Engine", "model": MODEL_ID, "runtime": "CPU", "language_support": ["Tamil", "English", "multilingual"]}


@api.post("/chat")
async def chat_api(request: ChatRequest):
    messages = prepare_messages(request)
    try:
        answer = await asyncio.to_thread(generate, messages, request.max_new_tokens)
        return {"status": "success", "response": answer, "model": MODEL_ID}
    except Exception:
        logger.exception("Chat generation failed")
        raise HTTPException(status_code=500, detail="Chat model failed to generate a response.")


@api.post("/stream")
async def stream_api(request: ChatRequest):
    messages = prepare_messages(request)
    inputs, tokenizer, model = make_inputs(messages)
    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
    generation_kwargs = dict(
        **inputs,
        streamer=streamer,
        max_new_tokens=request.max_new_tokens,
        do_sample=True,
        temperature=0.7,
        top_p=0.8,
        top_k=20,
        repetition_penalty=1.08,
        pad_token_id=tokenizer.eos_token_id,
    )

    def run_generation():
        with torch.inference_mode():
            model.generate(**generation_kwargs)

    Thread(target=run_generation, daemon=True).start()

    def token_stream():
        for piece in streamer:
            yield piece

    return StreamingResponse(token_stream(), media_type="text/plain; charset=utf-8")
