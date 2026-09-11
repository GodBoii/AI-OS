# Backend Server & Agentic Execution Workflow

This document details the operations of the Python backend server, database management, and the multi-agent execution pipeline.

---

## ⚙️ Backend Module Registry

The backend server is structured around an asynchronous Flask application:

*   **[app.py](file:///c:/Users/prajw/Downloads/app/AI-OS/python-backend/app.py)**
    *   *Role:* Application entry point. Loads the factory and launches the Eventlet-backed Socket.IO web server.
*   **[factory.py](file:///c:/Users/prajw/Downloads/app/AI-OS/python-backend/factory.py)**
    *   *Role:* Flask application factory. Sets up CORS rules, configures OAuth profiles (GitHub, Google, Vercel, Supabase), binds Redis connectors, and starts background polling daemons.
*   **[api.py](file:///c:/Users/prajw/Downloads/app/AI-OS/python-backend/api.py)**
    *   *Role:* Contains HTTP REST routes. Manages user sign-in verifications, active session profile updates, local cache invalidations, and system file upload vaults.
*   **[sockets.py](file:///c:/Users/prajw/Downloads/app/AI-OS/python-backend/sockets.py)**
    *   *Role:* Manages Socket.IO websocket protocols. Resolves connection IDs and coordinates prompt routing.
*   **[agent_runner.py](file:///c:/Users/prajw/Downloads/app/AI-OS/python-backend/agent_runner.py)**
    *   *Role:* Orchestrates the execution loop. Translates user session history, constructs contextual prompts, instantiates Agno team managers, and logs usage stats.
*   **[assistant.py](file:///c:/Users/prajw/Downloads/app/AI-OS/python-backend/assistant.py)**
    *   *Role:* Compiles agent definitions. Declares system instructions, registers tool definitions, and links database backends.

---

## 🧠 Agno AI Multi-Agent Architecture

AI-OS leverages the Agno agent framework to coordinate specialist AI units.

```
                    +-----------------------------+
                    |        Aetheria_AI          |
                    |       (Team Leader)         |
                    |      Model: mimo-v2.5       |
                    +--------------+--------------+
                                   |
            Delegates tasks to specialist member agents
            /                              \
+----------v-----------+          +---------v----------+
|      assistant       |          | presentation_agent |
| (Platform Specialist)|          |  (PPTX Specialist) |
|  - GitHub Operations |          |  - Creates Native  |
|  - Vercel Deployments|          |    Slide Decks     |
|  - Supabase Database |          |  - Style Palettes  |
+----------------------+          +--------------------+
```

1.  **Core Agent Team (`Aetheria_AI`):** Initiated via `get_llm_os()` in [assistant.py](file:///c:/Users/prajw/Downloads/app/AI-OS/python-backend/assistant.py). Runs the main `mimo-v2.5` model and holds reference context.
2.  **Specialist Sub-Agents:**
    *   **Platform Operations (`assistant`):** Instantiated to perform GitHub repository commits, deploy to Vercel, or configure Supabase storage folders.
    *   **PowerPoint Specialist (`presentation_agent`):** Created using `build_presentation_agent()`. Builds native `.pptx` decks using shape and font layout libraries instead of standard text outputs.
3.  **Real-Time Sub-Agent Delegation:**
    *   **`delegate_to_coder`:** Starts the coder agent (`get_coder_agent()`) which interacts directly with files inside the secure Docker sandbox.
    *   **`delegate_to_computer`:** Starts the computer agent (`get_computer_agent()`) to interact with client-side operating systems or browsers.

---

## 🔄 Agent Execution & Context Building Flow

When a user prompt enters `run_agent_and_stream()` in [agent_runner.py](file:///c:/Users/prajw/Downloads/app/AI-OS/python-backend/agent_runner.py), the execution pipeline performs the following steps:

### Step 1: Session Recovery
The system queries Redis using `connection_manager.get_session(conversation_id)` to recover the user ID and session configuration.

### Step 2: Context Bootstrapping
If running in Coder mode, `_ensure_project_workspace_bootstrap()` is invoked. This check confirms that files for the active deployment are checked out inside the sandbox container. If they are missing, it downloads them from Supabase storage and copies them in.

### Step 3: Historical Thread Compilation
To maintain long-term chat memory, the runner queries the Supabase `agno_sessions` table for the current `conversation_id`. It parses previous chat runs, compiles them into a markdown text block, and prepends this history to the user's prompt as a `CONTEXT FROM PREVIOUS CHATS` block.

### Step 4: Instantiation & Dependency Injection
The agent team is initialized. An ephemeral dictionary `realtime_tool_config` is injected containing active connection parameters (like `socketio`, `sid`, `message_id`, and `redis_client`). This allows tools like browser controllers to communicate directly with the user.

### Step 5: Streaming Loop
The runner calls `agent.run(final_user_message, stream=True)`. It iterates through the streaming generator, emitting `reasoning_step` updates (thinking process), `agent_step` notifications (tool actions), and `response` chunks (text outputs) to the websocket room.

---

## 📊 Token Logging & Convex Sync

Tracking model usage is critical for user token billing. AI-OS implements a redundant token logging process:

1.  **Direct Read:** Upon completion, the runner checks the returned `TeamRunOutput` for token metrics.
2.  **Fallback Aggregation:** If the output is empty, `_extract_metrics_from_agno_session()` queries the `agno_sessions` table in Supabase. It reconstructs the run execution tree, resolving parent-child run IDs to calculate the cumulative sum of input and output tokens.
3.  **Convex Recording:** The extracted metrics are sent to `convex_usage_service.record_token_usage()`. This logs the exact usage window, billing period, and token counts to the Convex database.
