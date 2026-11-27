"""Small, dependency-free response-style helpers for the Teslafield chat engine."""

STYLE_INSTRUCTIONS = {
    "concise": (
        "RESPONSE STYLE: Be concise and direct. Lead with the answer, use short "
        "sentences, and avoid unnecessary repetition. Preserve important caveats."
    ),
    "balanced": (
        "RESPONSE STYLE: Give a clear, balanced answer with enough explanation "
        "to be useful. Use examples or steps when they materially help."
    ),
    "detailed": (
        "RESPONSE STYLE: Give a thorough, structured answer. Explain the reasoning "
        "at a high level, include useful steps and examples, and state relevant limits."
    ),
}


def normalize_response_style(value):
    """Return a supported style, defaulting safely to balanced."""
    if isinstance(value, str) and value in STYLE_INSTRUCTIONS:
        return value
    return "balanced"


def apply_response_style(messages, value):
    """Return a copied message list with the selected style in the system prompt."""
    result = [dict(message) for message in messages]
    style_instruction = STYLE_INSTRUCTIONS[normalize_response_style(value)]
    if result and result[0].get("role") == "system":
        result[0]["content"] = str(result[0].get("content") or "") + "\n\n" + style_instruction
    else:
        result.insert(0, {"role": "system", "content": style_instruction})
    return result
