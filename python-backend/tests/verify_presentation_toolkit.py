"""Generate review decks and measure serialized tool traffic without model calls.

Run from the repository root. tiktoken is optional and only used by this benchmark.
"""

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ppt_tools import PresentationTools
from test_presentation_toolkit import example_slides, to_outline


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=Path("presentation-toolkit-output")
    )
    parser.add_argument(
        "--baseline-ref", help="Optional Git ref containing the previous renderer"
    )
    parser.add_argument(
        "--powerpoint",
        action="store_true",
        help="Render and audit decks with installed PowerPoint on Windows",
    )
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    try:
        import tiktoken

        encoding = tiktoken.get_encoding("cl100k_base")
        count_tokens = lambda value: len(encoding.encode(value, disallowed_special=()))
        tokenizer = "cl100k_base proxy; the production model tokenizer may differ"
    except ImportError:
        count_tokens = lambda value: None
        tokenizer = "unavailable; install tiktoken for token counts"

    image = Image.new("RGB", (1200, 600), "#EFF3F7")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1200, 78), fill="#173042")
    draw.text(
        (32, 28), "CUSTOMER OPERATIONS / SHARED QUEUE", fill="white", font_size=26
    )
    for row, (title, owner, status) in enumerate(
        [
            ("Account access", "Support", "Review"),
            ("Billing question", "Finance", "Assigned"),
            ("Setup help", "Success", "Resolved"),
            ("Product feedback", "Product", "Assigned"),
        ]
    ):
        y = 108 + row * 112
        draw.rounded_rectangle((28, y, 1172, y + 86), radius=8, fill="white")
        draw.text((55, y + 26), title, fill="#173042", font_size=27)
        draw.text((650, y + 26), owner, fill="#637083", font_size=25)
        draw.text((920, y + 26), status, fill="#1B5299", font_size=25)
    image_path = output / "queue-example.png"
    image.save(image_path)
    slides = example_slides(str(image_path))
    toolkit = PresentationTools(user_id=None, session_id=None, message_id=None)
    schemas = []
    for function in toolkit.functions.values():
        function.process_entrypoint()
        schemas.append(function.to_dict())
    report = {
        "tokenizer": tokenizer,
        "tool_schema_tokens": count_tokens(json.dumps(schemas)),
        "decks": [],
    }
    baseline_renderer = None
    if args.baseline_ref:
        original = subprocess.run(
            [
                "git",
                "show",
                f"{args.baseline_ref}:python-backend/ppt_harness_renderer.js",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        ).stdout
        baseline_renderer = output / "baseline-renderer.cjs"
        baseline_renderer.write_text(original, encoding="utf-8")

    for count, template in [
        (5, "executive"),
        (10, "startup_pitch"),
        (15, "aetheria_modern"),
    ]:
        selected = slides[: count - 1] + [slides[-1]]
        outline = to_outline(selected)
        started = time.perf_counter()
        result = toolkit.create_presentation_from_outline(
            "Customer support pilot",
            outline,
            template,
            filename=f"support-pilot-{count}",
            expected_slide_count=count,
        )
        elapsed = round(time.perf_counter() - started, 2)
        if not result["ok"]:
            raise RuntimeError(json.dumps(result, indent=2))
        destination = output / f"{count}-slides"
        shutil.copytree(
            Path(result["data"]["local_path"]).parent, destination, dirs_exist_ok=True
        )
        (destination / "outline.md").write_text(outline, encoding="utf-8")
        (destination / "tool-result.json").write_text(
            json.dumps(result, indent=2), encoding="utf-8"
        )
        request = {
            "topic": "Customer support pilot",
            "outline": outline,
            "template": template,
            "expected_slide_count": count,
        }
        row = {
            "slides": count,
            "template": template,
            "quality": result["quality"]["status"],
            "seconds": elapsed,
            "tool_calls_before": count + 2,
            "tool_calls_now": 1,
            "outline_request_tokens": count_tokens(json.dumps(request)),
            "structured_request_tokens": count_tokens(
                json.dumps(
                    {
                        "topic": request["topic"],
                        "template": template,
                        "slides": selected,
                    }
                )
            ),
            "tool_response_tokens": count_tokens(json.dumps(result)),
            "response_characters": len(json.dumps(result)),
            "pptx": str(destination / Path(result["data"]["local_path"]).name),
        }
        if baseline_renderer:
            payload = output / f"baseline-{count}.json"
            payload.write_text(
                json.dumps(
                    {
                        "topic": request["topic"],
                        "template": template,
                        "slides": selected,
                        "output_path": str(output / "baseline" / f"deck-{count}.pptx"),
                    }
                ),
                encoding="utf-8",
            )
            previous = subprocess.run(
                [shutil.which("node"), str(baseline_renderer), str(payload)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=120,
                check=True,
            )
            previous_result = json.loads(previous.stdout)
            row["baseline_renderer_response_tokens"] = count_tokens(previous.stdout)
            row["baseline_response_characters"] = len(previous.stdout)
            row["baseline_layout_ok"] = previous_result["layout_validation"]["ok"]
            row["baseline_browser_ok"] = previous_result["harness"][
                "screenshot_validation"
            ]["ok"]
        report["decks"].append(row)
        print(json.dumps(row))
        preview_dir = (
            next((destination / "presentation-harness").glob("*.slides")) / "previews"
        )
        thumbs = []
        for file in sorted(preview_dir.glob("*.jpg")):
            with Image.open(file) as preview:
                thumb = preview.copy()
            thumb.thumbnail((480, 270))
            thumbs.append(thumb)
        contact = Image.new("RGB", (3 * 500, ((count + 2) // 3) * 310), "#E1E5E9")
        contact_draw = ImageDraw.Draw(contact)
        for i, thumb in enumerate(thumbs):
            x, y = (i % 3) * 500 + 10, (i // 3) * 310 + 28
            contact.paste(thumb, (x, y))
            contact_draw.text(
                (x, y - 21), f"Slide {i + 1}", fill="#173042", font_size=15
            )
        contact.save(destination / "contact-sheet.jpg")
    if args.powerpoint:
        powershell = shutil.which("pwsh") or shutil.which("powershell")
        if sys.platform != "win32" or not powershell:
            raise RuntimeError(
                "Native PowerPoint verification requires Windows, PowerShell and installed PowerPoint."
            )
        subprocess.run(
            [
                powershell,
                "-NoProfile",
                "-NonInteractive",
                "-File",
                str(Path(__file__).with_name("render_presentation_powerpoint.ps1")),
                "-OutputRoot",
                str(output),
            ],
            check=True,
            timeout=120,
        )
        report["native_powerpoint"] = json.loads(
            (output / "powerpoint-audit.json").read_text(encoding="utf-8-sig")
        )
        for count in (5, 10, 15):
            directory = output / f"{count}-slides"
            native_images = sorted(
                (directory / "powerpoint-previews").glob("*.PNG"),
                key=lambda file: int("".join(filter(str.isdigit, file.stem))),
            )
            if len(native_images) != count:
                raise RuntimeError(
                    f"PowerPoint returned {len(native_images)} images for {count} slides."
                )
            contact = Image.new("RGB", (1500, ((count + 2) // 3) * 310), "#E1E5E9")
            draw = ImageDraw.Draw(contact)
            for i, file in enumerate(native_images):
                with Image.open(file) as native:
                    thumb = native.convert("RGB")
                    thumb.thumbnail((480, 270))
                x, y = (i % 3) * 500 + 10, (i // 3) * 310 + 28
                contact.paste(thumb, (x, y))
                draw.text(
                    (x, y - 21),
                    f"PowerPoint slide {i + 1}",
                    fill="#173042",
                    font_size=15,
                )
            contact.save(directory / "powerpoint-contact-sheet.jpg")
    (output / "benchmark.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
