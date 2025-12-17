# AI-OS (Aetheria AI)

**Aetheria AI** (AI-OS) is an advanced, agentic desktop operating system designed to bridge the gap between Large Language Models (LLMs) and real-world execution. Unlike standard chatbots, AI-OS acts as a **system operator**—capable of browsing the web, managing files, executing code in secure sandboxes, and interacting with third-party services like GitHub, Google Drive, and Vercel.

Designed for developers and power users, it features a **local-first philosophy** with a **Neo-Brutalist** aesthetic, ensuring both performance and style.

---

## 🏗 High-Level Architecture

The system is built on a decoupled, event-driven architecture that separates the user interface from the intelligence layer. This ensures the frontend remains responsive while the backend handles heavy computation and long-running tasks.

```mermaid
graph TD
    subgraph Frontend ["🖥️ Frontend (Electron)"]
        UI[User Interface]
        SocketClient[Socket.IO Client]
    end

    subgraph Backend ["🧠 Backend (Python)"]
        Flask[Flask Server]
        AgentRunner[Agent Runner]
        Tools[Tool Manager]
    end

    subgraph Infrastructure ["⚙️ Infrastructure (Docker)"]
        Redis[(Redis Cache/Queue)]
        Sandbox[Docker Sandbox]
        SandboxMgr[Sandbox Manager]
    end

    subgraph External ["☁️ External Services"]
        Supabase[(Supabase DB)]
        LLM[LLM APIs (OpenAI/Groq)]
    end

    UI -->|Events| SocketClient
    SocketClient <-->|Socket.IO| Flask
    Flask -->|Tasks| AgentRunner
    AgentRunner -->|Queries| LLM
    AgentRunner -->|State| Supabase
    AgentRunner -->|Queue| Redis
    AgentRunner -->|Uses| Tools
    Tools -->|Execute Code| SandboxMgr
    SandboxMgr -->|Run| Sandbox
```

### Core Components

1.  **Frontend (Electron + React/Vanilla JS)**
    *   **Role**: The user interface and visual presentation layer.
    *   **Tech Stack**: Electron, Vanilla JS/HTML/CSS (no heavy framework bloat), Supabase Client, Socket.IO Client.
    *   **Design**: Custom Neo-Brutalist design system with high-contrast visuals and "God Mode" aesthetics.
    *   **Responsibility**: Captures user input, renders real-time AI streaming responses, handles voice input, and displays tool execution statuses.

2.  **Backend (Python + Flask)**
    *   **Role**: The "Brain" and orchestrator.
    *   **Tech Stack**: Python 3.11, Flask, Flask-SocketIO, Gunicorn, Eventlet.
    *   **Responsibility**: Manages AI agents, routes requests, handles authentication, and maintains persistent connections with the frontend.

3.  **Agentic Layer (Agno Framework)**
    *   **Role**: The intelligence engine.
    *   **Tech Stack**: Agno (v2.0.5), Phidata, LLM APIs (OpenAI, Gemini, Groq).
    *   **Responsibility**:
        *   Parses user intent.
        *   Selects appropriate tools (Browser, FileSystem, Shell).
        *   Manages memory and session context.

4.  **Tooling & Sandbox**
    *   **Role**: The "Hands" of the system.
    *   **Secure Sandbox**: A Dockerized Ubuntu environment (`Dockerfile.sandbox`) where the AI executes generated code safely, isolated from the host OS.
    *   **Native Tools**: A suite of Python modules (`browser_tools.py`, `github_tools.py`) that allow the AI to interact with the outside world.

5.  **Data & State**
    *   **Database**: Supabase (PostgreSQL) for user data, sessions, and chat history.
    *   **Queue/Cache**: Redis (via Docker) for task queues (Celery) and caching.
    *   **Background Workers**: Celery workers handle long-running deep research or scrape tasks.

---

## 🔄 Execution Flow

When a user submits a request (e.g., *"Clone this repo and analyze the README"*):

1.  **Input**: The Frontend sends the message via **Socket.IO** to the Backend (`sockets.py`).
2.  **Orchestration**: The `agent_runner.py` receives the event and initializes the Agno Agent with the user's session context.
3.  **Reasoning**: The Agent analyzes the request and decides to use the `GithubTool` and `FileSystemTool`.
4.  **Execution Options**:
    *   **Direct**: Standard API calls (e.g., searching Google) happen within the backend process.
    *   **Sandboxed**: If code execution is needed, the backend instructs the **Docker Sandbox** to run the script and captures the `stdout`/`stderr`.
