# create_image

## Request and result flow

The Electron renderer sends attachments with `send_message`. `agent_runner.py`
downloads image attachments into Agno `Image` objects and passes them to the
main team. The runner also injects the user, conversation, message, and Socket.IO
context into `MediaTools` through `assistant.py`.

`MediaTools.create_image` calls OpenRouter's Image API directly, uploads the
result to the `media-uploads` bucket, registers it in `session_content`, and emits
`media_generated` to the conversation room. `python-bridge.js` relays that event
to `chat.js`, which shows the image in `artifact-handler.js`. The tool returns
the same bytes through Agno `ToolResult.images`, plus JSON content containing
an `ok` flag, a fenced `image` reference, and preview metadata. Both live
`agent_step` events and saved event replay can render that metadata.

Agno 2.0.5 and 2.8.7 support `ToolResult(content=..., images=[Image(...)])`.
Agno moves tool images into a follow-up media message for the calling model.
The main team already enables `send_media_to_model` and `store_media`.

The pinned Agno 2.0.5 serializer needs `Image.format` to create the correct data
URL. The tool sets both `format` and `mime_type`. Raw image bytes stay out of
Socket.IO tool metadata; the UI receives the saved image's signed URL instead.

## Tool interface

```python
create_image(text="A red bicycle on a cream background")
create_image(text="Extract the foreground", image="https://example.com/reference.png")
```

`text` is required and limited to 20,000 characters. `image` is optional and
accepts HTTP(S) URLs or base64 PNG/JPEG/WebP data URLs. With no explicit image,
the tool uses one image attachment from the current turn. Multiple attachments
require an explicit URL selection. Attachment data and storage paths come from
the runner privately, rather than appearing in the model's tool arguments.

## Implemented behavior

- Added `create_image(text, image=None)` to `MediaTools`. Image input may be an
  explicit HTTP(S)/data URL or an injected attachment.
- Uses OpenRouter's dedicated `/api/v1/images` endpoint and `input_references`.
- Returns image bytes through Agno `ToolResult.images`, with structured preview
  metadata in its content for live tool events and persisted event replay.
- Reuses the media upload, conversation-room event, and artifact viewer.
- Keeps `generate_image` as an alias and preserves direct `generate_video` calls
  and existing socket event names.
- Removes the internal `media_image_generator` and unused legacy `artist_agent`
  toolkit. There was no `media_video_generator` agent in the current code.
- Fixes the viewer's handling of HTTP image URLs and image download metadata.
- Refreshes expired saved preview URLs through the authenticated session content
  API. The saved-files panel continues to use the existing content registry.
- Returns structured errors and shows image-generation failures in the tool log.

## Free provider verification

On October 6, 2026, OpenRouter's model and image endpoint APIs list
`inclusionai/ming-image-0.1-design` as free text-to-image and
`inclusionai/ming-image-0.1-design-layer` as free with exactly one reference image.
Both are served by Novita. The client checks current endpoint pricing and
reference limits before submitting, pins the free provider, and disables
provider fallback. It refuses paid or unknown-price endpoints.

The free reference model is specialized for decomposing designs into RGBA
layers. Its reference input support does not establish that it can perform
arbitrary photographic edits. Generation quality and editing behavior remain
unverified because the configured account rejected both live smoke tests.

## Server configuration

`OPENROUTER_API_KEY` supplies the existing server-side credential. Optional
`OPENROUTER_IMAGE_MODEL` and `OPENROUTER_IMAGE_EDIT_MODEL` replace the text and
reference model IDs. Overrides must also have a zero-price endpoint with the
required reference count. No new browser-side credential is needed.

Live tests on October 6, 2026 returned HTTP 402. OpenRouter reported that the
configured account had never purchased credits, despite both endpoints having
zero prices. Use a key from an eligible account before rerunning the smoke test.
The script does not purchase credits or upload to Supabase.

## Verification

From the repository root:

```powershell
$env:PYTHONPATH = 'python-backend'
python -m pytest python-backend/tests/test_openrouter_image_client.py python-backend/tests/test_create_image_tool.py -q
node --test js/tests/create-image-browser.test.js js/tests/presentation-browser.test.js
python python-backend/tests/verify_create_image_live.py --output-dir .ui-check/create-image-live
```

To run the reference smoke test independently:

```powershell
python python-backend/tests/verify_create_image_live.py --output-dir .ui-check/create-image-live --reference js/tests/fixtures/generated-image.png
```

The 44 image tests pass with Agno 2.0.5 and 2.8.7. They exercise real Agno tool
invocation, media injection, the primary model serializer, external provider
contracts, and mocked storage/persistence. A broader relevant run passed 59
backend tests and 35 JavaScript tests, including existing video behavior,
presentation rendering, computer control, and typing behavior. Browser checks
use the production viewer and chat handlers in a local fixture at desktop and
mobile widths; they do not require a logged-in production account.

An additional existing streaming test could not pass because this checkout
lacks `android/app/src/main/java/com/aetheria/ai/AssistantMobileBridgeManager.java`.
That file was also absent before this change. Live provider output and live
Supabase persistence remain unverified; the API and storage tests mock them.

Sources: [image API documentation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation),
[free image model filter](https://openrouter.ai/models?output_modalities=image&max_price=0).
