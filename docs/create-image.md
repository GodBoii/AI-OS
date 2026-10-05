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

## Model choice and measured cost

The default for both text and reference inputs is `openai/gpt-image-1-mini`.
The client requests one square image at `quality: low` when those parameters
are supported. It validates endpoint prices and reference limits, pins the
provider, and disables provider fallback. Negative, missing, and non-finite
prices are refused; known paid prices are supported.

On October 6, 2026, the same short bicycle prompt produced these actual charges
using the deployed server's credential. These are measured request costs, not
fixed per-image quotes; token-based cost changes with the input.

| Model | Settings | Actual charge | Result |
| --- | --- | --- | --- |
| GPT Image 1 Mini | low, 1:1 | $0.002218 | 1024x1024 PNG |
| GPT Image 2 | low, 1:1 | $0.005985 | 1024x1024 PNG |
| Recraft V4.1 Flash | 1:1 | $0.007 | 1024x1024 WebP |

Mini was the cheapest of these candidates. The client smoke test then generated
a new image for $0.00222 and changed its red bicycle to blue for $0.00477. The
full tool test edited it to green for $0.004772 and verified that uploaded and
model-visible bytes were identical. Actual cost is included in the tool result
metadata and saved content metadata when OpenRouter reports it.

The previous free defaults were `inclusionai/ming-image-0.1-design` and its
design-layer variant. The latter specializes in design-layer extraction, so
they have been replaced with a model verified for both generation and editing.

## Server configuration

`OPENROUTER_API_KEY` supplies the existing server-side credential. Optional
`OPENROUTER_IMAGE_MODEL` and `OPENROUTER_IMAGE_EDIT_MODEL` replace the text and
reference model IDs. Overrides need an endpoint with known pricing and the
required reference count. No new browser-side credential is needed.

The local credential still returns HTTP 402 because its account has never
purchased credits. The deployed Ubuntu server's credential successfully
generated images. Keep credentials server-side; changing the model does not
resolve an account-level credit error.

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

The 48 image tests pass with Agno 2.0.5 and 2.8.7. They exercise real Agno tool
invocation, media injection, the primary model serializer, external provider
contracts, and mocked storage/persistence. The latest broader relevant run
passed 79 backend tests and four browser/presentation tests. Previous checks
also passed existing computer-control and typing tests. Browser checks
use the production viewer and chat handlers in a local fixture at desktop and
mobile widths; they do not require a logged-in production account.

An additional existing streaming test could not pass because this checkout
lacks `android/app/src/main/java/com/aetheria/ai/AssistantMobileBridgeManager.java`.
That file was also absent before this change.

For a full live check from the backend container:

```sh
python tests/verify_create_image_tool_live.py --output-dir /tmp/aios-image-tool-check
```

This paid, opt-in script creates a temporary Supabase test identity, calls the
real tool, verifies the storage roundtrip, saved content row, and event room,
and asks the configured primary model to identify the generated bicycle color.
It removes the test's storage objects, registry rows, and identity afterward.
It sends no signup email and makes no credit purchases.

## Ubuntu deployment verification

The backend was pulled, rebuilt, and restarted in `/home/arun/apps/ai-os` on
October 6, 2026. An existing full backend/Flower build was resolving unpinned
dependencies, so this deployment rebuilt the application layer from the
already-working backend image without replacing its tested dependencies.
The prior image is retained as `ai-os-web:before-create-image-mini`.

The temporary Compose build override is `/tmp/aios-backend-refresh.yml`, with
Dockerfile `/tmp/aios-backend-refresh.Dockerfile`. Both contain build settings
only; the original Compose files continue to provide runtime configuration.
Redis, the sandbox manager, Flower, and Cloudflared stayed running.

Both `http://127.0.0.1:8765/api/healthz` and the public
`https://api.aetheriaai.website/api/healthz` returned successfully after restart.
The detailed health endpoint returned HTTP 200 with `status: ok`.
The deployed container reports Agno 2.0.5 and Mini for both image input modes.
The post-restart live tool test generated a PNG for $0.002218, verified storage
and history, and received `Green` from the primary model's vision check.
Its temporary account, registry row, and storage objects were removed.

Sources: [image API documentation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation),
[model cost comparison](https://openrouter.ai/blog/insights/image-generation-models-compared/).
