# Task 01: Make Streaming Messages Render Smoothly

## Why this task exists

The chat interface does far more work than necessary whenever a small piece of an answer arrives. This is one of the most likely causes of visible typing lag, high CPU use, delayed scrolling, and a window that feels less responsive during long answers.

## What happens today

`js/message-formatter.js` combines every new chunk with all earlier text. It then parses the complete answer as Markdown and sanitizes the complete HTML again. `js/chat.js` replaces the message element's full `innerHTML`, searches for code blocks, applies syntax highlighting, creates copy buttons, and updates scrolling.

This process repeats for nearly every streamed chunk. If an answer grows from one line to several thousand lines, the beginning of the answer is parsed and rendered over and over even though it has not changed. The total work grows much faster than the answer itself.

## What should improve

Incoming chunks should first be added to an in-memory buffer. The screen should update at a controlled rate, such as once per animation frame or every 50 to 100 milliseconds, instead of once for every network event.

While the answer is still arriving, use a lightweight representation. Plain text or a limited Markdown renderer is enough for the live typing effect. When the backend sends the final completion event, run the full Markdown conversion, HTML sanitization, syntax highlighting, Mermaid rendering, copy-button setup, and final scroll correction once.

The existing plan-mode batching in `js/chat.js` is a useful pattern and can be generalized for normal messages.

## Implementation guidance

Keep one stream state object per message. It should own the raw text, pending chunks, scheduled render handle, finalization state, and cancellation state. Append text without repeatedly joining a large array or recreating the whole message object.

Prefer updating a text node or a small trailing DOM section during the stream. If full Markdown must be visible during streaming, update it in larger batches and avoid scanning code blocks that were already processed. Automatic scrolling should happen only when the user is already near the bottom; it should not fight a user who has scrolled upward.

The final render must still pass through the current sanitizer. Performance work must not weaken protection against unsafe HTML.

## Risks and special cases

Markdown structures can be incomplete while streaming. A code fence, table, link, or Mermaid block may not close until later. The temporary renderer must display these cases without throwing errors. Cancellation, reconnect recovery, switching sessions, and two messages streaming at the same time must not mix their buffers.

## Completion check

Record a long streamed response before and after the change. Chrome or Electron performance traces should show no repeated full-message highlighting and no renderer task longer than 50 milliseconds during normal streaming. The final formatted output must match the current output, including code blocks, diagrams, links, copy buttons, and sanitized HTML.
