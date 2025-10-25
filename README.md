# Aetheria AI-OS

> An advanced, production-ready AI desktop assistant built with Electron and Python, featuring a hierarchical multi-agent system powered by the Agno framework

Aetheria AI-OS is a sophisticated personal AI Operating System that intelligently orchestrates specialized AI agents and integrations to handle complex, multi-step tasks through natural conversation.

---

## 🌟 Key Features

### 🤖 Hierarchical Multi-Agent Architecture

Built on **Agno v2.0.7**, Aetheria employs a strategic planner that coordinates specialized agents:

- **Planner Agent** - Analyzes complex queries and creates execution plans using DeepSeek R1
- **Development Team** - Handles coding, testing, and sandbox execution with Gemini 2.5 Flash
- **World Agent** - Accesses Wikipedia, ArXiv, HackerNews, YFinance, and web crawling
- **Main Orchestrator (Aetheria AI)** - Routes tasks and synthesizes results using Gemini 2.5 Flash

### 🔧 Comprehensive Integration Ecosystem

| Integration | Capabilities |
|-------------|-------------|
| **GitHub** | Repository management, file operations, PR/issue handling, branch management, multi-file commits |
| **Google Gmail** | Read, send, search, reply to emails, manage labels |
| **Google Drive** | Search, read, create, share files and documents |
| **Vercel** | Project management, deployments, environment variables, domains, teams |
| **Supabase** | Organization and project management, storage buckets, edge functions |
| **Browser Automation** | Visual web interaction with Playwright-powered browser control |
| **Image Generation** | AI-powered image creation using Gemini 2.0 Flash |

### 🏃‍♂️ Advanced Capabilities

- **🔒 Stateful Docker Sandbox** - Secure, isolated code execution environment with persistent state across commands
- **🧠 Session-Based Memory** - Manual context selection from previous conversations for continuity
- **🔐 Supabase Authentication** - Secure user accounts with OAuth2 flows for GitHub, Google, Vercel, and Supabase
- **🎨 Artifact Viewer** - Dedicated viewer for code, diagrams (Mermaid), images, and browser screenshots
- **📁 Multimodal Support** - Process text, images, audio, video, PDFs, and documents
- **⚡ Real-Time Communication** - WebSocket-based streaming with Redis Pub/Sub for scalability
- **📊 Interactive Diagrams** - Pan, zoom, and interact with Mermaid diagrams
- **🌐 Visual Browser Control** - See and interact with web pages through the AI

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ELECTRON DESKTOP APP                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │   Chat UI    │  │  Artifact    │  │   Settings   │  │    Tasks    │ │
│  │   (HTML/CSS/ │  │   Viewer     │  │   (AIOS)     │  │   Manager   │ │
│  │   JavaScript)│  │              │  │              │  │             │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                  │                  │                  │        │
│         └──────────────────┴──────────────────┴──────────────────┘        │
│                                    │                                      │
│                              IPC (Secure)                                 │
│                                    │                                      │
│  ┌─────────────────────────────────▼────────────────────────────────┐   │
│  │              ELECTRON MAIN PROCESS (Node.js)                      │   │
│  │  • Window Management  • Deep Link Handler  • Python Bridge        │   │
│  └─────────────────────────────────┬────────────────────────────────┘   │
└────────────────────────────────────┼──────────────────────────────────────┘
                                     │
                            WebSocket (Socket.IO)
                                     │
