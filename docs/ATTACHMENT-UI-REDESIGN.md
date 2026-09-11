# Attachment UI Redesign And Content Dedupe

## Overview

This document records the attachment and session-content UI work completed in this conversation. The goal was to move the product away from small, generic attachment pills and toward a more visual, premium, and task-friendly file experience. At the same time, we fixed the duplicate-file problem in the Content surfaces so uploaded files are shown once instead of being repeated from multiple backend sources.

The overall design direction follows a restrained dark glass aesthetic. The interface keeps the existing Aetheria visual language, but makes attachments feel like real objects that the user can scan, recognize, and preview quickly.

## What The Old Experience Looked Like

Before the redesign, attachments were shown in several different ways:

- In the composer, files appeared as narrow pills with an icon, filename, and remove action.
- After sending a message, the user saw a `Context` pill/button that represented attached files and selected sessions together.
- Clicking that context button opened a secondary context window to inspect the files.
- The `Content` drawer and history content sidebar could show duplicate entries for the same uploaded file.

That older behavior had a few UX issues:

- Pills were too compressed for image-heavy or mixed-document workflows.
- The user had to mentally map a text pill back to a real file.
- The sent-message `Context` button hid important information that could have been visible directly in the message.
- The same file could appear twice in `Content`, which made the system feel unreliable.

## New Visual Direction

The new attachment design is inspired by card-based file surfaces similar to modern multimodal chat products. Instead of treating files as metadata, the UI now treats them as visible context blocks.

The key visual decisions are:

- Each attachment is presented as a fixed square card.
- Image files show an actual thumbnail preview.
- Non-image files show a strong file-type icon in a compact surface badge.
- Filenames sit at the bottom of the card with a dark gradient overlay for readability.
- The cards use a dark glass surface with subtle blur, soft borders, and reduced glow.
- The motion stays calm: a small lift on hover, slightly brighter border, and stable layout.

This makes the interface feel more intentional and helps users identify files at a glance without opening a separate inspector first.

## Composer Attachment Experience

### Card Layout

The composer attachment area was converted from wrapped pills into a horizontal card rail.

Each card is:

- `112px x 112px`
- Rounded with a soft glass treatment
- Fixed-size so the composer height stays predictable
- Scrollable horizontally instead of wrapping into multiple noisy rows

### Scrolling Behavior

When the user attaches more files than comfortably fit, the composer no longer grows taller and taller. Instead:

- The rail stays on one line
- The user can scroll horizontally through the attachments
- `scroll-snap` is used so the movement feels tidy and deliberate

This preserves the writing area and keeps the input usable even when many files are attached.

### Preview And Removal

Each card supports direct interaction:

- Clicking the card opens the file preview modal
- Hovering or focusing the card reveals the remove action
- Uploading, reading, archiving, and failed states can still be represented

This means the attachment row is now both a summary surface and a control surface.

## Sent Message Attachment Experience

### Cards Instead Of A File Context Pill

After sending a message with files, the system now shows the actual attachment cards directly in the user message rather than a generic `Context` or `X files` pill.

This is important because the files themselves are now the context. The user should not need a second button just to discover what was already attached.

### Right-Aligned User Message Behavior

User messages are normally right-aligned in the chat interface. The sent attachment rail was updated to respect that behavior:

- The message bubble remains aligned to the right
- The attachment rail stays visually anchored to the right-side user message container
- The cards no longer make the message feel like a left-aligned system panel

### Context Button Reduction

The old context-button behavior is no longer used for file attachments alone.

Current behavior:

- File attachments are visible directly as cards
- Clicking a card opens preview
- There is no extra file-count pill such as `9 files`
- A smaller context button may still be shown only when referenced chat sessions are included, because sessions are not directly visual in the same way files are

This keeps the UI simpler and removes duplicated interaction paths.

## Attachment Card Styling Details

The cards are intentionally premium but controlled. The first pass used too much glow, so the visual treatment was reduced to feel more polished and less flashy.

### Surface

- Semi-transparent dark surface using RGBA
- `backdrop-filter` and `-webkit-backdrop-filter` for glass blur
- Soft white border for edge definition
- Inner shadow for thickness

### Depth

- Mild outer shadow rather than a strong neon-like glow
- Reduced icon glow compared to the earlier draft
- Small hover lift instead of dramatic scaling

### Content Readability

- Bottom gradient overlay behind text
- Two-line clamp for filenames
- High-contrast white text and subtle shadowing

The result is a calmer dark glass UI that still feels premium.

## File Preview Behavior

The attachment cards are not decorative. They are an entry point into the existing preview system.

