# Task 02: Keep Conversation Context Small and Useful

## Why this task exists

The backend currently keeps and reloads a large amount of conversation history. More history is not automatically better. It increases database payloads, prompt construction time, model input tokens, time to first token, and cost. Very large histories can also distract the model with old details.

## What happens today

The main team and coder agent are configured with up to 40 historical runs and stored events. When selected context is used, `python-backend/agent_runner.py` can walk through the full stored `runs` document and add old outputs again.

The repository contains session examples large enough to demonstrate the risk. One old run contains roughly 100,000 input tokens and took more than 200 seconds before and during generation. Normal examples are also hundreds of kilobytes. Tool results, media information, and repeated instructions can make the stored history grow even faster than the visible conversation.

## What should improve

Replace the fixed “last 40 runs” rule with a token budget. Keep the most recent useful turns in full, normally around six to ten, and represent older conversation with a compact rolling summary. Retrieve older details only when the current request appears to need them.

Tool output should be stored separately from the conversational memory. The model normally needs the conclusion of a tool call, not a repeated copy of a large log, file listing, image payload, or raw API response. Media should be represented by stable references and concise descriptions.

Selected context should have the same budget rules as automatic history. Adding selected context must not silently duplicate content already present in the recent conversation.

## Implementation guidance

Create one context builder used by every agent type. It should count estimated tokens, reserve space for system instructions and the expected answer, include recent messages first, and then add summaries or retrieved facts until the budget is reached.

Generate or update a rolling summary after a run finishes, preferably outside the critical response path. The summary should preserve decisions, user preferences, unresolved tasks, important file names, and outcomes. It should not preserve greetings, repeated status messages, or complete tool logs.

Add metrics for context bytes, estimated tokens, number of full turns, number of summarized turns, and number of retrieved memories. This makes unexpected growth visible.

## Risks and special cases

Over-aggressive trimming can remove a constraint that still matters. Pin system instructions, active task requirements, and explicitly selected user context. Make the budget configurable by model because context limits and prices differ. Summary updates need versioning so a failed summary does not replace the last valid one.

## Completion check

For a long session, repeated messages should keep prompt size within a predictable range instead of growing without limit. Tests should prove that recent instructions remain intact, selected context is not duplicated, and old facts can still be retrieved. Compare time to first token and input-token usage before and after the change.
