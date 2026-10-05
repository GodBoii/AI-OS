import json
import logging
import mimetypes
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from agno.agent import Agent
from agno.tools import Toolkit
from presentation_spec import LAYOUTS, content_issues, parse_outline

logger = logging.getLogger(__name__)


def get_persistence_service() -> Any:
    """Load cloud storage only when publishing an authenticated artifact."""
    from sandbox_persistence import get_persistence_service as get_service

    return get_service()


PPTX_MIME_TYPE = (
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
)

TEMPLATE_LAYOUTS = [
    {"type": layout, "name": layout.replace("_", " ").title(), "usage": fields}
    for layout, fields in LAYOUTS.items()
]

TEMPLATES: dict[str, dict[str, Any]] = {
    "venture_blueprint": {
        "name": "Venture Blueprint",
        "description": "Premium pitch and business deck with bold left-rail titles, editorial image zones, and investor-grade evidence layouts.",
        "best_for": "pitch decks, business plans, strategy narratives, product launches",
        "design_brief": (
            "Use this as a true pitch/business storytelling system, not a recolored standard deck. "
            "Prefer strong claim-style titles, large left-side thesis blocks, right-side product or market visuals, "
            "metric chips, problem/solution contrast, market evidence charts, business model tables, and roadmap steps. "
            "Keep text concise so it fits: short titles, 3-4 bullets, and compact labels. Include image_path on visual/product slides when available."
        ),
        "layouts": TEMPLATE_LAYOUTS,
    },
    "aetheria_modern": {
        "name": "Aetheria Modern",
        "description": "Clean editorial deck for AI strategy and product narratives.",
        "best_for": "AI strategy, product plans, operational reviews",
        "design_brief": "Editorial, spacious, sharp blue/red/green accents, visual systems, insight cards, and restrained business polish.",
        "layouts": TEMPLATE_LAYOUTS,
    },
    "executive": {
        "name": "Executive Boardroom",
        "description": "Refined boardroom aesthetic with crisp data hierarchy.",
        "best_for": "business reviews, leadership updates, investor summaries",
        "design_brief": "Boardroom-ready, calm, metric-led, structured comparisons, polished evidence, and premium whitespace.",
        "layouts": TEMPLATE_LAYOUTS,
    },
    "startup_pitch": {
        "name": "Startup Pitch",
        "description": "High-contrast dark deck with bold metrics for investors.",
        "best_for": "startup fundraising, product launches, market narratives",
        "design_brief": "High-contrast, energetic, metric-first, product/storytelling slides with strong visual hierarchy.",
        "layouts": TEMPLATE_LAYOUTS,
    },
    "academic": {
        "name": "Academic Research",
        "description": "Formal scholarly layout with readable evidence and citations.",
        "best_for": "research talks, coursework, technical explainers",
        "design_brief": "Scholarly, readable, evidence-heavy, citation-friendly, with structured findings and methodology diagrams.",
        "layouts": TEMPLATE_LAYOUTS,
    },
    "creative_portfolio": {
        "name": "Creative Portfolio",
        "description": "Bold expressive deck with vibrant gradients and asymmetric layouts.",
        "best_for": "design portfolios, creative briefs, brand pitches",
        "design_brief": "Expressive, asymmetric, colorful, showcase-oriented, with strong visual slides and bold story beats.",
        "layouts": TEMPLATE_LAYOUTS,
    },
    "minimal_zen": {
        "name": "Minimal Zen",
        "description": "Ultra-clean whitespace design with restrained single-accent palette.",
        "best_for": "thought leadership, keynotes, minimalist reports",
        "design_brief": "Minimal, quiet, highly legible, generous whitespace, fewer words, and carefully paced emphasis.",
        "layouts": TEMPLATE_LAYOUTS,
    },
    "tech_dark": {
        "name": "Tech Neon",
        "description": "Dark engineering theme with electric neon accents and sharp edges.",
        "best_for": "technical demos, developer talks, product launches",
        "design_brief": "Dark technical interface style, neon accents, architecture/process diagrams, specs, and benchmark evidence.",
        "layouts": TEMPLATE_LAYOUTS,
    },
    "corporate_gradient": {
        "name": "Corporate Horizon",
        "description": "Professional gradient-rich deck with structured visual hierarchy.",
        "best_for": "quarterly reports, all-hands meetings, client proposals",
        "design_brief": "Corporate, confident, structured, client-ready, with KPI evidence, process slides, and organized summaries.",
        "layouts": TEMPLATE_LAYOUTS,
    },
}

DECK_ARCHETYPES: dict[str, dict[str, Any]] = {
    "series_a_pitch": {
        "name": "Series A / Investor Pitch",
        "signals": [
            "pitch",
            "fundraise",
            "investor",
            "series a",
            "seed",
            "demo day",
            "startup",
        ],
        "purpose": "persuade investors",
        "audience": "investors and startup stakeholders",
        "recommended_templates": ["venture_blueprint", "startup_pitch"],
        "voice": "crisp, ambitious, evidence-led, founder-ready",
        "slide_plan": [
            "title",
            "content",
            "two_column",
            "chart",
            "image",
            "diagram",
            "table",
        ],
        "structure": "Cover, problem, solution, market evidence, product/vision, roadmap, business model or ask.",
    },
    "strategy_memo": {
        "name": "Strategy Memo",
        "signals": [
            "strategy",
            "memo",
            "plan",
            "recommendation",
            "market entry",
            "initiative",
        ],
        "purpose": "align leadership around a decision",
        "audience": "executives and operators",
        "recommended_templates": ["executive", "aetheria_modern", "corporate_gradient"],
        "voice": "consulting-style, decisive, implication-first",
        "slide_plan": ["title", "content", "chart", "two_column", "diagram", "table"],
        "structure": "Executive thesis, context, options, evidence, recommendation, execution plan.",
    },
    "board_deck": {
        "name": "Board / Leadership Update",
        "signals": [
            "board",
            "qbr",
            "quarterly",
            "leadership",
            "investor update",
            "update",
        ],
        "purpose": "inform and focus discussion",
        "audience": "board members and senior leaders",
        "recommended_templates": [
            "executive",
            "corporate_gradient",
            "venture_blueprint",
        ],
        "voice": "measured, transparent, metric-led",
        "slide_plan": ["title", "chart", "table", "content", "diagram"],
        "structure": "Status, key metrics, wins, risks, decisions needed, next-quarter plan.",
    },
    "sales_enablement": {
        "name": "Sales Enablement",
        "signals": [
            "sales",
            "enablement",
            "proposal",
            "client",
            "customer",
            "gtm",
            "go to market",
        ],
        "purpose": "persuade a buyer or equip a sales team",
        "audience": "customers, prospects, or revenue teams",
        "recommended_templates": [
            "corporate_gradient",
            "venture_blueprint",
            "aetheria_modern",
        ],
        "voice": "benefit-led, concrete, buyer-aware",
        "slide_plan": ["title", "content", "two_column", "chart", "table", "diagram"],
        "structure": "Buyer problem, business impact, solution, proof, implementation path, next step.",
    },
    "lesson_training": {
        "name": "Lesson / Training",
        "signals": [
            "lesson",
            "training",
            "teach",
            "course",
            "workshop",
            "introduction",
            "explain",
        ],
        "purpose": "teach clearly",
        "audience": "learners",
        "recommended_templates": ["academic", "aetheria_modern", "minimal_zen"],
        "voice": "clear, scaffolded, example-driven",
        "slide_plan": ["title", "content", "diagram", "two_column", "chart", "content"],
        "structure": "Learning goal, concept map, core ideas, examples, comparison, recap.",
    },
    "technical_demo": {
        "name": "Technical Demo",
        "signals": [
            "technical",
            "developer",
            "architecture",
            "demo",
            "api",
            "system",
            "engineering",
        ],
        "purpose": "explain how a system works",
        "audience": "technical evaluators and builders",
        "recommended_templates": ["tech_dark", "aetheria_modern"],
        "voice": "precise, system-oriented, implementation-aware",
        "slide_plan": ["title", "diagram", "content", "chart", "table", "diagram"],
        "structure": "Problem, architecture, workflow, benchmarks, tradeoffs, rollout.",
    },
}