┌────────────────────────────────────▼──────────────────────────────────────┐
│                       PYTHON BACKEND (Flask + Gunicorn)                   │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                    AETHERIA AI ORCHESTRATOR                        │  │
│  │                      (Gemini 2.5 Flash)                            │  │
│  │                                                                    │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │  │
│  │  │   Planner    │  │  Dev Team    │  │ World Agent  │           │  │
│  │  │  (DeepSeek)  │  │  (Gemini)    │  │  (Gemini)    │           │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘           │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                         TOOL ECOSYSTEM                           │    │
│  │  • GitHubTools        • GoogleEmailTools    • GoogleDriveTools  │    │
│  │  • VercelTools        • SupabaseTools       • BrowserTools      │    │
│  │  • SandboxTools       • ImageTools          • WebCrawler        │    │
│  │  • GoogleSearch       • Wikipedia           • ArXiv             │    │
│  │  • HackerNews         • YFinance                                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
         ┌──────────▼─────┐  ┌─────▼──────┐  ┌────▼─────────┐
         │  Redis Pub/Sub │  │  Supabase  │  │   Sandbox    │
         │  (Messaging)   │  │  (Auth/DB) │  │   Manager    │
         └────────────────┘  └────────────┘  └──────────────┘
                                                     │
                                              ┌──────▼──────┐
                                              │   Docker    │
                                              │  Containers │
                                              └─────────────┘
```

### Component Breakdown

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | Electron, HTML5, CSS3, Vanilla JS | Desktop UI, chat interface, artifact viewer, file handling |
| **Main Process** | Node.js, Electron IPC | Window management, deep link handling, Python bridge |
| **Backend API** | Flask, Socket.IO, Gunicorn + Eventlet | WebSocket server, agent orchestration, tool execution |
| **AI Framework** | Agno 2.0.7 | Multi-agent coordination, memory management, tool integration |
| **LLM Models** | Gemini 2.5 Flash, DeepSeek R1, Groq | Strategic planning, code generation, research |
| **Message Broker** | Redis Pub/Sub | Scalable real-time communication for browser tools |
| **Database** | Supabase (PostgreSQL) | User auth, session storage, integration tokens, run history |
| **Code Execution** | Docker + FastAPI Sandbox Manager | Isolated, secure command execution environment |
| **Storage** | Supabase Storage | Media uploads (images, audio, video, documents) |

---

## 🛠️ Technology Stack

### Frontend Technologies
- **Electron 37.2.6** - Cross-platform desktop framework
- **Vanilla JavaScript (ES6+)** - No framework dependencies
- **Marked.js** - Markdown rendering
- **Highlight.js** - Syntax highlighting
- **Mermaid.js** - Diagram rendering with pan/zoom
- **DOMPurify** - XSS protection
- **Socket.IO Client** - Real-time communication

### Backend Technologies
- **Python 3.11** - Core backend language
- **Flask 3.1.0** - Web framework
- **Flask-SocketIO 5.5.1** - WebSocket support
- **Gunicorn + Eventlet** - Production WSGI server
- **Agno 2.0.7** - AI agent framework
- **Redis 5.0.1** - Pub/Sub messaging
- **Celery 5.3.6** - Background task processing
- **Playwright** - Browser automation
- **FastAPI** - Sandbox manager API
- **Docker SDK** - Container management

### AI & ML
- **Google Gemini 2.5 Flash** - Main orchestrator and dev team
- **Google Gemini 2.0 Flash (Image Gen)** - Image generation
- **DeepSeek R1 Distill (Groq)** - Strategic planning
- **Gemini 2.5 Flash Lite** - World agent research

### Database & Storage
- **Supabase** - Backend-as-a-Service
- **PostgreSQL** - Relational database
- **Supabase Auth** - OAuth2 authentication
- **Supabase Storage** - File storage

### DevOps & Deployment
- **Docker & Docker Compose** - Containerization
- **Gunicorn** - Production server
- **Redis** - Caching and messaging
- **Flower** - Celery monitoring

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed:

- **Node.js** v18+ and npm
- **Python** 3.11+
- **Docker** and Docker Compose (for production deployment)
- **Redis** (or use Docker)
- **Supabase Account** (free tier works)

### API Keys Required

- **OpenAI API Key** (optional, for OpenAI models)
- **Groq API Key** (for DeepSeek R1)
- **Google AI API Key** (for Gemini models)
- **GitHub OAuth App** (for GitHub integration)
- **Google Cloud OAuth** (for Gmail/Drive)
- **Vercel OAuth** (optional, for Vercel integration)
- **Supabase OAuth** (optional, for Supabase integration)

---

## 📦 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/aetheria-ai-os.git
cd aetheria-ai-os
```

