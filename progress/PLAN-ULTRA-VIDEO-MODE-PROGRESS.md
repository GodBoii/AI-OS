# Plan Mode, Ultra Think, and video routing progress

Last updated: August 28, 2026

## Purpose

This document records the work completed on Aetheria's Plan Mode, Ultra Think mode, and video attachment routing. It describes the current implementation, the decisions made during development, the problems found during testing, and the state of the feature now.

The product name is **Ultra Think**. Earlier conversation text sometimes referred to it as "ultra-thin," but the implemented mode and UI label are `ULTRA THINK`.

## Current behavior summary

The composer now supports four visible combinations:

| Composer state | What happens |
| --- | --- |
| Standard | The selected top-level agent uses `deepseek/deepseek-v4.1-flash`. |
| Plan Mode | A planning agent creates an editable plan before any main-agent execution. |
| Ultra Think | The selected top-level agent uses `deepseek/deepseek-v4.1-flash` with `xhigh` reasoning. |
| Plan Mode + Ultra Think | Plan Mode runs first. After the user reviews and submits the plan, the approved plan runs through the top-level agent with Ultra Think active. |

Video attachments have a separate route:

| Input condition | Primary route |
| --- | --- |
| No video and Standard mode | DeepSeek route through OpenRouter |
| Video attached in Standard mode | GLM multimodal route through OpenRouter |
| Ultra Think without video | DeepSeek route with `xhigh` reasoning |
| Ultra Think with video | Rejected in both the frontend and backend |

Model identifiers are backend-only. The frontend sends mode and attachment metadata but does not display or log the selected model. Existing token logging remains unchanged.

## Plan Mode

### User flow

1. The user enables the `Plan` button in the composer.
2. The user enters a request and may include supported files, selected chat sessions, and workspace context.
3. The frontend sends a `plan_request` event instead of starting the main `llm_os` run.
4. The backend planning agent produces a streamed, editable plan.
5. The user can review or edit the plan.
6. When the user submits the approved plan, Plan Mode turns off and the plan text becomes the prompt for the main execution flow.

### Plan output structure

The plan agent is instructed to return:

1. Refined Request
2. Execution Plan
3. Agents And Tools To Use
4. Context To Preserve
5. Verification And Success Criteria
6. Final Prompt For Aetheria

The final prompt is self-contained so the main agent can execute it without reconstructing the planning conversation.

### Plan Mode with Ultra Think

Plan Mode and Ultra Think are intentionally compatible. Enabling both does not cause a conflict:

- The planning agent performs the planning pass first.
- Ultra Think remains selected while the plan is being reviewed.
- Submitting the approved plan sends `thinking_mode: "ultra"` to the normal message pipeline.
- The active top-level main, coder, or computer agent then uses the Ultra route.

The Plan Mode agent itself keeps its existing model. Ultra Think does not replace the Plan Mode model or other member-agent models.

## Ultra Think mode

### Frontend state

The composer has an accessible `ULTRA THINK` button next to Plan Mode. Its state is tracked independently from `agent_mode`.

This separation is important because `agent_mode` already controls which workspace agent receives the turn:

- `default` selects the main `llm_os` team.
- `coder` selects the dedicated coding agent.
- `computer` selects the dedicated computer-control agent.
- `system-assistant` is reserved for the mobile/system assistant path.

Ultra Think is therefore represented by a separate `thinking_mode` value rather than another `agent_mode` value. This allows combinations such as coder plus Ultra Think and computer plus Ultra Think.

The composer also stores a visual state on the input container:

- `standard`
- `plan`
- `ultra`
- `plan-ultra`

### Backend routing

The backend accepts `thinking_mode: "standard"` or `thinking_mode: "ultra"`. It normalizes unknown values to Standard mode and never accepts a raw model ID from the frontend.

Ultra Think selects:

```text
deepseek/deepseek-v4.1-flash
```

The selected primary model is passed only to the active top-level agent factory:

- `get_llm_os()`
- `get_coder_agent()`
- `get_computer_agent()`

Delegated coder/computer agents and member agents keep their existing default models. This follows the requirement that Ultra Think changes the active user-facing agent but does not rewrite every sub-agent model.

## Sticky conversation routing

Video and Ultra routes are sticky for the active backend conversation.

- A normal Standard conversation can continue using DeepSeek.
- The first accepted video promotes the conversation to the GLM video route.
- Enabling and using Ultra Think promotes the conversation to the Ultra route.
- A promoted conversation keeps its route state on later turns.
- A video-routed conversation cannot switch to Ultra Think.
- An Ultra-routed conversation cannot accept a later video.

The backend stores the server-owned route name in session configuration as `primary_model_route`. It stores a route such as `video` or `ultra`, not a frontend-provided model ID.

## Video attachment handling

### Supported entry paths

The same validation applies when a video enters through:

- The attachment file picker
- Drag and drop
- Clipboard paste

Recognized video extensions include:

```text
mp4, webm, avi, mov, mkv
```

Detection uses both MIME type and file extension. This covers files whose browser MIME metadata is missing or generic.

### Frontend restrictions

When Ultra Think is active:

- A newly selected video is rejected before archiving or upload.
- A dropped video is rejected.
- A pasted video is rejected.
- Ultra Think cannot be enabled while a video is already attached.
- A final send-time guard prevents race conditions or programmatically inserted conflicts.

The user receives a specific error explaining that video attachments are unavailable in Ultra Think mode.

### Backend restrictions

The backend repeats the validation before it mutates session state, registers attachments, checks usage, or starts an agent run. This prevents an older or modified client from bypassing the frontend rule.

Routing validation errors are marked recoverable. The frontend therefore does not treat an Ultra/video conflict as a broken backend session.

