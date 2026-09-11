# Frontend Architecture & Client-Side Flow

This document details the structure of the AI-OS user interface and how client-side Javascript manages active sessions, streaming streams, and interactive widget components.

---

## 📂 Core Client-Side Modules

The frontend is constructed using a vanilla JavaScript component system that binds interactive HTML controls directly to the application state:

*   **[aios.js](file:///c:/Users/prajw/Downloads/app/AI-OS/js/aios.js)**
    *   *Role:* The primary window application class. Handles initial setup, layout panels (switching between main Chat, Computer Control, and Project Workspace modes), account profile panels, subscription billing triggers, and Electron main-process IPC listening.
*   **[chat.js](file:///c:/Users/prajw/Downloads/app/AI-OS/js/chat.js)**
    *   *Role:* The central chat engine. Operates the Socket.IO connection, routes incoming stream packets to active text containers, maintains background conversation stacks, and converts tool response records into custom preview panels.
*   **[artifact-handler.js](file:///c:/Users/prajw/Downloads/app/AI-OS/js/artifact-handler.js)**
    *   *Role:* Detects file modifications inside the sandboxed filesystem and displays sandboxed artifact panels (live HTML pages, charts, tables) side-by-side with the chat.
*   **[context-handler.js](file:///c:/Users/prajw/Downloads/app/AI-OS/js/context-handler.js)**
    *   *Role:* Gathers system environment metrics (active folder path, browser status, shell environment variables) and bundles them into payload context objects appended to each user prompt.
*   **[project-workspace.js](file:///c:/Users/prajw/Downloads/app/AI-OS/js/project-workspace.js)**
    *   *Role:* Visual controller for the developer workspace panel. Synchronizes workspace directory trees, tracks deployment targets (Vercel/GitHub), and boots sandbox sync tools.

---

## 🔄 Lifecycle of a Streaming Message

When a websocket stream delivers response segments to the browser, the data moves through the following processing pipeline inside [chat.js](file:///c:/Users/prajw/Downloads/app/AI-OS/js/chat.js):

```
                       +-------------------------------+
                       |  Receive Socket "response"    |
                       +---------------+---------------+
                                       |
                                       v
                       +-------------------------------+
                       |  Resolve Target Thread Div    |
                       |  (Using payload.messageId)    |
                       +---------------+---------------+
                                       |
                        Is it a log stream?
                        /               \
                     YES                 NO
                     /                     \
       +------------v------------+     +----v--------------------+
       |  Render Tool Log Bubble |     |  Append Content Chunks  |
       |  (Temporary inline)     |     |  to Message Content Div |
       +-------------------------+     +------------+------------+
                                                    |
                                                    v
                                       +------------+------------+
                                       |  Execute Markdown Parse |
                                       |  & Code Syntax Highlight|
                                       +------------+------------+
                                                    |
                                                    v
                                       +------------+------------+
                                       |  Run Auto-Scroll Checks |
                                       |  (If user isn't scrolled|
                                       |   manually upward)      |
                                       +-------------------------+
```

1.  **Placement:** An output block `div` is instantiated inside the active `conversation-thread` when a prompt is sent.
2.  **Streaming Content:** The backend streams text blocks via the `response` event. The client updates the text element, passes the text to the `messageFormatter` to convert markdown to HTML, and highlights syntax blocks via `highlight.js`.
3.  **Intermediate Step Logs:** Agent reasoning or platform sub-agent logs are streamed with `is_log: true`. These are styled as secondary, collapsible text areas in the conversation panel to avoid cluttering the main conversation thread.
4.  **Completion:** Upon receiving a packet with `done: true`, the stream state is resolved, copy/action controls are injected, and cached thread structures are synchronized.

---

## 📈 Tool Preview Card Parsing

Rather than rendering raw JSON tool outputs, [chat.js](file:///c:/Users/prajw/Downloads/app/AI-OS/js/chat.js) intercepts specific tool metadata using `getComputerToolMetadata()` and generates rich visual representations:

*   **Google Sheets:**
    *   *Trigger:* Tool outputs containing `google_sheets_tool_output` metadata.
    *   *Rendering:* Displays active spreadsheet names, sheet lists with row/column indexes, and renders actual database tables (using `buildSheetsTableMarkup()`) directly inside the chat.
*   **PowerPoint Presentation Decks:**
    *   *Trigger:* Tool outputs containing `presentation_tool_output` metadata.
    *   *Rendering:* Generates slide thumbnails utilizing HSL presentation palette variables (using `buildPresentationMarkup()`) and shows slide titles, metrics badges, and bullet points.

---

## ⏳ Background Conversation Queuing

Because the system allows users to run multiple agent prompts concurrently, [chat.js](file:///c:/Users/prajw/Downloads/app/AI-OS/js/chat.js) features a background task management queue:

```
                    +------------------------------------+
                    |  User switches conversation thread  |
                    |  while active run is processing    |
                    +-----------------+------------------+
                                      |
                                      v
                    +-----------------+------------------+
                    |  Current thread enters Background  |
                    |  State & creates Sidebar Button    |
                    +-----------------+------------------+
                                      |
                             Check run status
                            /                \
                       RUNNING              COMPLETED
                         /                      \
            +-----------v-----------+      +-----v-----------------+
            |  Pulsing Brain Icon   |      |  Green Checkmark      |
            |  (.bc-btn-running)    |      |  (.bc-btn-completed)  |
            +-----------------------+      +-----------------------+
```

1.  **State Shift:** When the user switches to a different conversation while an active model runner is processing, the active conversation ID is logged into the `queuedConversations` map.
2.  **Visual Stack:** The `getBackgroundConversationContainer()` logic creates a sidebar stack container (`#background-chat-stack`). A brain icon button is generated for each background session.
3.  **Active Indicators:**
    *   **Processing:** The button is set to `.background-chat-btn-running` with a pulsing brain icon.
    *   **Finished:** Once the backend emits `run_completed` via socket, the button toggles to `.background-chat-btn-completed` with a green checkmark check-double icon.
4.  **Re-activation:** Clicking a background button triggers `switchConversation(id)`, swapping the thread visibility, restoring layout variables, and cleaning up that conversation's queue button.
