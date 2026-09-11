# AI-OS Context Directory Overview

Welcome to the AI-OS developer context directory. When maintaining, extending, or refactoring the AI-OS (Aetheria AI) codebase, modifying existing components can introduce regressions if system dependencies and runtime flows are not fully understood. 

This directory serves as a living, comprehensive developer map of the codebase, outlining:
1. System architecture and network messaging flows.
2. Frontend window, chat state, and cache lifecycles.
3. Backend agent orchestration and execution.
4. Docker container sandbox management.
5. System-wide code dependency paths and modification guidelines.

---

## 🗺️ Documentation Directory Index

To get a complete understanding of how the system works under the hood, explore these files:

*   **[01-ARCHITECTURE-AND-COMMUNICATION.md](file:///c:/Users/prajw/Downloads/app/AI-OS/context/01-ARCHITECTURE-AND-COMMUNICATION.md)**
    *   *Focus:* High-level decoupled architecture layers, technical stacks, Socket.IO duplex event channels, and Redis Pub/Sub task queue pathways.
*   **[02-FRONTEND-ARCHITECTURE.md](file:///c:/Users/prajw/Downloads/app/AI-OS/context/02-FRONTEND-ARCHITECTURE.md)**
    *   *Focus:* Client-side Electron shell execution, Vanilla JS controller classes, streaming markdown renderers, and background conversation managers.
*   **[03-BACKEND-AND-AGENT-WORKFLOW.md](file:///c:/Users/prajw/Downloads/app/AI-OS/context/03-BACKEND-AND-AGENT-WORKFLOW.md)**
    *   *Focus:* Python server runtime structure, Agno AI engine integration, session bootstrapping, token metrics processing, and target execution logic.
*   **[04-SANDBOX-AND-EXECUTION-ENVIRONMENT.md](file:///c:/Users/prajw/Downloads/app/AI-OS/context/04-SANDBOX-AND-EXECUTION-ENVIRONMENT.md)**
    *   *Focus:* Secure Docker workspace initialization, filesystem tool execution, output parsing, and dynamic artifact extraction pipelines.
*   **[05-DEPENDENCY-AND-IMPACT-GUIDELINES.md](file:///c:/Users/prajw/Downloads/app/AI-OS/context/05-DEPENDENCY-AND-IMPACT-GUIDELINES.md)**
    *   *Focus:* Code change impact mapping, upstream caller lookup points, and a developer matrix mapping how backend adjustments ripple into frontend layout updates.

---

## 🏗️ High-Level System Map

The application splits its responsibilities across three decoupled layers:

```
+--------------------------------------------------------+
|                      FRONTEND                          |
|             (Electron + HTML + CSS + JS)               |
|                                                        |
|   - Captures User Chat & Context Inputs                |
|   - Renders Streams & Tool Execution Stages            |
|   - Displays Sandboxed HTML/CSS Artifact Previews      |
+---------------------------^----------------------------+
                            |
                 HTTP REST  |  Socket.IO
                 Endpoints  |  Duplex Streams
                            |
+---------------------------v----------------------------+
|                       BACKEND                          |
|               (Python + Flask + Gunicorn)              |
|                                                        |
|   - Orchestrates Agno AI Multi-Agent Teams             |
|   - Manages Session States and DB Context (Supabase)   |
|   - Tracks Token Metrics & Processes User Vaults       |
+---------------------------^----------------------------+
                            |
                            |  Docker REST API
                            |  & HTTP Calls
                            |
+---------------------------v----------------------------+
|                   DOCKER SANDBOX                       |
|           (Sandbox Manager + Ubuntu Image)            |
|                                                        |
|   - Isolated Filesystem Workspace                      |
|   - Runs Generated Code and Command Outputs            |
|   - Triggers Artifact Parsing pipelines                |
+--------------------------------------------------------+
```

Before committing any modifications to code paths in the backend or frontend, consult the respective module document to trace the exact dependencies of the functions you are targeting.