### 2. Backend Setup

#### Create Python Virtual Environment

```bash
cd python-backend
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate
```

#### Install Python Dependencies

```bash
pip install -r requirements.txt
```

#### Configure Environment Variables

Create a `.env` file in `python-backend/`:

```env
# === AI Model API Keys ===
OPENAI_API_KEY=sk-your-openai-key
GROQ_API_KEY=your-groq-key
GOOGLE_API_KEY=your-google-ai-key
ANTHROPIC_API_KEY=your-anthropic-key  # Optional
MISTRAL_API_KEY=your-mistral-key      # Optional

# === Supabase Configuration ===
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
DATABASE_URL=postgresql+psycopg2://postgres:password@host:5432/postgres

# === Redis Configuration ===
REDIS_URL=redis://localhost:6379/0

# === Celery Configuration ===
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0

# === Sandbox Manager ===
SANDBOX_API_URL=http://localhost:8000

# === OAuth Credentials ===
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

VERCEL_CLIENT_ID=your-vercel-client-id          # Optional
VERCEL_CLIENT_SECRET=your-vercel-client-secret  # Optional

SUPABASE_CLIENT_ID=your-supabase-client-id          # Optional
SUPABASE_CLIENT_SECRET=your-supabase-client-secret  # Optional

# === Flask Configuration ===
FLASK_SECRET_KEY=your-strong-random-secret-key
DEBUG=false
LOG_LEVEL=INFO
```

### 3. Supabase Database Setup

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Navigate to **SQL Editor**
3. Run the schema from `supabase.md` (if available) or create tables:
   - `profiles` - User profiles
   - `user_integrations` - OAuth tokens
   - `agno_sessions` - Conversation sessions
   - `agno_runs` - Agent run history
   - `request_logs` - Token usage tracking

4. Enable **Storage** bucket named `media-uploads` for file uploads

5. Configure **Authentication Providers**:
   - Enable Email/Password
   - Enable Google OAuth
   - Enable GitHub OAuth
   - Set redirect URLs to `aios://auth-callback`

### 4. Frontend Setup

```bash
# From project root
npm install
```

Update `js/config.js` with your backend URL:

```javascript
const config = {
    backend: {
        url: 'http://localhost:8765',  // Your backend URL
        maxReconnectAttempts: 50,
        reconnectDelay: 20000,
        connectionTimeout: 20000
    },
    supabase: {
        url: 'https://your-project.supabase.co',
        anonKey: 'your-anon-key'
    }
};
```

---

## ▶️ Running the Application

### Development Mode (Local)

#### Terminal 1: Start Redis (if not using Docker)

```bash
redis-server
```

#### Terminal 2: Start Sandbox Manager

```bash
cd sandbox_manager
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

#### Terminal 3: Start Python Backend

```bash
cd python-backend
source venv/bin/activate  # or venv\Scripts\activate on Windows
python app.py
```

#### Terminal 4: Start Electron App

```bash
npm start
```

### Production Mode (Docker)

See [DOCKER.md](DOCKER.md) for complete Docker deployment instructions.

```bash
# Build and start all services
docker-compose up --build -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

---

## 🎯 Usage Guide

### Basic Chat

1. **Start a Conversation**: Type your message in the input field
2. **Attach Files**: Click the paperclip icon to upload images, documents, PDFs
3. **Select Context**: Click the context icon to include previous conversations
4. **View Reasoning**: Expand the "Reasoning" section to see agent steps and tool usage

### Advanced Features

#### Code Execution

```
"Create a Python script that analyzes CSV data and generates a plot"
```

