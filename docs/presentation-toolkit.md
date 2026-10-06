# Presentation toolkit

The October 6 update adds distinct template compositions, typography, actual picker previews, and a presentation image tool. See [the design and image verification report](presentation-designs.md) for the current behavior and live provider result.

The presentation agent now submits finished content in one compact call. Local code chooses the layout, draws editable PowerPoint objects, renders previews, and checks the result. It makes no model calls while rendering or validating.

The default layouts are cover, insight list, comparison, metrics, bar/column/line chart, table, process, image, section break, and closing. All nine existing template IDs remain available. Fonts, spacing, source lines, and page numbers are consistent across a deck. Decorative network graphics and repeated side panels were removed.

## Use the tools

`create_presentation_from_outline(topic, outline, template, expected_slide_count)` is the default. Each `## [layout] Title` starts a slide. Short `-` lines become points. Named fields carry supporting content. Lists and objects use single-line JSON. The exact slide count is checked when supplied.

```text
## [title] Approve a focused support pilot
subtitle: Operations review | October 2026

## [content] Fix the handoff before expanding automation
- Put incoming requests in a shared queue
- Give each handoff a named owner
callout: Start with one team and a bounded scope.

## [two_column] Make ownership visible
left_title: Today
left_content: ["Requests spread across inboxes","No clear owner at handoff"]
right_title: Pilot
right_content: ["One shared queue","A named owner for each request"]

## [diagram] Review the pilot through three gates
steps: [{"title":"Define","detail":"Choose the queue and owner."},{"title":"Review","detail":"Inspect service quality weekly."},{"title":"Decide","detail":"Expand when the evidence supports it."}]

## [closing] Appoint the pilot owner
- Choose one team
- Publish the review criteria
callout: Decision requested: approve the pilot scope.
```

`create_presentation` accepts compact slide objects when nested data is easier to express. `get_presentation_toolkit` returns the small field reference. `validate_presentation` checks content and estimated geometry before export. Export always performs the content, geometry, and available browser checks.

For incremental work, call `start_presentation_draft`, append with `add_presentation_slides`, replace an affected slide with `replace_presentation_slide`, then call `finalize_presentation_draft`. Batches validate before changing the draft. A failed export preserves the draft. There is no per-slide tool-call requirement.

The former brief fallback invented generic claims and numerical placeholders. It now requires a finished outline and returns a useful error for a topic-only brief. The agent supplies researched or user-provided content. It must label illustrative data and must not invent evidence.

## Quality checks

Content checks reject unsupported layouts, excessive points, malformed or uneven tables, missing images, non-finite chart values, invalid metrics, and incorrect slide counts. Layout checks reject invalid geometry, overlapping content, insufficient text capacity, and contrast below 4.5:1. Chromium checks actual text overflow and broken assets. Repairs are bounded, respect a body font floor, and trigger fresh validation and screenshots. A known failed check prevents export.

Preview point sizes now match the 1920 x 1080 canvas and 13.333 x 7.5-inch PowerPoint geometry. Arial and Times New Roman have metric-compatible Liberation fallbacks in the Linux container. Images preserve their aspect ratio with the same cover crop in both outputs.

`quality.status = verified` means the shared layout passed browser and geometry checks. It does **not** certify native PowerPoint rendering or factual accuracy. If Chromium is unavailable, the tool reports `unverified` and the reason. Text replacements in an existing file also report `unverified`, since new text can change wrapping.

Full screenshots go through the `presentation_generated` UI event. The model receives IDs, artifact location, compact slide summaries, and quality diagnostics. The viewer preserves screenshots whichever arrives first, the socket event or the compact tool response. Live thumbnails do not add image bytes to the model context. A reopened conversation can show compact fallback thumbnails if the live preview event is no longer available.

## Verification and measurements

The final run passed 40 Python tests, 3 JavaScript/browser tests, Ruff checks, JavaScript syntax checks, and `git diff --check`.

Run from the repository root:

```powershell
python -m pytest python-backend/tests/test_presentation_toolkit.py -q
node --test js/tests/presentation-metadata.test.mjs js/tests/presentation-browser.test.js
python -m ruff check python-backend/ppt_tools.py python-backend/presentation_spec.py python-backend/tests/test_presentation_toolkit.py python-backend/tests/verify_presentation_toolkit.py
python python-backend/tests/verify_presentation_toolkit.py
# On Windows with PowerPoint installed:
python python-backend/tests/verify_presentation_toolkit.py --powerpoint
```

The verification script writes review decks, slide previews, contact sheets, outlines, and `benchmark.json` into the ignored `presentation-toolkit-output` folder. It uses synthetic, labeled data. Optional `tiktoken` measures serialized requests and responses with `cl100k_base`. That tokenizer is a proxy for the production model, so these numbers are not billed-token measurements. Optional `--baseline-ref <git-ref>` measures the previous renderer at a specified revision.

The October 5, 2026 run generated 5, 10, and 15 slides and inspected their screenshots. Tests cover every layout in every template, real Chromium checks, editable slide content, image inclusion, speaker notes, valid ZIP/XML, aspect ratio, native object bounds, bad content, failed quality checks, atomic draft edits, and UI event arrival order. The actual artifact viewer also ran in Chromium with its real module and styles. Microsoft PowerPoint opened and rendered all 30 sample slides. Its native text-bound audit found zero overflowing boxes after fixes. The Windows audit script is included for repeat runs.

| Slides | Previous required calls | New default calls | Outline request tokens | Compact response tokens | Local export time |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5 | 7 | 1 | 350 | about 580 | about 1.7 s |
| 10 | 12 | 1 | 681 | about 700 | about 2.5 s |
| 15 | 17 | 1 | 1,036 | about 810 | about 3.1 s |

The toolkit schemas totaled 1,206 proxy tokens. These traffic measurements exclude the agent prompt, research, model reasoning, retries, and accumulated conversation history. The previous renderer's responses contained 323,168, 565,634, and 858,390 proxy tokens because they embedded JPEG data. Those are serialized output counts before any SDK truncation, not measured charges. Outline input itself saved only about 7 percent compared with compact structured JSON. Removing image bytes and the per-slide round trips accounts for the substantial improvement.

## Issues fixed and remaining limits

Verification caught and fixed chart callout overlap, source/axis label overlap, contrast checks using the wrong background, invalid crop API usage, stale validation after repairs, mismatched preview font scale, and compact responses overwriting rendered UI thumbnails. Native PowerPoint measurement also found font overhang at right-aligned labels and tight multi-line boxes. A matching right text margin and additional vertical space fixed those cases. The container now installs `puppeteer-core` and discovers its existing Playwright Chromium installation.

Charts and tables use editable shapes and text so the preview and export use the same geometry. Charts support one series with 2 to 8 values; they do not contain an embedded spreadsheet or PowerPoint chart editor. More series, complex charts, animation, and automatic retrieval of suitable images need separate work. Images require a real local asset. The toolkit cannot judge whether a supplied argument or claim is correct.

Native PowerPoint rendering and text bounds were checked on Windows. Linux font fallbacks and other Office versions can still change wrapping. Cloud artifact storage and a full authenticated agent conversation were not exercised. The Dockerfile changes were inspected but the container image was not rebuilt because the Docker daemon was unavailable. Deploying the backend requires rebuilding that image.