### Current video model

Video turns now route to:

```text
deepseek/deepseek-v4.1-flash
```

The route uses the project's OpenRouter reasoning adapter. The adapter serializes Agno `Video` objects as OpenRouter `video_url` content blocks and uses base64 data URLs for downloaded private media.

## Video implementation history

### Initial MiMo route

The first implementation routed video turns to:

```text
xiaomi/mimo-v2.5
```

Application logs confirmed that routing and file download worked:

- `has_video=True`
- The video route selected MiMo.
- The MP4 downloaded from storage.

However, Agno's OpenRouter message formatter discarded the video before the provider request. The model therefore received the text prompt without the attached video.

### Custom OpenRouter serializer experiment

A custom adapter converts Agno videos into OpenRouter `video_url` blocks with base64 data URLs. Tests cover this request shape because Agno 2.0.5 does not serialize `Message.videos` in its OpenRouter formatter.

### Current DeepSeek decision

Standard and Ultra routes use `deepseek/deepseek-v4.1-flash` through the OpenRouter adapter. Video attachments use `z-ai/glm-5.3-flash`, which keeps video input separate from the text-and-image DeepSeek route.

## Workspace coverage

The routing rules apply consistently in all user workspaces because every attachment reaches `agent_runner.py` before the active top-level agent is constructed.

### Main workspace

- Standard text/files: DeepSeek through OpenRouter
- Standard with video: GLM through OpenRouter with video serialization
- Ultra Think: DeepSeek with `xhigh` reasoning
- Ultra Think with video: rejected

### Coder workspace

- The same model selection is passed into `get_coder_agent()`.
- Video reaches the top-level coder agent through Agno's `videos` run argument using GLM.
- Ultra Think selects DeepSeek for the top-level coder.
- Delegated agents retain their defaults.

### Computer workspace

- The same model selection is passed into `get_computer_agent()`.
- Video reaches the top-level computer agent through Agno's `videos` run argument using GLM.
- Ultra Think selects DeepSeek for the top-level computer agent.
- Existing computer and browser tools remain unchanged.

## Main files changed

### Frontend

- `chat.html`
  - Adds the Ultra Think button beside Plan Mode.
- `css/chat-components.css`
  - Adds Ultra Think states, focus behavior, locked styling, and responsive sizing.
- `css/theme-light.css`
  - Keeps the active Ultra Think control readable in the light theme.
- `js/chat.js`
  - Tracks Plan and Ultra state.
  - Sends `thinking_mode` with normal and recovery messages.
  - Preserves Ultra through plan review and approved-plan submission.
  - Detects video attachments and enforces route conflicts.
  - Applies composer visual states.
- `js/add-files.js`
  - Adds a reusable attachment validation callback used by picker, drag/drop, and paste flows.

### Backend

- `python-backend/model_routing.py`
  - Owns model constants, mode normalization, video detection, sticky routes, and conflict errors.
- `python-backend/primary_model_factory.py`
  - Returns the OpenRouter reasoning adapter for every primary route.
- `python-backend/openrouter_reasoning_model.py`
  - Applies `xhigh` reasoning by default and serializes video input for OpenRouter.
- `python-backend/sockets.py`
  - Validates mode and video combinations at the WebSocket boundary.
  - Prevents client model injection.
  - Persists sticky route metadata.
- `python-backend/agent_runner.py`
  - Resolves the primary model before agent construction.
  - Passes the selected model into main, coder, or computer factories.
  - Downloads attachments and supplies Agno media objects to `agent.run()`.
- `python-backend/assistant.py`
  - Accepts an internally selected primary model for `llm_os`.
- `python-backend/coder_agent.py`
  - Accepts an internally selected primary model for the top-level coder.
- `python-backend/computer_agent.py`
  - Accepts an internally selected primary model for the top-level computer agent.
- `python-backend/plan_agent.py`
  - Contains the existing Plan Mode prompt construction, streaming, and fallback plan behavior.

## Verification completed

The work has been checked with:

- Model-routing tests for Standard, video, Ultra, sticky routes, invalid combinations, MIME detection, and extension detection.
- Python compilation checks for the edited backend modules.
- JavaScript syntax checks for the composer and attachment modules.
- Existing desktop computer-control and voice-input regression tests.
- Backend regression tests that do not depend on missing Android source files.
- Focused adapter tests confirming DeepSeek and GLM construction, `xhigh` reasoning, and video serialization without a provider call.
- A restart of the backend web service so the active Gunicorn worker loaded the current implementation.

## Current limitations and next checks

1. Video size, duration, encoding, and resolution still affect provider acceptance and processing time. Begin with a short, small MP4 when validating the final route.
2. The backend should be restarted after model-routing code changes because Gunicorn is not running with automatic reload.
3. The full desktop UI requires Electron preload APIs, so standalone browser loading cannot reproduce every attachment and IPC interaction.
4. Several mobile-contract tests in this checkout depend on Android source files that are not present. Those failures are unrelated to Plan Mode, Ultra Think, or video routing.
5. If a video request fails, inspect the `[MODEL_ROUTING]` log, storage download log, and OpenRouter provider error.

## Final implementation state

The current intended product behavior is:

```text
Standard prompt          -> deepseek/deepseek-v4.1-flash with xhigh reasoning
Ultra Think prompt       -> deepseek/deepseek-v4.1-flash with xhigh reasoning
Standard prompt + video  -> z-ai/glm-5.3-flash with OpenRouter video serialization
Ultra Think + video      -> rejected
Plan + Ultra             -> plan first, approved plan runs with Ultra
```

This is the reference behavior for future development and testing.
