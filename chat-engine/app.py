import logging
import os
from threading import Lock

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from huggingface_hub import hf_hub_download
from llama_cpp import Llama
from pydantic import BaseModel, Field
from typing import Any

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("TESLAFIELD.Chat")

MODEL_REPO = "ggml-org/Qwen3-1.7B-GGUF"
MODEL_FILE = "Qwen3-1.7B-Q4_K_M.gguf"
MODEL_LABEL = "Qwen3-1.7B-Q4_K_M"
SYSTEM_PROMPT = (
    "You are TESLAFIELD AI, a helpful multilingual assistant created by "
    "the TESLAFIELD team. Be accurate, practical, and concise. Support Tamil "
    "and English naturally. If you are unsure, say so. Do not claim to have "
    "performed actions you have not performed."
)

api = FastAPI(title="TESLAFIELD Chat Engine", version="2.0.0")
_llm = None
_model_lock = Lock()


class ChatRequest(BaseModel):
    message: str | None = None
    messages: list[dict[str, Any]] | None = None
    max_new_tokens: int = Field(default=256, ge=16, le=768)


def load_model():
    global _llm
    if _llm is not None:
        return _llm
    with _model_lock:
        if _llm is None:
            logger.info("Downloading/loading %s from %s", MODEL_FILE, MODEL_REPO)
            model_path = hf_hub_download(
                repo_id=MODEL_REPO,
                filename=MODEL_FILE,
            )
            threads = max(1, min(4, os.cpu_count() or 2))
            _llm = Llama(
                model_path=model_path,
                n_ctx=4096,
                n_threads=threads,
                n_batch=256,
                use_mmap=True,
                use_mlock=False,
                verbose=False,
            )
            logger.info("Model loaded: %s", MODEL_LABEL)
    return _llm


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


def generation_options(request):
    return {
        "max_tokens": request.max_new_tokens,
        "temperature": 0.7,
        "top_p": 0.8,
        "top_k": 20,
        "repeat_penalty": 1.08,
    }


@api.get("/")
async def root():
    return {
        "name": "TESLAFIELD Chat Engine",
        "model": MODEL_LABEL,
        "status": "ready" if _llm is not None else "model_not_loaded",
    }


@api.get("/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": _llm is not None,
        "model": MODEL_LABEL,
        "runtime": "CPU / llama.cpp",
    }


@api.get("/info")
async def info():
    return {
        "name": "TESLAFIELD Chat Engine",
        "model": MODEL_LABEL,
        "model_repo": MODEL_REPO,
        "quantization": "Q4_K_M",
        "runtime": "CPU / llama.cpp",
        "context_length": 4096,
        "language_support": ["Tamil", "English", "multilingual"],
    }


@api.post("/chat")
async def chat_api(request: ChatRequest):
    messages = prepare_messages(request)
    try:
        llm = load_model()
        result = llm.create_chat_completion(
            messages=messages,
            **generation_options(request),
            chat_template_kwargs={"enable_thinking": False},
        )
        answer = result["choices"][0]["message"]["content"] or ""
        return {"status": "success", "response": answer.strip(), "model": MODEL_LABEL}
    except Exception:
        logger.exception("Chat generation failed")
        raise HTTPException(status_code=500, detail="Chat model failed to generate a response.")


@api.post("/stream")
async def stream_api(request: ChatRequest):
    messages = prepare_messages(request)

    def token_stream():
        try:
            llm = load_model()
            stream = llm.create_chat_completion(
                messages=messages,
                stream=True,
                **generation_options(request),
                chat_template_kwargs={"enable_thinking": False},
            )
            for chunk in stream:
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                piece = delta.get("content")
                if piece:
                    yield piece
        except Exception:
            logger.exception("Streaming generation failed")
            yield "\n[ TESLAFIELD: response interrupted. Please retry. ]"

    return StreamingResponse(
        token_stream(),
        media_type="text/plain; charset=utf-8",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
