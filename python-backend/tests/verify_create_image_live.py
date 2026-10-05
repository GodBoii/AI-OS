"""Opt-in free OpenRouter smoke test; writes local images without cloud storage."""

import argparse
import base64
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from openrouter_image_client import ImageGenerationError, generate_openrouter_image  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--reference", type=Path, help="Use an existing PNG for the reference test.")
    args = parser.parse_args()
    load_dotenv(BACKEND / ".env")
    key = os.getenv("OPENROUTER_API_KEY")
    if not key:
        parser.error("OPENROUTER_API_KEY is required")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    try:
        if args.reference:
            content = args.reference.read_bytes()
        else:
            result = generate_openrouter_image(key, "A simple flat illustration of a red bicycle on a cream background. No text.")
            destination = args.output_dir / "text-to-image.png"
            destination.write_bytes(result.content)
            content = result.content
            print(f"Text generation passed: model={result.model}, mime={result.mime_type}, bytes={len(content)}")
        reference = "data:image/png;base64," + base64.b64encode(content).decode("ascii")
        edited = generate_openrouter_image(key, "Change the bicycle to blue and keep the cream background.", reference)
        (args.output_dir / "image-to-image.png").write_bytes(edited.content)
        print(f"Reference generation passed: model={edited.model}, mime={edited.mime_type}, bytes={len(edited.content)}")
        return 0
    except ImageGenerationError as exc:
        print(f"Image generation check failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
