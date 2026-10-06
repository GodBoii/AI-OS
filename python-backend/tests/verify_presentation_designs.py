"""Generate all nine designs from identical content and review a real generated asset."""

import argparse
import json
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ppt_tools import TEMPLATES, PresentationTools
from test_presentation_toolkit import example_slides


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument(
        "--output", type=Path, default=Path("presentation-toolkit-output/design-review")
    )
    parser.add_argument("--powerpoint", action="store_true")
    parser.add_argument(
        "--publish-previews",
        action="store_true",
        help="Refresh the app's checked-in template preview JPEGs",
    )
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    tool = PresentationTools(user_id=None, session_id=None, message_id=None)
    original = example_slides(str(args.image.resolve()))
    original[0]["image_path"] = str(args.image.resolve())
    original[0]["image_fit"] = "contain"
    original[7]["caption"] = "AI-generated illustration for layout verification"
    selected = [original[i] for i in [0, 1, 2, 3, 4, 5, 6, 7, 14]]
    report = []
    for template in TEMPLATES:
        result = tool.create_presentation(
            "Customer operations pilot", selected, template, filename=template
        )
        if not result["ok"]:
            raise RuntimeError(json.dumps({"template": template, **result}, indent=2))
        destination = output / template
        shutil.copytree(
            Path(result["data"]["local_path"]).parent, destination, dirs_exist_ok=True
        )
        report.append(
            {
                "template": template,
                "quality": result["quality"],
                "pptx": str(destination / f"{template}.pptx"),
            }
        )
        print(
            json.dumps({"template": template, "status": result["quality"]["status"]}),
            flush=True,
        )
    if args.powerpoint:
        shell = shutil.which("pwsh") or shutil.which("powershell")
        import subprocess

        subprocess.run(
            [
                shell,
                "-NoProfile",
                "-NonInteractive",
                "-File",
                str(Path(__file__).with_name("render_presentation_powerpoint.ps1")),
                "-OutputRoot",
                str(output),
                "-DesignReview",
            ],
            check=True,
            timeout=120,
        )
    if args.publish_previews:
        if not args.powerpoint:
            parser.error(
                "--publish-previews requires --powerpoint for actual Office renders"
            )
        assets = (
            Path(__file__).resolve().parents[2]
            / "assets"
            / "presentation-design-previews"
        )
        indices = {
            "cover": 1,
            "content": 2,
            "comparison": 3,
            "chart": 4,
            "table": 7,
            "diagram": 6,
            "image": 8,
        }
        for item in report:
            destination = assets / item["template"]
            destination.mkdir(parents=True, exist_ok=True)
            for name, index in indices.items():
                with Image.open(
                    output
                    / item["template"]
                    / "powerpoint-previews"
                    / f"Slide{index}.PNG"
                ) as preview:
                    preview = preview.convert("RGB")
                    preview.thumbnail((720, 405))
                    preview.save(destination / f"{name}.jpg", quality=84)
    for native in [False, True] if args.powerpoint else [False]:
        sheet = Image.new("RGB", (1500, 3 * 330), "#E1E5E9")
        draw = ImageDraw.Draw(sheet)
        for index, item in enumerate(report):
            directory = output / item["template"]
            if native:
                image_path = directory / "powerpoint-previews" / "Slide1.PNG"
            else:
                image_path = (
                    next((directory / "presentation-harness").glob("*.slides"))
                    / "previews"
                    / "slide-01.jpg"
                )
            with Image.open(image_path) as preview:
                thumb = preview.convert("RGB")
                thumb.thumbnail((480, 270))
            x, y = index % 3 * 500 + 10, index // 3 * 330 + 42
            sheet.paste(thumb, (x, y))
            draw.text(
                (x, y - 29),
                TEMPLATES[item["template"]]["name"],
                fill="#173042",
                font_size=18,
            )
        sheet.save(
            output
            / ("powerpoint-design-gallery.jpg" if native else "design-gallery.jpg")
        )
    (output / "design-verification.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
