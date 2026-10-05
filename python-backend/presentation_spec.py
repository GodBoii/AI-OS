"""Compact deck input and content checks, independent of agent and storage services."""

import json
import math
import re
from typing import Any

LAYOUTS = {
    "title": "title, subtitle?, kicker?",
    "content": "title, bullets[1..4], subtitle?, callout?",
    "two_column": "title, left_title, right_title, left_content[1..4], right_content[1..4]",
    "metrics": "title, metrics[{value,label}][1..4], subtitle?",
    "chart": "title, chart{type:bar|column|line,data:[{label,value}]}, source?, callout?",
    "table": "title, table:[[header,...],[cell,...],...], source?",
    "diagram": "title, steps:[string|{title,detail}][2..5]",
    "image": "title, image_path, caption?, bullets[0..3]",
    "section": "title, subtitle?",
    "closing": "title, bullets[1..3], callout?",
}
ALIASES = {
    "cover": "title",
    "comparison": "two_column",
    "process": "diagram",
    "visual": "image",
    "evidence": "chart",
}


def parse_outline(outline: str) -> list[dict[str, Any]]:
    """Each ## heading is a slide. Optional [layout] prefix; - lines are bullets.

    Named fields use key: value. chart/table/metrics/steps accept compact JSON.
    Unmarked body text becomes a subtitle. Content comes from the caller only.
    """
    slides: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for raw in outline.splitlines():
        line = raw.strip()
        if not line:
            continue
        match = re.fullmatch(r"##\s+(?:\[([a-z_]+)\]\s+)?(.+)", line)
        if match:
            current = {
                "type": match[1] or ("title" if not slides else "content"),
                "title": match[2],
            }
            slides.append(current)
        elif current is None:
            raise ValueError("Start each slide with ## [layout] Title.")
        elif line.startswith("- "):
            current.setdefault("bullets", []).append(line[2:])
        elif ":" in line and line.split(":", 1)[0] in {
            "subtitle",
            "kicker",
            "callout",
            "source",
            "notes",
            "caption",
            "image_path",
            "left_title",
            "right_title",
            "left_content",
            "right_content",
            "chart",
            "table",
            "metrics",
            "steps",
        }:
            key, value = line.split(":", 1)
            value = value.strip()
            if key in {
                "chart",
                "table",
                "metrics",
                "steps",
                "left_content",
                "right_content",
            }:
                try:
                    current[key] = json.loads(value)
                except json.JSONDecodeError as exc:
                    raise ValueError(
                        f"Slide {len(slides)}: {key} needs valid JSON."
                    ) from exc
            else:
                current[key] = value
        else:
            current["subtitle"] = " ".join(
                filter(None, [current.get("subtitle"), line])
            )
    if not slides:
        raise ValueError("Outline has no slides. Use ## [layout] Title headings.")
    return slides


