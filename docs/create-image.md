# create_image

## Existing flow

The Electron renderer sends attachments with `send_message`. `agent_runner.py`
downloads image attachments into Agno `Image` objects and passes them to the
main team. The runner also injects the user, conversation, message, and Socket.IO
context into `MediaTools` through `assistant.py`.

`MediaTools.generate_image` currently runs an internal image agent, uploads the
result to the `media-uploads` bucket, registers it in `session_content`, and emits
`media_generated` to the conversation room. `python-bridge.js` relays that event
to `chat.js`, which caches the image in `artifact-handler.js`. A fenced `image`
reference opens the artifact viewer. The calling model receives only text.

Agno 2.0.5 and 2.8.7 support `ToolResult(content=..., images=[Image(...)])`.
Agno moves tool images into a follow-up media message for the calling model.
The main team already enables `send_media_to_model` and `store_media`.

## Implementation scope

- Add `create_image(text, image=None)` to `MediaTools`. Image input may be an
  explicit HTTP(S)/data URL or an injected attachment.
- Use OpenRouter's dedicated `/api/v1/images` endpoint and `input_references`.
- Return image bytes through Agno `ToolResult.images`, with structured preview
  metadata in its content for live tool events and persisted event replay.
- Reuse the media upload, conversation-room event, and artifact viewer.
- Keep `generate_image`, `generate_video`, model routing, and socket names intact.
- Verify provider errors, malformed media, reference selection, persistence,
  model-visible media, browser display, and the existing nearby tests.

## Free provider verification

On October 6, 2026, OpenRouter's model and image endpoint APIs list
`inclusionai/ming-image-0.1-design` as free text-to-image and
`inclusionai/ming-image-0.1-design-layer` as free with exactly one reference image.
Both are served by Novita. Verify current endpoint pricing and reference limits
before submitting requests; do not switch to a paid model automatically.

Sources: [image API documentation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation),
[free image model filter](https://openrouter.ai/models?output_modalities=image&max_price=0).