def _template_summary(template_id: str, template: dict[str, Any]) -> dict[str, str]:
    return {
        "id": template_id,
        "name": str(template.get("name", template_id)),
        "best_for": str(template.get("best_for", "")),
        "description": str(template.get("description", "")),
    }


def _resolve_template_id(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    normalized = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    if normalized in TEMPLATES:
        return normalized
    for template_id, template in TEMPLATES.items():
        candidates = {
            template_id,
            re.sub(r"[^a-z0-9]+", "_", str(template.get("name", "")).lower()).strip(
                "_"
            ),
        }
        if normalized in candidates:
            return template_id
    return None


def _match_deck_archetypes(brief: str, limit: int = 3) -> list[dict[str, Any]]:
    text = str(brief or "").lower()
    scored: list[tuple[int, str, dict[str, Any]]] = []
    for archetype_id, archetype in DECK_ARCHETYPES.items():
        score = sum(1 for signal in archetype.get("signals", []) if signal in text)
        if score:
            scored.append((score, archetype_id, archetype))
    if not scored:
        fallback = DECK_ARCHETYPES["strategy_memo"]
        scored = [
            (0, "strategy_memo", fallback),
            (0, "lesson_training", DECK_ARCHETYPES["lesson_training"]),
        ]
    scored.sort(key=lambda item: item[0], reverse=True)
    return [
        {
            "id": archetype_id,
            "name": archetype["name"],
            "purpose": archetype["purpose"],
            "audience": archetype["audience"],
            "recommended_templates": archetype["recommended_templates"],
            "voice": archetype["voice"],
            "slide_plan": archetype["slide_plan"],
            "structure": archetype["structure"],
            "match_score": score,
        }
        for score, archetype_id, archetype in scored[:limit]
    ]


def _brief_dimensions(
    brief: str,
    selected_template: str | None,
    source_count: int,
    has_brand_reference: bool,
) -> dict[str, Any]:
    text = str(brief or "").lower()
    has_length = bool(re.search(r"\b(\d+)\s*(slides?|pages?)\b", text))
    has_audience = bool(
        re.search(
            r"\b(for|to)\s+(investors?|board|executives?|students?|learners?|customers?|clients?|developers?|team|leadership)\b",
            text,
        )
    )
    has_purpose = any(
        word in text
        for word in [
            "pitch",
            "teach",
            "explain",
            "update",
            "proposal",
            "strategy",
            "sell",
            "persuade",
            "inform",
            "training",
            "demo",
        ]
    )
    has_source = source_count > 0 or any(
        word in text
        for word in [
            "from these notes",
            "attached",
            "uploaded",
            "using this document",
            "use the pdf",
            "use this ppt",
        ]
    )
    has_visual_reference = (
        bool(selected_template)
        or has_brand_reference
        or any(
            word in text
            for word in ["template", "brand", "logo", "designer", "style", "reference"]
        )
    )
    missing = []
    if not has_audience:
        missing.append("audience")
    if not has_purpose:
        missing.append("purpose")
    if not has_length:
        missing.append("length")
    if not has_source:
        missing.append("content source")
    if not has_visual_reference:
        missing.append("visual reference")
    return {
        "has_audience": has_audience,
        "has_purpose": has_purpose,
        "has_length": has_length,
        "has_source": has_source,
        "has_visual_reference": has_visual_reference,
        "missing": missing,
        "should_ask_once": bool(missing),
    }


def _safe_slug(value: str, fallback: str = "presentation") -> str:
    text = re.sub(r"[^a-zA-Z0-9._-]+", "-", str(value or "").strip().lower())
    text = re.sub(r"-+", "-", text).strip("-._")
    return (text or fallback)[:80]


def _parse_jsonish(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return fallback
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return fallback
    return fallback


def _parse_slides_input(value: Any) -> tuple[list[Any] | None, str | None]:
    if isinstance(value, list):
        return value, None
    if value is None:
        return [], None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return [], None
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            return None, (
                "slides must be a JSON array when passed as a string. "
                f"JSON parse error: {exc}. Use create_presentation_from_brief for normal decks, "
                "or pass slides as a real list of objects instead of a long JSON string."
            )
        if not isinstance(parsed, list):
            return None, "slides JSON must decode to a list of slide objects."
        return parsed, None
    return None, "slides must be a list of slide dictionaries or a JSON array string."


def _bounded_slide_count(value: Any, default: int = 5) -> int:
    count = default if value is None else value
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 30:
        raise ValueError("slide count must be an integer from 1 to 30.")
    return count


def _validate_slide_payloads(
    slides: list[Any], *, allow_html: bool = True
) -> str | None:
    if len(slides) > 30:
        return "Too many slides in one call. Maximum is 30; use a shorter deck or staged generation."
    for index, slide in enumerate(slides):
        if not isinstance(slide, (dict, str)):
            return f"Slide {index + 1} must be an object or string, got {type(slide).__name__}."
        if isinstance(slide, dict):
            html = slide.get("html") or slide.get("contract_html")
            if html and not allow_html:
                return f"Slide {index + 1} contains HTML, but this tool call does not allow custom HTML."
            if html and len(str(html)) > 60000:
                return f"Slide {index + 1} HTML is too large. Keep contract HTML under 60,000 characters per slide."
            if slide.get("type") == "html" and not html:
                return f"Slide {index + 1} has type='html' but no html or contract_html field."
    return None


def _normalize_slide(slide: Any, index: int, topic: str) -> dict[str, Any]:
    if isinstance(slide, str):
        return {"type": "content", "title": f"Slide {index + 1}", "content": slide}
    if not isinstance(slide, dict):
        return {"type": "content", "title": f"Slide {index + 1}", "content": str(slide)}

    normalized = dict(slide)
    normalized.setdefault("type", "title" if index == 0 else "content")
    normalized.setdefault("title", topic if index == 0 else f"Slide {index + 1}")
    return normalized


class PresentationTools(Toolkit):
    """
    Native PowerPoint generator for Aetheria's presentation sub-agent.
    Uses an HTML/object-spec harness for deterministic previews and validation,
    then exports editable native .pptx files with pptxgenjs.
    """

    def __init__(
        self,
        *,
        user_id: str | None,
        session_id: str | None,
        message_id: str | None,
        socketio=None,
        sid: str | None = None,
    ):
        super().__init__(
            name="presentation_tools",
            tools=[
                self.get_presentation_toolkit,
                self.create_presentation_from_outline,
                self.validate_presentation,
                self.add_presentation_slides,
                self.replace_presentation_slide,
                self.create_presentation,
                self.start_presentation_draft,
                self.finalize_presentation_draft,
                self.list_presentation_templates,
                self.edit_presentation_text,
            ],
        )
        self.user_id = user_id
        self.session_id = session_id
        self.message_id = message_id
        self.socketio = socketio
        self.sid = sid
        self._presentation_drafts: dict[str, dict[str, Any]] = {}
        self.backend_dir = Path(__file__).resolve().parent
        self.repo_root = self.backend_dir.parent
        self.renderer_path = self._resolve_renderer_path()

    def _resolve_renderer_path(self) -> Path:
        configured = os.getenv("PPTX_RENDERER_PATH")
        candidates = [
            Path(configured) if configured else None,
            self.backend_dir / "ppt_harness_renderer.js",
            self.backend_dir / "pptx-renderer.js",
            self.backend_dir / "js" / "pptx-renderer.js",
            self.repo_root / "js" / "pptx-renderer.js",
        ]
        for candidate in candidates:
            if candidate and candidate.exists():
                return candidate
        return self.backend_dir / "pptx-renderer.js"

    def get_presentation_toolkit(self) -> dict[str, Any]:
        """Get the compact layout/outline reference once, only when needed."""
        return {
            "ok": True,
            "layouts": LAYOUTS,
            "outline_format": "## [layout] Slide title\nsubtitle: optional text\n- short point\n- short point\n"
            "Use named fields from layouts. Lists/objects such as chart, table, steps, metrics use single-line JSON.",
            "workflow": "One create_presentation_from_outline call, or create_presentation with compact objects. "
            "For drafts, batch with add_presentation_slides; replace only faulty slides. Never invent evidence.",
            "limits": "1..30 slides, titles <=100 chars, <=4 points each <=150 chars. Notes opt-in. "
            "Numbers require source or illustrative label. Visual checks run automatically.",
        }

    def create_presentation_from_outline(
        self,
        topic: str,
        outline: str,
        template: str = "aetheria_modern",
        filename: str | None = None,
        expected_slide_count: int | None = None,
    ) -> dict[str, Any]:
        """Create a deck in one call from ## [layout] Title sections, - points, and named fields.

        Use chart/table/steps/metrics fields as single-line JSON. No HTML or geometry needed.
        Supply finished, source-backed content; this tool does not research or invent facts.
        """
        try:
            slides = parse_outline(outline)
        except (ValueError, TypeError, AttributeError) as exc:
            return self._error(str(exc))
        if expected_slide_count is not None and len(slides) != expected_slide_count:
            return self._error(
                f"Expected {expected_slide_count} slides, outline contains {len(slides)}."
            )
        if expected_slide_count is not None:
            try:
                _bounded_slide_count(expected_slide_count)
            except ValueError as exc:
                return self._error(str(exc))
        return self.create_presentation(topic, slides, template, filename)

    def validate_presentation(
        self,
        topic: str,
        slides: Any,
        template: str = "aetheria_modern",
    ) -> dict[str, Any]:
        """Check content and layout before export. Returns only actionable diagnostics."""
        slide_list, error = _parse_slides_input(slides)
        if error or not slide_list:
            return self._error(error or "Supply a non-empty slide list.")
        error = _validate_slide_payloads(slide_list)
        if error:
            return self._error(error)
        normalized = [
            _normalize_slide(slide, i, topic) for i, slide in enumerate(slide_list)
        ]
        issues = content_issues(normalized)
        if any(item["severity"] == "error" for item in issues):
            return {"ok": False, "issues": issues}
        template_id = _resolve_template_id(template)
        if not template_id:
            return self._error("Unknown presentation template.")
        node = shutil.which("node")
        if not node:
            return self._error("Node.js is required for layout validation.")
        with tempfile.TemporaryDirectory(prefix="ppt-lint-") as directory:
            payload = Path(directory) / "payload.json"
            payload.write_text(
                json.dumps(
                    {"topic": topic, "slides": normalized, "template": template_id}
                ),
                encoding="utf-8",
            )
            completed = subprocess.run(
                [node, str(self.renderer_path), "--lint", str(payload)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=30,
                check=False,
            )
            result = _parse_jsonish(completed.stdout, {})
        validation = result.get("layout_validation", {})
        return {
            "ok": bool(result.get("ok")),
            "issues": issues,
            "error": result.get("error"),
            "layout_issues": [
                dict(slide=audit["slide_index"], **warning)
                for audit in validation.get("audits", [])
                for warning in audit["warnings"]
            ],
            "scope": "Content and estimated geometry; browser checks run during export.",
        }

    def add_presentation_slides(self, draft_id: str, slides: Any) -> dict[str, Any]:
        """Append a compact batch to a draft, validating the whole batch before mutation."""
        draft = self._presentation_drafts.get(draft_id)
        if draft is None:
            return self._error("Unknown draft_id.")
        parsed, error = _parse_slides_input(slides)
        if error or not parsed:
            return self._error(error or "Supply a non-empty batch.")
        error = _validate_slide_payloads(parsed)
        if error:
            return self._error(error)
        if len(draft["slides"]) + len(parsed) > draft["expected_slide_count"]:
            return self._error("Batch exceeds the draft's expected slide count.")
        normalized = [
            _normalize_slide(slide, len(draft["slides"]) + i, draft["topic"])
            for i, slide in enumerate(parsed)
        ]
        issues = content_issues(normalized)
        if any(item["severity"] == "error" for item in issues):
            return {"ok": False, "issues": issues}
        draft["slides"].extend(normalized)
        return {
            "ok": True,
            "draft_id": draft_id,
            "slide_count": len(draft["slides"]),
            "remaining": draft["expected_slide_count"] - len(draft["slides"]),
        }

    def replace_presentation_slide(
        self, draft_id: str, slide_number: int, slide: Any
    ) -> dict[str, Any]:
        """Replace one draft slide after validation; slide_number is one-based."""
        draft = self._presentation_drafts.get(draft_id)
        if (
            not draft
            or isinstance(slide_number, bool)
            or not isinstance(slide_number, int)
            or not 1 <= slide_number <= len(draft["slides"])
        ):
            return self._error(
                "Supply an existing draft and a valid one-based slide_number."
            )
        parsed = _parse_jsonish(slide, None)
        if not isinstance(parsed, dict):
            return self._error("slide must be an object.")
        normalized = _normalize_slide(parsed, slide_number - 1, draft["topic"])
        error = _validate_slide_payloads([normalized])
        if error:
            return self._error(error)
        issues = content_issues([normalized])
        if any(item["severity"] == "error" for item in issues):
            return {"ok": False, "issues": issues}
        draft["slides"][slide_number - 1] = normalized
        return {"ok": True, "draft_id": draft_id, "slide_number": slide_number}

    def list_presentation_templates(self) -> dict[str, Any]:
        """List available native PowerPoint templates using compact summaries."""
        templates = [_template_summary(key, value) for key, value in TEMPLATES.items()]
        return {
            "ok": True,
            "message": (
                "Available native PowerPoint templates. This is a compact list; "
                "call get_presentation_template_details(template_id) for layout and design details."
            ),
            "data": {"templates": templates},
            "metadata": {
                "kind": "presentation_tool_output",
                "action": "list_templates",
                "preview_type": "presentation_templates",
                "title": "Presentation templates",
                "inline": {"templates": templates},
            },
        }

    def analyze_presentation_brief(
        self,
        brief: str,
        source_count: int = 0,
        has_brand_reference: bool = False,
        selected_template: str | None = None,
    ) -> dict[str, Any]:
        """
        Analyze a presentation request before generation.

        Args:
            brief: User request or working brief.
            source_count: Count of uploaded/available source files already known to the agent.
            has_brand_reference: True when a logo, brand kit, reference deck, or visual sample is available.
            selected_template: Template id if the user already picked one.
        """
        template_id = (
            _resolve_template_id(selected_template) if selected_template else None
        )
        dimensions = _brief_dimensions(
            brief=brief,
            selected_template=template_id,
            source_count=int(source_count or 0),
            has_brand_reference=bool(has_brand_reference),
        )
        archetypes = _match_deck_archetypes(brief)
        recommended_templates: list[dict[str, str]] = []
        seen = set()
        for archetype in archetypes:
            for candidate_id in archetype["recommended_templates"]:
                if candidate_id in seen or candidate_id not in TEMPLATES:
                    continue
                seen.add(candidate_id)
                recommended_templates.append(
                    _template_summary(candidate_id, TEMPLATES[candidate_id])
                )
        if template_id and template_id not in seen:
            recommended_templates.insert(
                0, _template_summary(template_id, TEMPLATES[template_id])
            )

        question_prompts = {
            "audience": "Who is this deck for?",
            "purpose": "What should the deck do?",
            "length": "How many slides should it be?",
            "content source": "Should I use your materials, web research, or both?",
            "visual reference": "Should I use a selected template, your brand/reference deck, or designer's pick?",
        }
        return {
            "ok": True,
            "message": "Presentation brief analyzed.",
            "data": {
                "dimensions": dimensions,
                "matched_archetypes": archetypes,
                "recommended_templates": recommended_templates[:5],
                "single_clarification_form": [
                    question_prompts[item]
                    for item in dimensions["missing"]
                    if item in question_prompts
                ][:5],
                "generation_guidance": {
                    "ask_at_most_once": True,
                    "skip_questions_when_dimensions_are_covered": True,
                    "default_template": template_id
                    or (
                        recommended_templates[0]["id"]
                        if recommended_templates
                        else "aetheria_modern"
                    ),
                    "default_archetype": archetypes[0]["id"]
                    if archetypes
                    else "strategy_memo",
                },
            },
            "metadata": {
                "kind": "presentation_tool_output",
                "action": "analyze_brief",
                "preview_type": "text",
                "title": "Presentation brief analysis",
                "inline": {
                    "missing": dimensions["missing"],
                    "recommended_templates": recommended_templates[:3],
                    "matched_archetypes": archetypes[:3],
                },
            },
        }

    def lint_presentation_html_contract(
        self,
        topic: str,
        slides: Any,
        template: str = "aetheria_modern",
    ) -> dict[str, Any]:
        """
        Validate AI-authored contract HTML before PPTX generation.

        Each slide may include html or contract_html. The HTML must use one
        .slide-container at 1920x1080 and flat direct children with
        data-object='true', data-object-type, and absolute inline left/top/width/height.
        """
        try:
            slide_list, slide_error = _parse_slides_input(slides)
            if slide_error:
                return self._error(slide_error)
            if not slide_list:
                return self._error(
                    "slides must be a non-empty list of slide dictionaries. Use create_presentation_from_brief for normal decks."
                )
            slide_payload_error = _validate_slide_payloads(slide_list, allow_html=True)
            if slide_payload_error:
                return self._error(slide_payload_error)

            template_id = _resolve_template_id(template)
            if not template_id:
                return self._error(
                    f"Unknown presentation template '{template}'. "
                    f"Available template ids: {', '.join(TEMPLATES.keys())}"
                )

            work_dir = Path(tempfile.mkdtemp(prefix="aetheria-ppt-lint-"))
            payload_path = work_dir / "payload.json"
            normalized_slides = [
                _normalize_slide(slide, index, str(topic or "Presentation"))
                for index, slide in enumerate(slide_list)
            ]
            payload = {
                "topic": str(topic or "Presentation").strip(),
                "slides": normalized_slides,
                "template": template_id,
            }
            payload_path.write_text(
                json.dumps(payload, ensure_ascii=False), encoding="utf-8"
            )

            node = shutil.which("node") or shutil.which("node.exe")
            if not node:
                return self._error(
                    "Node.js was not found; HTML contract linting requires Node.js."
                )
            if not self.renderer_path.exists():
                return self._error(
                    f"PowerPoint renderer not found at {self.renderer_path}"
                )

            completed = subprocess.run(
                [node, str(self.renderer_path), "--lint", str(payload_path)],
                cwd=str(self.backend_dir),
                capture_output=True,
                check=False,
                text=True,
                timeout=60,
            )
            renderer_stdout = (completed.stdout or "").strip()
            renderer_result = _parse_jsonish(renderer_stdout, {})
            if completed.returncode != 0 or not renderer_result:
                logger.error(
                    "PPT HTML lint failed rc=%s stdout=%s stderr=%s",
                    completed.returncode,
                    renderer_stdout[:2000],
                    (completed.stderr or "")[:2000],
                )
                return self._error(
                    (completed.stderr or "HTML contract lint failed").strip()
                )

            validation = renderer_result.get("layout_validation") or {}
            warning_count = int(validation.get("warning_count") or 0)
            return {
                "ok": bool(renderer_result.get("ok")),
                "message": (
                    "Contract HTML is valid."
                    if renderer_result.get("ok")
                    else f"Contract HTML has {warning_count} issue(s) to fix before export."
                ),
                "data": renderer_result,
                "metadata": {
                    "kind": "presentation_tool_output",
                    "action": "lint_html_contract",
                    "preview_type": "text",
                    "title": "Presentation HTML contract lint",
                    "inline": {
                        "ok": bool(renderer_result.get("ok")),
                        "warning_count": warning_count,
                        "slides": renderer_result.get("slides") or [],
                    },
                },
            }
        except Exception as exc:
            logger.exception("lint_presentation_html_contract failed")
            return self._error(str(exc))

    def get_presentation_template_details(self, template_id: str) -> dict[str, Any]:
        """Return detailed layout and design guidance for one presentation template."""
        resolved_id = _resolve_template_id(template_id)
        if not resolved_id:
            return self._error(
                f"Unknown presentation template '{template_id}'. "
                f"Available template ids: {', '.join(TEMPLATES.keys())}"
            )

        template = TEMPLATES[resolved_id]
        return {
            "ok": True,
            "message": f"Template details for {template.get('name', resolved_id)}.",
            "data": {
                "id": resolved_id,
                **template,
            },
            "metadata": {
                "kind": "presentation_tool_output",
                "action": "template_details",
                "preview_type": "text",
                "title": f"Template details: {template.get('name', resolved_id)}",
                "inline": {
                    "id": resolved_id,
                    "name": template.get("name", resolved_id),
                    "best_for": template.get("best_for", ""),
                    "description": template.get("description", ""),
                },
            },
        }

    def start_presentation_draft(
        self,
        topic: str,
        template: str = "aetheria_modern",
        filename: str | None = None,
        expected_slide_count: int = 5,
        brief: str = "",
        archetype: str | None = None,
    ) -> dict[str, Any]:
        """Start a draft for incremental work. Prefer add_presentation_slides batches."""
        try:
            if not topic or not str(topic).strip():
                return self._error("topic is required")
            template_id = _resolve_template_id(template)
            if not template_id:
                return self._error(
                    f"Unknown presentation template '{template}'. "
                    f"Available template ids: {', '.join(TEMPLATES.keys())}"
                )
            count = _bounded_slide_count(expected_slide_count, default=5)
            draft_id = str(uuid.uuid4())
            self._presentation_drafts[draft_id] = {
                "topic": str(topic).strip(),
                "template": template_id,
                "filename": filename,
                "expected_slide_count": count,
                "brief": str(brief or ""),
                "archetype": archetype,
                "slides": [],
            }
            return {
                "ok": True,
                "message": f"Started presentation draft {draft_id}. Add {count} slides in batches, then finalize.",
                "data": {
                    "draft_id": draft_id,
                    "topic": str(topic).strip(),
                    "template": template_id,
                    "expected_slide_count": count,
                    "next_step": "Call add_presentation_slides with a compact batch.",
                },
                "metadata": {
                    "kind": "presentation_tool_output",
                    "action": "start_draft",
                    "preview_type": "text",
                    "title": "Presentation draft started",
                    "inline": {
                        "draft_id": draft_id,
                        "expected_slide_count": count,
                        "slide_count": 0,
                    },
                },
            }
        except Exception as exc:
            logger.exception("start_presentation_draft failed")
            return self._error(str(exc))

    def add_presentation_slide(
        self,
        draft_id: str,
        slide: Any,
    ) -> dict[str, Any]:
        """Add one slide to a draft. Prefer add_presentation_slides for multiple slides."""
        try:
            draft = self._presentation_drafts.get(str(draft_id or ""))
            if not draft:
                return self._error(
                    "Unknown draft_id. Start a new draft with start_presentation_draft."
                )
            parsed = _parse_jsonish(slide, None)
            if parsed is None:
                return self._error(
                    "slide must be one slide object. Do not pass the whole deck or an invalid JSON string."
                )
            if isinstance(parsed, list):
                return self._error(
                    "add_presentation_slide accepts exactly one slide object, not a list. Call it once per slide."
                )
            slide_error = _validate_slide_payloads([parsed], allow_html=True)
            if slide_error:
                return self._error(slide_error)
            if len(draft["slides"]) >= int(draft["expected_slide_count"]):
                return self._error(
                    "Draft already has the expected number of slides. Call finalize_presentation_draft or start a new draft."
                )
            normalized = _normalize_slide(parsed, len(draft["slides"]), draft["topic"])
            issues = content_issues([normalized])
            if any(item["severity"] == "error" for item in issues):
                return {"ok": False, "issues": issues}
            draft["slides"].append(normalized)
            remaining = int(draft["expected_slide_count"]) - len(draft["slides"])
            return {
                "ok": True,
                "message": f"Added slide {len(draft['slides'])}/{draft['expected_slide_count']}."
                + (" Add the next slide." if remaining else " Ready to finalize."),
                "data": {
                    "draft_id": draft_id,
                    "slide_count": len(draft["slides"]),
                    "expected_slide_count": draft["expected_slide_count"],
                    "remaining": remaining,
                    "next_step": "Call finalize_presentation_draft."
                    if remaining == 0
                    else "Call add_presentation_slide with the next single slide.",
                },
                "metadata": {
                    "kind": "presentation_tool_output",
                    "action": "add_slide",
                    "preview_type": "text",
                    "title": "Presentation slide added",
                    "inline": {
                        "draft_id": draft_id,
                        "slide_count": len(draft["slides"]),
                        "remaining": remaining,
                    },
                },
            }
        except Exception as exc:
            logger.exception("add_presentation_slide failed")
            return self._error(str(exc))

    def finalize_presentation_draft(
        self,
        draft_id: str,
    ) -> dict[str, Any]:
        """Finalize a staged presentation draft into an editable PPTX."""
        try:
            draft = self._presentation_drafts.get(str(draft_id or ""))
            if not draft:
                return self._error(
                    "Unknown draft_id. Start a new draft with start_presentation_draft."
                )
            if not draft["slides"]:
                return self._error(
                    "Draft has no slides. Add slides one at a time before finalizing."
                )
            if len(draft["slides"]) < int(draft["expected_slide_count"]):
                return self._error(
                    f"Draft has {len(draft['slides'])}/{draft['expected_slide_count']} slides. "
                    "Continue adding one slide at a time, or start a new draft with a lower expected_slide_count."
                )
            result = self.create_presentation(
                topic=draft["topic"],
                slides=draft["slides"],
                template=draft["template"],
                filename=draft.get("filename"),
            )
            if result.get("ok"):
                self._presentation_drafts.pop(str(draft_id), None)
                result.setdefault("data", {})["draft_id"] = draft_id
                result.setdefault("metadata", {}).setdefault("inline", {})[
                    "draft_id"
                ] = draft_id
            return result
        except Exception as exc:
            logger.exception("finalize_presentation_draft failed")
            return self._error(str(exc))

    def create_presentation_from_brief(
        self,
        topic: str,
        brief: str,
        slide_count: int = 5,
        template: str = "aetheria_modern",
        filename: str | None = None,
        archetype: str | None = None,
    ) -> dict[str, Any]:
        """
        Create from a finished slide outline. A topic alone cannot supply evidence.
        Brief must use ## [layout] Title sections. Prefer create_presentation_from_outline.
        """
        try:
            if not topic or not str(topic).strip():
                return self._error("topic is required")
            template_id = _resolve_template_id(template)
            if not template_id:
                return self._error(
                    f"Unknown presentation template '{template}'. "
                    f"Available template ids: {', '.join(TEMPLATES.keys())}"
                )
            return self.create_presentation_from_outline(
                topic, brief, template_id, filename, slide_count
            )
        except Exception as exc:
            logger.exception("create_presentation_from_brief failed")
            return self._error(str(exc))

    def create_presentation(
        self,
        topic: str,
        slides: Any,
        template: str = "aetheria_modern",
        filename: str | None = None,
    ) -> dict[str, Any]:
        """
        Create a native editable .pptx from structured slide definitions.

        Args:
            topic: Presentation title or topic.
            slides: List of slide dictionaries, or a JSON string. Supported slide
                types include title/cover, content, two_column/comparison, chart,
                table, diagram/process, image/visual. Slides should include
                structured fields whenever possible: bullets/content, left/right
                comparison content, metrics, chart.data, table rows, nodes/steps,
                callout, notes, captions, visual_summary, or image_path.
            template: One of venture_blueprint, aetheria_modern, executive, startup_pitch, academic, creative_portfolio, minimal_zen, tech_dark, corporate_gradient.
            filename: Optional output filename ending in .pptx.
        """
        try:
            if not topic or not str(topic).strip():
                return self._error("topic is required")

            slide_list, slide_error = _parse_slides_input(slides)
            if slide_error:
                return self._error(slide_error)
            if not slide_list:
                return self._error(
                    "slides is empty. Use create_presentation_from_brief for normal decks, or pass a non-empty list of slide dictionaries."
                )
            slide_payload_error = _validate_slide_payloads(slide_list, allow_html=True)
            if slide_payload_error:
                return self._error(slide_payload_error)

            template_id = _resolve_template_id(template)
            if not template_id:
                return self._error(
                    f"Unknown presentation template '{template}'. "
                    f"Available template ids: {', '.join(TEMPLATES.keys())}"
                )
            safe_name = _safe_slug(filename or topic)
            if not safe_name.endswith(".pptx"):
                safe_name = f"{safe_name}.pptx"

            normalized_slides = [
                _normalize_slide(slide, index, str(topic))
                for index, slide in enumerate(slide_list)
            ]

            issues = content_issues(normalized_slides)
            if any(item["severity"] == "error" for item in issues):
                return {
                    "ok": False,
                    "error": "Fix content issues before export.",
                    "issues": issues,
                }

            work_dir = Path(tempfile.mkdtemp(prefix="aetheria-ppt-"))
            output_path = work_dir / safe_name
            payload_path = work_dir / "payload.json"

            payload = {
                "topic": str(topic).strip(),
                "slides": normalized_slides,
                "template": template_id,
                "output_path": str(output_path),
            }
            payload_path.write_text(
                json.dumps(payload, ensure_ascii=False), encoding="utf-8"
            )

            node = shutil.which("node") or shutil.which("node.exe")
            if not node:
                return self._error(
                    "Node.js was not found; presentation rendering requires Node.js and pptxgenjs."
                )
            if not self.renderer_path.exists():
                return self._error(
                    f"PowerPoint renderer not found at {self.renderer_path}"
                )

            completed = subprocess.run(
                [node, str(self.renderer_path), str(payload_path)],
                cwd=str(self.backend_dir),
                capture_output=True,
                check=False,
                text=True,
                encoding="utf-8",
                timeout=120,
            )
            renderer_stdout = (completed.stdout or "").strip()
            renderer_result = _parse_jsonish(renderer_stdout, {})
            if completed.returncode != 0 or not renderer_result.get("ok"):
                logger.error(
                    "PPT renderer failed rc=%s stdout=%s stderr=%s",
                    completed.returncode,
                    renderer_stdout[:2000],
                    (completed.stderr or "")[:2000],
                )
                result = self._error(
                    renderer_result.get("error")
                    or (completed.stderr or "PowerPoint renderer failed").strip()
                )
                result["issues"] = [
                    dict(slide=audit["slide_index"], **warning)
                    for key in ("layout_validation", "screenshot_validation")
                    for audit in renderer_result.get(key, {}).get("audits", [])
                    for warning in audit.get("warnings", [])
                ]
                return result

            pptx_bytes = output_path.read_bytes()
            artifact_id = self._persist_pptx(
                file_path=str(output_path),
                filename=safe_name,
                file_content=pptx_bytes,
            )
            download_url = None
            if artifact_id and self.user_id:
                try:
                    download_url = get_persistence_service().get_artifact_download_url(
                        artifact_id=artifact_id,
                        user_id=str(self.user_id),
                        expiry=3600,
                    )
                except Exception as exc:  # noqa: BLE001 - storage is optional; log provider errors.
                    logger.warning(
                        "Unable to generate presentation download URL: %s", exc
                    )

            metadata = {
                "kind": "presentation_tool_output",
                "action": "create_presentation",
                "preview_type": "presentation",
                "output_id": artifact_id or str(uuid.uuid4()),
                "artifact_id": artifact_id,
                "title": str(topic).strip(),
                "summary": f"Created {len(normalized_slides)}-slide editable PowerPoint deck with the HTML verification harness.",
                "filename": safe_name,
                "mime_type": PPTX_MIME_TYPE,
                "download_url": download_url,
                "template": renderer_result.get("template"),
                "layout_validation": renderer_result.get("layout_validation"),
                "harness": renderer_result.get("harness"),
                "inline": {
                    "topic": str(topic).strip(),
                    "slide_count": len(normalized_slides),
                    "size_bytes": len(pptx_bytes),
                    "slides": renderer_result.get("slides") or [],
                },
            }
            self._emit_presentation_created(metadata)
            # Full thumbnails stay in the socket event. They never enter model context.
            compact_metadata = {
                "kind": metadata["kind"],
                "action": metadata["action"],
                "preview_type": "presentation",
                "title": metadata["title"],
                "filename": safe_name,
                "artifact_id": artifact_id,
                "output_id": metadata["output_id"],
                "mime_type": PPTX_MIME_TYPE,
                "download_url": download_url,
                "template": renderer_result.get("template"),
                "inline": {
                    "topic": str(topic).strip(),
                    "slide_count": len(normalized_slides),
                    "size_bytes": len(pptx_bytes),
                    "slides": [
                        {"index": i + 1, "type": slide["type"], "title": slide["title"]}
                        for i, slide in enumerate(normalized_slides)
                    ],
                },
            }
            quality = {
                "status": renderer_result.get("harness", {}).get(
                    "status", "unverified"
                ),
                "layout_ok": renderer_result.get("layout_validation", {}).get("ok"),
                "browser_ok": renderer_result.get("harness", {})
                .get("screenshot_validation", {})
                .get("ok"),
                "warning": renderer_result.get("harness", {})
                .get("screenshot_validation", {})
                .get("warning"),
                "issues": issues
                + [
                    dict(slide=audit["slide_index"], **warning)
                    for audit in renderer_result.get("layout_validation", {}).get(
                        "audits", []
                    )
                    for warning in audit.get("warnings", [])
                ],
                "scope": renderer_result.get("harness", {}).get("verification_scope"),
                "preview_manifest": renderer_result.get("harness", {}).get(
                    "manifest_path"
                ),
            }
            return {
                "ok": True,
                "message": (
                    f"Created native editable PowerPoint '{safe_name}' "
                    f"with {len(normalized_slides)} slides."
                ),
                "data": {
                    "artifact_id": artifact_id,
                    "filename": safe_name,
                    "download_url": download_url,
                    "local_path": str(output_path),
                    "mime_type": PPTX_MIME_TYPE,
                    "slide_count": len(normalized_slides),
                },
                "quality": quality,
                "metadata": compact_metadata,
            }
        except Exception as exc:
            logger.exception("create_presentation failed")
            return self._error(str(exc))

    def edit_presentation_text(
        self,
        file_path: str,
        replacements: Any,
        output_filename: str | None = None,
    ) -> dict[str, Any]:
        """
        Edit text in an existing PowerPoint using python-pptx.

        Args:
            file_path: Local path to an existing .pptx.
            replacements: Dict or JSON string mapping old text to new text.
            output_filename: Optional filename for the edited deck.
        """
        try:
            from pptx import Presentation
        except ImportError:
            return self._error(
                "python-pptx is not installed; add python-pptx to requirements."
            )

        try:
            source = Path(file_path)
            if not source.exists():
                return self._error(f"Presentation not found: {file_path}")

            mapping = _parse_jsonish(replacements, {})
            if not isinstance(mapping, dict) or not mapping:
                return self._error(
                    "replacements must be a non-empty dict or JSON object"
                )

            prs = Presentation(str(source))
            changed = 0
            for slide in prs.slides:
                for shape in slide.shapes:
                    if not getattr(shape, "has_text_frame", False):
                        continue
                    for paragraph in shape.text_frame.paragraphs:
                        for run in paragraph.runs:
                            updated = run.text
                            for old, new in mapping.items():
                                if str(old) in updated:
                                    updated = updated.replace(str(old), str(new))
                            if updated != run.text:
                                run.text = updated
                                changed += 1

            safe_name = _safe_slug(output_filename or f"{source.stem}-edited")
            if not safe_name.endswith(".pptx"):
                safe_name = f"{safe_name}.pptx"
            output_path = source.parent / safe_name
            prs.save(str(output_path))

            artifact_id = self._persist_pptx(
                file_path=str(output_path),
                filename=safe_name,
                file_content=output_path.read_bytes(),
            )
            download_url = None
            if artifact_id and self.user_id:
                download_url = get_persistence_service().get_artifact_download_url(
                    artifact_id=artifact_id,
                    user_id=str(self.user_id),
                    expiry=3600,
                )

            return {
                "ok": True,
                "message": f"Edited {changed} text run(s) and saved '{safe_name}'.",
                "quality": {
                    "status": "unverified",
                    "warning": "Text edits preserve formatting but need a visual review for wrapping.",
                },
                "data": {
                    "artifact_id": artifact_id,
                    "filename": safe_name,
                    "download_url": download_url,
                    "local_path": str(output_path),
                    "changed_runs": changed,
                },
                "metadata": {
                    "kind": "presentation_tool_output",
                    "action": "edit_presentation_text",
                    "preview_type": "presentation",
                    "output_id": artifact_id or str(uuid.uuid4()),
                    "artifact_id": artifact_id,
                    "title": safe_name,
                    "summary": f"Edited {changed} text run(s) in a native PowerPoint file.",
                    "filename": safe_name,
                    "mime_type": PPTX_MIME_TYPE,
                    "download_url": download_url,
                    "inline": {
                        "topic": safe_name,
                        "slide_count": len(prs.slides),
                        "slides": [
                            {"index": i + 1, "title": self._first_slide_text(slide)}
                            for i, slide in enumerate(prs.slides)
                        ],
                    },
                },
            }
        except Exception as exc:
            logger.exception("edit_presentation_text failed")
            return self._error(str(exc))

    def _first_slide_text(self, slide: Any) -> str:
        for shape in slide.shapes:
            if getattr(shape, "has_text_frame", False) and shape.text:
                return str(shape.text).strip().splitlines()[0][:120]
        return "Slide"

    def _persist_pptx(
        self, *, file_path: str, filename: str, file_content: bytes
    ) -> str | None:
        if not (self.user_id and self.session_id):
            return None
        try:
            persistence = get_persistence_service()
            execution_id = persistence.create_execution_record(
                user_id=str(self.user_id),
                session_id=str(self.session_id),
                sandbox_id="presentation-tools",
                command=f"create_presentation {filename}",
                message_id=self.message_id,
            )
            if not execution_id:
                logger.warning(
                    "Could not create execution record for presentation artifact"
                )
                return None

            artifact_id = persistence.create_artifact(
                execution_id=execution_id,
                user_id=str(self.user_id),
                session_id=str(self.session_id),
                sandbox_id="presentation-tools",
                file_path=file_path,
                file_content=file_content,
                mime_type=mimetypes.guess_type(filename)[0] or PPTX_MIME_TYPE,
                message_id=self.message_id,
            )
            try:
                persistence.db.table("sandbox_executions").update(
                    {
                        "status": "COMPLETED" if artifact_id else "FAILED",
                        "exit_code": 0 if artifact_id else 1,
                        "finished_at": datetime.now(UTC).isoformat(),
                    }
                ).eq("execution_id", execution_id).execute()
            except Exception as exc:  # noqa: BLE001 - storage finalization is optional.
                logger.warning(
                    "Failed to finalize presentation execution %s: %s",
                    execution_id,
                    exc,
                )
            return artifact_id
        except Exception as exc:
            logger.warning(
                "Failed to persist presentation artifact: %s", exc, exc_info=True
            )
            return None

    def _emit_presentation_created(self, metadata: dict[str, Any]) -> None:
        if not (self.socketio and self.session_id):
            return
        payload = {
            "id": self.message_id,
            "conversationId": self.session_id,
            "metadata": metadata,
            "agent_name": "presentation_agent",
        }
        try:
            self.socketio.emit(
                "presentation_generated", payload, room=f"conv:{self.session_id}"
            )
        except Exception as exc:  # noqa: BLE001 - a socket failure must not lose the artifact.
            logger.warning("Failed to emit presentation_generated: %s", exc)

    def _error(self, message: str) -> dict[str, Any]:
        return {
            "ok": False,
            "message": f"Presentation tool error: {message}",
            "error": message,
            "metadata": {
                "kind": "presentation_tool_output",
                "action": "error",
                "preview_type": "text",
                "title": "Presentation error",
                "summary": message,
                "inline": {"text_preview": message},
            },
        }


def build_presentation_agent(
    *,
    user_id: str | None,
    session_id: str | None,
    message_id: str | None,
    socketio=None,
    sid: str | None = None,
    debug_mode: bool = True,
) -> Agent:
    tools = [
        PresentationTools(
            user_id=user_id,
            session_id=session_id,
            message_id=message_id,
            socketio=socketio,
            sid=sid,
        )
    ]
    from openrouter_reasoning_model import get_openrouter_model

    return Agent(
        name="presentation_agent",
        model=get_openrouter_model("xiaomi/mimo-v2.5"),
        role=(
            "Native PowerPoint specialist. Plans concise decks and creates editable "
            ".pptx files using presentation_tools."
        ),
        tools=tools,
        instructions=[
            "<system_instructions>",
            "Build editable, audience-specific PowerPoint decks. Make each title a claim and each slide one idea. Use supplied sources; never invent statistics or placeholder evidence. Ask one concise clarification only if missing information prevents useful work, otherwise choose sensible defaults.",
            "Respect the selected template and exact requested slide count. Default to a cover, varied evidence/argument slides, then a decision or takeaway. Match layouts to content, not a repeating cycle. Avoid generic titles and repeated bullets. Notes only when requested.",
            "Default to ONE create_presentation_from_outline call for 5, 10, or 15 slides, or ONE create_presentation call with compact slide objects. Do not call a tool for every slide. Layout, typography, spacing, previews and validation are computed locally, without model calls. No HTML, coordinates, colors or redundant fields are needed.",
            "Outline syntax: ## [layout] Title then - points or field: value lines. Layouts: title, content, two_column, metrics, chart, table, diagram, image, section, closing. chart/table/steps/metrics/left_content/right_content use single-line JSON. Call get_presentation_toolkit once only if field details are needed. Call list_presentation_templates only if template fit is unclear.",
            "Use titles <=100 characters, 1-4 concise points <=150 characters, comparison panel titles and lists, metrics as value/label pairs, charts as {type:bar|column|line,data:[{label,value}]} with source, tables as equal rows, diagrams as 2-5 steps with optional detail. Image slides need an existing image_path; use a meaningful layout when no image exists.",
            "For incremental work use start_presentation_draft, add_presentation_slides in batches, replace_presentation_slide to repair only affected slides, and finalize_presentation_draft. Export performs content, geometry and browser checks. On failure fix reported slides; never describe a failed or unverified deck as ready to present. Browser checks cover shared layout objects, not native PowerPoint rendering.",
            "Return the downloadable editable artifact concisely. Inspect quality.status and report material warnings. Do not echo slide content, screenshot data, or the full tool response.",
            "</system_instructions>",
        ],
        debug_mode=debug_mode,
    )