The dev team will:
1. Create the script in the sandbox
2. Execute it
3. Show you the output and any generated files

#### Web Research

```
"Find the latest research papers on quantum computing from ArXiv"
```

The World Agent will:
1. Search ArXiv
2. Summarize findings
3. Provide links to papers

#### GitHub Operations

```
"Create a new branch called 'feature/auth' in my repo 'myapp' and add a login.py file"
```

GitHub Tools will:
1. Create the branch
2. Commit the file
3. Confirm the operation

#### Image Generation

```
"Generate an image of a futuristic city at sunset"
```

Image Tools will:
1. Generate the image using Gemini 2.0
2. Display it in the artifact viewer
3. Allow you to download it

#### Browser Automation

```
"Go to example.com and click the login button"
```

Browser Tools will:
1. Navigate to the URL
2. Take a screenshot
3. Identify interactive elements
4. Perform the click action
5. Show you the result

### Artifact Viewer

The artifact viewer displays:
- **Code blocks** with syntax highlighting
- **Mermaid diagrams** with pan/zoom controls
- **Generated images** in full resolution
- **Browser screenshots** with element annotations

Click any artifact reference in the chat to reopen it.

---

## 🔧 Configuration

### Agent Configuration

Edit `python-backend/assistant.py` to customize:
- Model selection (Gemini, GPT-4, Claude, etc.)
- Agent instructions and behavior
- Tool availability
- Memory settings

### Tool Toggles

Users can enable/disable tools via the shuffle menu:
- **AI-OS Mode**: All tools enabled (default)
- **Deep Search Mode**: Research-focused tools only
- **Memory**: Enable conversation memory
- **Tasks**: Task management integration

---

## 🐳 Docker Deployment

For production deployment with Docker, see the comprehensive [DOCKER.md](DOCKER.md) guide which covers:

- Multi-service orchestration (Web, Redis, Celery, Flower, Sandbox Manager)
- Environment configuration
- Security best practices
- Monitoring and logging
- Troubleshooting
- Production optimizations

Quick start:

```bash
docker-compose up --build -d
```

Access services:
- **Web App**: http://localhost:8765
- **Flower (Celery Monitor)**: http://localhost:5555
- **Sandbox Manager**: http://localhost:8000

---

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Test thoroughly
5. Commit with clear messages: `git commit -m 'Add amazing feature'`
6. Push to your fork: `git push origin feature/amazing-feature`
7. Open a Pull Request

### Code Style

- **Python**: Follow PEP 8, use type hints
- **JavaScript**: Use ES6+, consistent naming
- **Comments**: Document complex logic
- **Tests**: Add tests for new features

### Areas for Contribution

- New tool integrations (Slack, Discord, etc.)
- Additional AI model support
- UI/UX improvements
- Documentation enhancements
- Bug fixes and optimizations

---

## 📄 License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- **[Agno Framework](https://github.com/agno-ai/agno)** - Powerful multi-agent AI framework
- **[Electron](https://www.electronjs.org/)** - Cross-platform desktop apps
- **[Flask](https://flask.palletsprojects.com/)** - Python web framework
- **[Supabase](https://supabase.com/)** - Open-source Firebase alternative
- **[Google Gemini](https://deepmind.google/technologies/gemini/)** - Advanced AI models
- **[DeepSeek](https://www.deepseek.com/)** - Reasoning-focused AI models

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/your-username/aetheria-ai-os/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-username/aetheria-ai-os/discussions)
- **Email**: support@aetheria-ai.com

---

<div align="center">

**[⭐ Star this repo](https://github.com/your-username/aetheria-ai-os)** • **[🐛 Report Bug](https://github.com/your-username/aetheria-ai-os/issues)** • **[💡 Request Feature](https://github.com/your-username/aetheria-ai-os/issues)**

Made with ❤️ by the Aetheria AI Team

</div>
