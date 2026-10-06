"""Generate local deck assets and prepare images with deterministic geometry."""

import hashlib
import io
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from agno.media import Image
from agno.tools import Toolkit
from agno.tools.function import ToolResult
from openrouter_image_client import ImageGenerationError, generate_openrouter_image
from PIL import Image as PillowImage
from PIL import ImageOps, UnidentifiedImageError

IMAGE_STYLES = {
    "venture_blueprint": "editorial product photography, warm paper tones, navy and burnt orange",
    "aetheria_modern": "clean contemporary illustration, white space, cobalt and teal, precise geometry",
    "executive": "understated architectural photography, charcoal, cream, forest green",
    "startup_pitch": "bold cinematic product rendering, dark backdrop, crisp cyan highlights",
    "academic": "accurate scientific editorial illustration, white backdrop, navy and burgundy",
    "creative_portfolio": "expressive art direction, large graphic forms, coral and plum",
    "minimal_zen": "quiet still-life photography, natural light, monochrome, generous empty space",
    "tech_dark": "precise technical 3D illustration, black graphite background, cyan details",
    "corporate_gradient": "bright commercial photography, blue and white, approachable daylight",
}


class PresentationImageTools(Toolkit):
    def __init__(self, api_key: str | None = None):
        super().__init__(
            name="presentation_image_tools", tools=[self.create_presentation_image]
        )
        self.api_key = api_key or os.getenv("OPENROUTER_API_KEY")
        self._assets: dict[str, dict[str, Any]] = {}
        self._directory: Path | None = None

    def create_presentation_image(
        self,
        prompt: str,
        template: str = "aetheria_modern",
        aspect_ratio: str = "3:2",
    ) -> ToolResult:
        """Create a medium-quality deck illustration. Returns a local image_path and model-visible image.

        Describe the subject; template supplies art direction. Use 3:2 landscape, 2:3 portrait, or 1:1.
        Keep text, statistics and diagram labels in editable slide objects. Reuse returned paths.
        """
        if (
            not isinstance(template, str)
            or template not in IMAGE_STYLES
            or not isinstance(prompt, str)
            or not 1 <= len(prompt.strip()) <= 2000
        ):
            return ToolResult(
                content=json.dumps(
                    {
                        "ok": False,
                        "error": "Choose a valid template and a subject prompt under 2,000 characters.",
                    }
                )
            )
        augmented = f"{prompt.strip()}\nArt direction: {IMAGE_STYLES[template]}. Composition: keep the main subject inside the central 70 percent. No text, labels, statistics, logos, or watermark. This is an illustration for a professional presentation, not factual photographic evidence."
        cache_key = hashlib.sha256(f"{augmented}|{aspect_ratio}".encode()).hexdigest()
        if (
            cache_key in self._assets
            and Path(self._assets[cache_key]["image_path"]).exists()
        ):
            return ToolResult(
                content=json.dumps(
                    {"ok": True, "cached": True, "data": self._assets[cache_key]}
                )
            )
        try:
            generated = generate_openrouter_image(
                self.api_key, augmented, quality="medium", aspect_ratio=aspect_ratio
            )
            with PillowImage.open(io.BytesIO(generated.content)) as original:
                raster = ImageOps.exif_transpose(original).convert("RGBA")
                width, height = raster.size
                if self._directory is None:
                    self._directory = Path(
                        tempfile.mkdtemp(prefix="aetheria-ppt-images-")
                    )
                destination = self._directory / f"{cache_key[:20]}.png"
                raster.save(destination)
            asset = {
                "image_path": str(destination),
                "image_fit": "contain",
                "width": width,
                "height": height,
                "model": generated.model,
                "cost_usd": generated.cost_usd,
                "template": template,
                "caption": "AI-generated illustration",
            }
            self._assets[cache_key] = asset
            return ToolResult(
                content=json.dumps({"ok": True, "cached": False, "data": asset}),
                images=[
                    Image(
                        content=destination.read_bytes(),
                        mime_type="image/png",
                        format="png",
                    )
                ],
            )
        except ImageGenerationError as exc:
            return ToolResult(content=json.dumps({"ok": False, "error": str(exc)}))
        except (OSError, ValueError, PillowImage.DecompressionBombError) as exc:
            return ToolResult(
                content=json.dumps(
                    {"ok": False, "error": f"Could not save the deck image: {exc}"}
                )
            )


def prepare_slide_images(slides: list[dict[str, Any]], directory: Path) -> None:
    """Normalize orientation and formats, verify bytes, and attach actual dimensions."""
    prepared: dict[str, tuple[str, int, int]] = {}
    for index, slide in enumerate(slides, 1):
        source = slide.get("image_path", slide.get("imagePath"))
        if not source:
            continue
        if not isinstance(source, str):
            raise TypeError(f"Slide {index}: image_path must be a local file path.")
        if source not in prepared:
            try:
                with PillowImage.open(source) as original:
                    raster = ImageOps.exif_transpose(original).convert("RGBA")
                    raster.load()
                    width, height = raster.size
                    target = directory / f"asset-{len(prepared) + 1}.png"
                    raster.save(target)
                prepared[source] = str(target), width, height
            except (
                OSError,
                UnidentifiedImageError,
                ValueError,
                PillowImage.DecompressionBombError,
            ) as exc:
                raise ValueError(
                    f"Slide {index}: broken_image, cannot read {source}."
                ) from exc
        slide["image_path"], slide["image_width"], slide["image_height"] = prepared[
            source
        ]
