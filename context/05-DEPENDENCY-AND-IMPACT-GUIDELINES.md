# Developer Dependency & Impact Guidelines

This document maps how modifications to one component ripple through the AI-OS system. Use this as a checklist before refactoring code blocks.

---

## 🔗 Component Dependency Reference

The table below lists the primary modules, their critical dependants, and what breaks if they are altered without coordinating updates across the stack:

| File / Component | Direct Upstream Dependents | What Breaks on Incompatible Changes |
| :--- | :--- | :--- |
| **[sockets.py](file:///c:/Users/prajw/Downloads/app/AI-OS/python-backend/sockets.py)** | [chat.js](file:///c:/Users/prajw/Downloads/app/AI-OS/js/chat.js) (Frontend client) | Modifying event names (e.g., `send_message`, `response`, `agent_step`) or changing their payload dictionary structures will freeze the chat interface, break streaming renderers, and prevent tool outputs from displaying. |
| **[agent_runner.py](file:///c:/Users/prajw/Downloads/app/AI-OS/python-backend/agent_runner.py)** | [sockets.py](file:///c:/Users/prajw/Downloads/app/AI-OS/python-backend/sockets.py) & [assistant.py](file:///c:/Users/prajw/Downloads/app/AI-OS/python-backend/assistant.py) | `run_agent_and_stream()` injects a request-scoped `realtime_tool_config` mapping socket configurations. Modifying its key structure will cause tool invocations (such as browser control or agent delegation) to throw runtime exceptions. |
| **[assistant.py](file:///c:/Users/prajw/Downloads/app/AI-OS/python-backend/assistant.py)** | [agent_runner.py](file:///c:/Users/prajw/Downloads/app/AI-OS/python-backend/agent_runner.py) & [chat.js](file:///c:/Users/prajw/Downloads/app/AI-OS/js/chat.js) (Frontend Config) | Changing agent configuration parameters inside `get_llm_os` must align with the settings checklist in `js/chat.js` (`chatConfig.tools`). Modifying tool registrations will prevent the LLM from accessing system integrations. |
| **[sandbox_tools.py](file:///c:/Users/prajw/Downloads/app/AI-OS/python-backend/sandbox_tools.py)** | LLM Agent System Prompt & [agent_runner.py](file:///c:/Users/prajw/Downloads/app/AI-OS/python-backend/agent_runner.py) | Changing method signatures (like `execute_in_sandbox` or `write_file`) will directly mismatch the system instructions defined in `assistant.py`, causing the LLM to call tools with incorrect parameters and fail. |
| **[chat.js](file:///c:/Users/prajw/Downloads/app/AI-OS/js/chat.js)** | [index.html](file:///c:/Users/prajw/Downloads/app/AI-OS/index.html) & [aios.js](file:///c:/Users/prajw/Downloads/app/AI-OS/js/aios.js) | Modifying the parsing functions like `getComputerToolMetadata()` or preview creators will break Google Sheets and PowerPoint deck visualizations. |
| **[aios.js](file:///c:/Users/prajw/Downloads/app/AI-OS/js/aios.js)** | Electron [main.js](file:///c:/Users/prajw/Downloads/app/AI-OS/main.js) | Modifying IPC event channels (e.g. `ipcRenderer.invoke`) will break native dialogs, filesystem reads, and workspace path configurations. |

---

## ⚡ Critical Modification Checks

Before committing changes, review these impact pathways:

### 1. Renaming Backend Tool Methods
*   *Downstream Impact:* The LLM learns which tools are available via introspection of python docstrings and helper variables. If you change a function name in `SandboxTools` or `BrowserTools`, you must update the prompt instructions inside `assistant.py` and the tool bindings. Otherwise, the agent will attempt to call the old method name, causing tool execution errors.

### 2. Changing Workspace Sync Directories
*   *Downstream Impact:* Coder Agent workspace folders are synchronized by downloading code files to `/workspace` inside the sandbox container. If you alter the path resolutions inside `agent_runner.py` (`_WORKSPACE_ROOT` or bootstrap processes), make sure to update the matching relative path conversions in `sandbox_tools.py` (`_normalize_workspace_path`) so the container knows where to execute scripts.

### 3. Adding New Settings toggles
*   *Downstream Impact:* If you add a new tool or config checkbox to the UI, you must:
    1.  Declare it in the `chatConfig` object in `js/chat.js`.
    2.  Update the socket payload in `sockets.py`.
    3.  Ensure it is mapped to the corresponding parameter in the `get_llm_os` signature in `assistant.py`.
    4.  Verify that legacy session records in Redis do not crash when the new key is missing (use dictionary `.get()` fallback methods).

### 4. Customizing WebSocket Chunk Streams
*   *Downstream Impact:* Streaming responses are split by Eventlet into separate socket packets. If you customize the structure of chunk payloads inside `run_agent_and_stream`, ensure the rendering code inside `js/chat.js` can gracefully unpack the changes (checking for `is_log`, `done`, and `streaming` flags).