5.  **Response**: The Agent streams the thought process and final response back to the Frontend via WebSocket chunks.
6.  **Rendering**: The Frontend parses the markdown, renders code blocks with `highlight.js`, and updates the chat UI.

---

## 🛠 Component Breakdown

### Backend (`/python-backend`)
*   `app.py`: Application entry point and factory.
*   `assistant.py`: Defines the core AI assistant logic and tool binding.
*   `*_tools.py`: Specialized modules for capabilities (Browser, GitHub, Vercel, etc.).
*   `celery_app.py`: Configuration for background task processing.
*   `sandbox_manager/`: Logic for managing Docker containers.

### Frontend (`/`)
*   `main.js`: Electron main process configuration.
*   `js/`: Client-side logic for socket handling, UI updates, and Supabase interaction.
*   `css/`: Custom styling (Neo-Brutalist theme).

### Infrastructure (`/`)
*   `docker-compose.yml`: Orchestrates Redis, Sandbox, and other services.
*   `Dockerfile`: Builds the production backend image.

---

## 🚀 Setup & Installation

### Prerequisites
*   **Docker Desktop** (Required for Redis and Sandbox)
*   **Python 3.11+**
*   **Node.js 18+**
*   **Supabase Account**

### 1. Repository Setup
```bash
git clone https://github.com/GodBoii/AI-OS.git
cd AI-OS
```

### 2. Environment Configuration
Create a `.env` file in `python-backend/` (and root if needed) with the following content:

```ini
# Core
FLASK_SECRET_KEY=your_secure_random_key
DATABASE_URL=your_supabase_postgres_url
REDIS_URL=redis://localhost:6379/0
SANDBOX_API_URL=http://localhost:8000 # If running sandbox separately

# LLM Providers (At least one required)
OPENAI_API_KEY=sk-...
GROQ_API_KEY=...
GOOGLE_API_KEY=...

# Optional Integrations
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
SUPABASE_URL=...
SUPABASE_KEY=...
```

### 3. Backend Setup
```bash
cd python-backend
python -m venv venv
# Windows
.\venv\Scripts\activate
# Mac/Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 4. Infrastructure (Docker)
You have two options: run everything in Docker, or run services in Docker and code locally.

**Option A: Full Docker Deployment (Recommended)**
```bash
docker-compose up --build
```
This starts the Backend, Redis, Flower (Task Monitor), and Sandbox Manager automatically. The API will be available at `http://localhost:8765`.

**Option B: Hybrid (Local Code / Docker Services)**
Use this if you are actively editing the Python code.
```bash
# Start infrastructure only
docker-compose up -d redis sandbox-manager
```

### 5. Running the Application (Hybrid Mode)

**Terminal 1: Backend**
```bash
# Inside python-backend/
python app.py
```

**Terminal 2: Frontend (Electron)**
```bash
# Root directory
npm install
npm start
```

---

## 🧠 Design Principles

1.  **Security by Design**: Arbitrary code execution is strictly limited to the **Docker Sandbox**. The AI cannot accidentally delete files on your host machine unless explicitly allowed via specific tools.
2.  **Stateless Intelligence, Stateful Context**: The backend is designed to be stateless (Flask), but sessions are persisted in Supabase to allow long-term memory across restarts.
3.  **Real-Time Feedback**: Users should never guess if the AI is stuck. Thinking states, tool usage, and errors are streamed instantly via WebSockets.
4.  **Aesthetics Matter**: A tool you use all day should look good. The UI focuses on high readability and strong visual hierarchy.

---

## ⚠️ Limitations & Future Roadmap

*   **Sandboxing**: Currently relies on local Docker. Future versions may support remote execution environments (e.g., E2B).
*   **Context Window**: Limited by the underlying LLM provider. Large file analysis is handled via RAG (Retrieval-Augmented Generation) but has upper bounds.
*   **Vision**: Multimodal capabilities are dependent on the model (e.g., GPT-4o or Gemini 1.5 Pro).
*   **Platform**: Primarily tested on Windows. Mac/Linux support is theoretical via Electron/Docker but may need minor path adjustments.

---

*Documentation auto-generated by **Antigravity** based on codebase analysis.*