Supported behavior includes:

- Image files: full visual preview
- Text and code files: readable code/text preview
- PDFs and documents: modal-based preview or document placeholder handling based on the existing system

One important implementation detail is that preview URLs for attached files are preserved when the message is sent. Without that, the sent-message cards would lose their thumbnails because the composer clears its temporary state after send.

## Context Viewer Changes

The old context viewer used heavier row-based file rendering. That is no longer the main file-inspection pattern.

The viewer was updated so that:

- Files can be shown as a card rail instead of a dense expandable list
- The modal height is more controlled and less empty
- File inspection is secondary because the primary message itself already shows the file cards

The viewer is still useful as a broader context surface, especially when session references are involved, but it is no longer required just to understand which files were attached.

## Duplicate Content Problem

### The Original Bug

The `Content` drawer and history content sidebar could show the same uploaded file more than once. This happened because the system was merging rows from more than one backend source:

- `session_content`
- `attachment`

In practice, a single upload could exist in both representations and then appear twice in the UI.

### UX Impact

This created several trust problems:

- Users could think the same file had been uploaded twice
- Content views became noisy and harder to scan
- The product felt less deterministic and less polished

## Frontend Dedupe Strategy

A shared frontend utility was added so both content surfaces use the same dedupe logic:

- Live session content viewer
- History content sidebar

The shared utility is implemented in:

- [session-content-utils.js](/C:/Users/prajw/Downloads/app/AI-OS/js/session-content-utils.js)

### Dedupe Key Priority

Files are deduped using the strongest available identity in this order:

1. `metadata.file_id`
2. normalized storage path such as `metadata.path`
3. normalized local archive path such as `metadata.relativePath`
4. `reference_id` for generated artifacts
5. fallback identity from filename, size, and mime type

### Richer Row Preference

When two rows represent the same file, the system prefers the richer row. A richer row is one that has more useful preview/opening information, such as:

- a signed cloud URL
- a download URL
- a local `relativePath`
- better metadata such as size or mime type

This means dedupe does not just hide duplicates. It tries to keep the best usable record.

## Backend Dedupe Strategy

Frontend dedupe helps the UI, but backend dedupe improves data quality before the client renders anything.

The session content API now dedupes merged rows before returning them to the UI. This reduces duplication for every consumer of that endpoint, not just one specific view.

### Backend Metadata Improvements

The upload registration flow was also improved so that uploaded file records carry stronger identity information:

- `file_id`
- `size`
- `relativePath`
- `isMedia`
- mime type

This makes future dedupe more reliable and gives the system a better chance of recognizing that two rows refer to the same underlying file.

## Files Changed During This Work

### Frontend

- [add-files.js](/C:/Users/prajw/Downloads/app/AI-OS/js/add-files.js)
- [chat.js](/C:/Users/prajw/Downloads/app/AI-OS/js/chat.js)
- [session-content-viewer.js](/C:/Users/prajw/Downloads/app/AI-OS/js/session-content-viewer.js)
- [history-content-sidebar.js](/C:/Users/prajw/Downloads/app/AI-OS/js/history-content-sidebar.js)
- [session-content-utils.js](/C:/Users/prajw/Downloads/app/AI-OS/js/session-content-utils.js)
- [chat-input.css](/C:/Users/prajw/Downloads/app/AI-OS/css/chat-input.css)
- [chat-messages.css](/C:/Users/prajw/Downloads/app/AI-OS/css/chat-messages.css)
- [chat-context.css](/C:/Users/prajw/Downloads/app/AI-OS/css/chat-context.css)

### Backend

- [api.py](/C:/Users/prajw/Downloads/app/AI-OS/python-backend/api.py)
- [sockets.py](/C:/Users/prajw/Downloads/app/AI-OS/python-backend/sockets.py)

## Functional Outcome

After the redesign, the system behaves like this:

- Users attach files and immediately see visual cards instead of pills
- The attachment row stays compact and scrolls horizontally when needed
- Sending a file-based prompt shows those same cards directly in the user message
- File previews are available directly from the cards
- The redundant file-count context pill is removed for attachment-only flows
- Session context still has a smaller control when session references are involved
- `Content` views no longer show duplicate file entries for the same upload

## Why This Matters

This work improves both aesthetics and trust.

On the visual side, the product feels more premium, more multimodal, and more intentional. Users can recognize attachments immediately and interact with them in-place.

On the functional side, the product feels more reliable because repeated files are deduped and the interface no longer asks users to click through multiple layers just to inspect what they already attached.

Together, these changes move attachments from a background implementation detail to a first-class part of the conversation UI.
