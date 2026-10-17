"""Literal dictation through Groq. Credentials stay on the server."""

import base64
import binascii
import os
import re

import requests

MODEL = "whisper-large-v3"
TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
MAX_AUDIO_BYTES = 8 * 1024 * 1024
SUPPORTED_FORMATS = {"wav", "webm", "ogg", "mp3", "mp4", "m4a", "flac", "mpeg", "mpga"}


class DictationError(RuntimeError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def transcribe(audio: str, audio_format: str = "webm", language: str = "") -> str:
    """Return the original-language transcript without rewriting or translation."""
    if not isinstance(audio, str) or not audio:
        raise DictationError("Audio is required.")
    if len(audio) > 4 * ((MAX_AUDIO_BYTES + 2) // 3):
        raise DictationError("Recording is too large.", 413)
    if not isinstance(audio_format, str) or audio_format not in SUPPORTED_FORMATS:
        raise DictationError("Unsupported audio format.")
    if not isinstance(language, str) or (language and not re.fullmatch(r"[a-z]{2}", language)):
        raise DictationError("Language must be a two-letter language code.")
    try:
        audio_bytes = base64.b64decode(audio, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise DictationError("Audio must be valid base64.") from exc
    if not audio_bytes:
        raise DictationError("Audio is empty.")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise DictationError("Recording is too large.", 413)

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise DictationError("Normal dictation is unavailable. Configure GROQ_API_KEY on the server.", 503)
    data = {"model": MODEL, "response_format": "json", "temperature": "0"}
    if language:
        data["language"] = language
    try:
        response = requests.post(
            TRANSCRIPTION_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": (f"dictation.{audio_format}", audio_bytes)},
            data=data,
            timeout=(10, 75),
        )
    except requests.Timeout as exc:
        raise DictationError("Dictation timed out. Please try again.", 504) from exc
    except requests.RequestException as exc:
        raise DictationError("Could not connect to Groq for dictation.", 502) from exc
    if response.status_code == 429:
        raise DictationError("Groq's dictation limit was reached. Please try again later.", 429)
    if response.status_code in (401, 403):
        raise DictationError("Groq dictation credentials are unavailable or invalid. Contact the server administrator.", 503)
    if not response.ok:
        raise DictationError("Groq could not transcribe this recording. Please try again.", 502)
    try:
        payload = response.json()
    except ValueError as exc:
        raise DictationError("Groq returned an invalid dictation response.", 502) from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("text"), str):
        raise DictationError("Groq returned an invalid dictation response.", 502)
    return payload["text"].strip()
