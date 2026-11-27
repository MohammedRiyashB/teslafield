"""Helpers for determining Hugging Face generation completion."""


def generation_finish_reason(generated_token_count, max_new_tokens, last_token_id=None, eos_token_id=None):
    """Return OpenAI-compatible finish_reason for a streamed generation."""
    if generated_token_count >= max_new_tokens and (eos_token_id is None or last_token_id != eos_token_id):
        return "length"
    return "stop"