def content_issues(slides: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return actionable issues without rewriting, inventing, or truncating content."""
    issues: list[dict[str, Any]] = []

    def issue(index: int, field: str, message: str, severity: str = "error") -> None:
        issues.append(
            {"slide": index, "field": field, "severity": severity, "message": message}
        )

    for index, slide in enumerate(slides, 1):
        if not isinstance(slide, dict):
            issue(index, "slide", "Use a slide object.")
            continue
        raw_layout = slide.get("type", "content")
        if not isinstance(raw_layout, str):
            issue(index, "type", "Use a layout name as text.")
            continue
        layout = ALIASES.get(raw_layout.lower(), raw_layout.lower())
        if layout == "html" or slide.get("html") or slide.get("contract_html"):
            continue  # Geometry and strict contract checks run in the renderer.
        if layout not in LAYOUTS:
            issue(
                index,
                "type",
                f"Unknown layout {layout!r}. Choose {', '.join(LAYOUTS)}.",
            )
        if not isinstance(slide.get("title"), str) or not slide["title"].strip():
            issue(index, "title", "Supply a concrete slide title.")
        elif len(slide["title"]) > 100:
            issue(
                index,
                "title",
                "Keep the title under 100 characters; move detail to notes.",
            )
        for field, limit in [
            ("subtitle", 180),
            ("callout", 150),
            ("caption", 180),
            ("source", 220),
        ]:
            if field in slide and (
                not isinstance(slide[field], str) or len(slide[field]) > limit
            ):
                issue(index, field, f"Use text under {limit} characters.")
        fields = (
            ["left_content", "right_content"] if layout == "two_column" else ["bullets"]
        )
        for field in fields:
            items = slide.get(
                field, slide.get("content", []) if field == "bullets" else []
            )
            if isinstance(items, str):
                items = [
                    part.strip() for part in re.split(r"\n|;", items) if part.strip()
                ]
            if not isinstance(items, list) or len(items) > (
                3 if layout in {"image", "closing"} else 4
            ):
                issue(
                    index,
                    field,
                    "Use at most 4 short items, or 3 on image/closing slides.",
                )
            elif any(not isinstance(item, str) or len(item) > 150 for item in items):
                issue(index, field, "Each item must be text under 150 characters.")
            elif layout in {"content", "closing", "two_column"} and not items:
                issue(index, field, "Supply at least one item.")
        if layout == "two_column":
            for field in ("left_title", "right_title"):
                if (
                    not isinstance(slide.get(field), str)
                    or not 0 < len(slide[field]) <= 55
                ):
                    issue(index, field, "Supply a panel title under 55 characters.")
        if layout == "chart":
            chart = slide.get("chart", {})
            if not isinstance(chart, dict) or chart.get("type", "bar") not in {
                "bar",
                "column",
                "line",
            }:
                issue(index, "chart", "Use a bar, column, or line chart object.")
            else:
                data = chart.get("data", [])
                if not isinstance(data, list) or not 2 <= len(data) <= 8:
                    issue(index, "chart.data", "Supply 2 to 8 labeled numeric values.")
                elif any(
                    not isinstance(row, dict)
                    or not isinstance(row.get("label"), str)
                    or len(row["label"]) > 32
                    or not row["label"].strip()
                    or isinstance(row.get("value"), bool)
                    or not isinstance(row.get("value"), (int, float))
                    or not math.isfinite(row["value"])
                    for row in data
                ):
                    issue(
                        index,
                        "chart.data",
                        "Every point needs a short label and a finite numeric value.",
                    )
            if not slide.get("source"):
                issue(
                    index,
                    "source",
                    "Add a source or explicitly label illustrative data.",
                    "warning",
                )
        if layout == "table":
            rows = slide.get("table")
            if not isinstance(rows, list) or not 2 <= len(rows) <= 7:
                issue(index, "table", "Use a header plus 1 to 6 rows.")
            elif (
                not isinstance(rows[0], list)
                or not 2 <= len(rows[0]) <= 4
                or any(
                    not isinstance(row, list)
                    or len(row) != len(rows[0])
                    or any(
                        not isinstance(cell, (str, int, float)) or len(str(cell)) > 85
                        for cell in row
                    )
                    for row in rows
                )
            ):
                issue(
                    index,
                    "table",
                    "Use 2 to 4 equal columns; keep cells under 85 characters.",
                )
        if layout == "diagram":
            nodes = slide.get("steps", slide.get("nodes"))
            if not isinstance(nodes, list) or not 2 <= len(nodes) <= 5:
                issue(index, "steps", "Supply 2 to 5 steps.")
            elif any(
                not isinstance(node, (str, dict))
                or (isinstance(node, str) and not node.strip())
                or len(node if isinstance(node, str) else str(node.get("title", "")))
                > 45
                or (
                    isinstance(node, dict)
                    and (
                        not isinstance(node.get("title"), str)
                        or not node.get("title")
                        or not isinstance(node.get("detail", ""), str)
                        or len(str(node.get("detail", ""))) > 100
                    )
                )
                for node in nodes
            ):
                issue(
                    index,
                    "steps",
                    "Use titles under 45 characters and details under 100.",
                )
        metrics = slide.get("metrics", [])
        if (
            not isinstance(metrics, list)
            or len(metrics) > 4
            or (layout == "metrics" and not metrics)
        ):
            issue(index, "metrics", "Supply 1 to 4 metrics.")
        elif any(
            not isinstance(item, dict)
            or not str(item.get("value", "")).strip()
            or len(str(item["value"])) > 16
            or not isinstance(item.get("label"), str)
            or not item["label"].strip()
            or len(item["label"]) > 55
            for item in metrics
        ):
            issue(
                index,
                "metrics",
                "Each metric needs a value under 16 characters and label under 55.",
            )
        if layout == "image" and not slide.get("image_path", slide.get("imagePath")):
            issue(
                index,
                "image_path",
                "Supply an existing local image; choose another layout if none is available.",
            )
    return issues
