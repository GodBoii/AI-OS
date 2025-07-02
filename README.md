# Aetheria AI-OS

> An advanced, feature-rich AI desktop assistant built with Electron and Python

Aetheria functions as a personal AI Operating System, designed to understand user needs and leverage a powerful suite of tools, integrations, and specialized AI agents to fulfill them effectively.


## ✨ Key Features

### 🤖 Modular Agentic Architecture
Built on the **agno framework**, Aetheria uses a primary orchestrator agent that delegates complex tasks to a team of specialized sub-agents:
- **Coding Assistant** - Handle development tasks
- **Investment Assistant** - Manage financial queries
- **And more specialized agents**

### 🔧 Rich Toolset & Integrations

| Integration | Capabilities |
|-------------|-------------|
| **GitHub** | List repositories, read file content, create issues, manage pull requests |
| **Google Suite** | Search/read Google Drive files, Gmail search/read/send |
| **Internet Search** | Access up-to-date web information |
| **Web Crawler** | Extract and summarize content from any URL |

### 🏃‍♂️ Advanced Capabilities

- **🔒 Stateful Sandbox** - Secure, isolated environment for code execution with persistent state
- **🧠 Long-Term Memory** - Store and recall information across sessions with manual context selection
- **🔐 Secure Authentication** - Supabase-managed user accounts with OAuth flows
- **🎨 Advanced UI with Artifact Viewer** - Clean chat interface with separate rendering for complex outputs
- **📁 File Uploads & Multimodality** - Support for text, images, and various file types

## 🏛️ Architecture Overview

```
┌─────────────────────┐    IPC    ┌──────────────────────┐    WebSocket    ┌────────────────────────┐
│  🖥️ Electron         │◄────────►│  ⚙️ Node.js          │◄──────────────►│  🐍 Python Backend    │
│  Frontend           │           │  Main Process        │                 │  (Flask)               │
│  (UI/UX)            │           │  (Window & OS Mgmt)  │                 │  (AI Agents & Tools)   │
└─────────────────────┘           └──────────────────────┘                 └────────────────────────┘
           │                                 │                                          │
           └─────────────────────────────────┼──────────────────────────────────────────┘
                                             │
                                    ┌────────▼────────┐
                                    │  ☁️ Supabase     │
                                    │  (Auth, DB,     │
                                    │   Storage)      │
                                    └─────────────────┘
```

### Component Breakdown

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Electron Frontend** | HTML5, CSS3, JavaScript | User interface and interactions |
| **Node.js Main Process** | Electron.js, Node.js | Window management and secure bridging |
| **Python Backend** | Flask, Socket.IO | AI agents and tool execution |
| **Supabase** | PostgreSQL, Auth, Storage | Data persistence and authentication |

## 🛠️ Technology Stack

<table>
<tr>
<th>Frontend</th>
<th>Main Process</th>
<th>Backend</th>
<th>Database & Services</th>
</tr>
<tr>
<td>

- HTML5
- CSS3
- JavaScript (ES6+)
- marked.js
- highlight.js
- mermaid.js
- dompurify

</td>
<td>

- Node.js
- Electron.js
- python-socketio
- eventlet

</td>
<td>

- Python 3.10+
- Flask
- agno (AI Framework)
- PyGithub
- google-api-python-client

</td>
<td>

- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Storage

</td>
</tr>
</table>

## 🚀 Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- [ ] **Node.js** (v18 or later) and npm
- [ ] **Python** (v3.10 or later) and pip
- [ ] **Supabase account** (free tier is sufficient)
- [ ] **GitHub OAuth Application** for GitHub integration
- [ ] **Google Cloud Platform Project** with Gmail API and Google Drive API enabled

### 1. 🗄️ Supabase Setup

#### Create a Supabase Project
1. Go to your [Supabase dashboard](https://supabase.com/dashboard)
2. Create a new project

#### Run the Database Schema
1. Navigate to the **SQL Editor** in your Supabase project dashboard
2. Copy the entire content of the `supabase.md` file
3. Paste it into the SQL editor and click **Run**

#### Enable Third-Party Providers
1. Go to **Authentication** → **Providers**
2. Enable and configure:
   - **GitHub provider** using your OAuth app credentials
   - **Google provider** using your OAuth app credentials
3. Add the Supabase Redirect URL to your OAuth app configurations

#### Get API Keys
Navigate to **Project Settings** → **API** and collect:
- Project URL
- anon (public) key
- service_role (secret) key

### 2. 🐍 Backend Setup

#### Clone the Repository
```bash
git clone https://github.com/your-username/aetheria-ai-os.git
cd aetheria-ai-os
```

#### Set up Python Virtual Environment
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

#### Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. 🖥️ Frontend Setup

#### Install Node.js Dependencies
```bash
npm install
```

## ⚙️ Configuration

Create a `.env` file in the project's root directory:

```env
# Supabase Credentials
SUPABASE_URL="YOUR_SUPABASE_PROJECT_URL"
SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_PUBLIC_KEY"
SUPABASE_SERVICE_KEY="YOUR_SUPABASE_SERVICE_ROLE_SECRET_KEY"

# Database URL for SQLAlchemy
DATABASE_URL="postgresql+psycopg2://postgres:[YOUR-PASSWORD]@[YOUR-DB-HOST]:5432/postgres"

# Google OAuth Credentials
GOOGLE_CLIENT_ID="YOUR_GOOGLE_CLIENT_ID"
GOOGLE_CLIENT_SECRET="YOUR_GOOGLE_CLIENT_SECRET"

# GitHub OAuth Credentials
GITHUB_CLIENT_ID="YOUR_GITHUB_CLIENT_ID"
GITHUB_CLIENT_SECRET="YOUR_GITHUB_CLIENT_SECRET"

# Flask Configuration
FLASK_SECRET_KEY="a_strong_random_secret_key_here"

# Sandbox API URL (if running separately)
SANDBOX_API_URL="http://127.0.0.1:8000"

# Debug Mode
DEBUG="True"
```

## ▶️ Running the Application

You need to run both the backend server and the Electron application:

### Terminal 1: Start Python Backend
```bash
# Activate virtual environment
source venv/bin/activate

# Run Flask application
flask --app app.py run --port 5001
```

### Terminal 2: Start Electron App
```bash
npm start
```

## 🤝 Contributing

We welcome contributions! Here's how to get started:

### Steps to Contribute

1. **Fork** the repository
2. **Create** a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make** your changes with clear, descriptive commit messages
4. **Push** to your forked repository:
   ```bash
   git push origin feature/your-feature-name
   ```
5. **Submit** a pull request to the main repository's `main` branch

### Guidelines

- Ensure your code adheres to the existing style
- Address security considerations for sensitive data changes
- Include tests for new features when applicable

## 📄 License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **[agno framework](https://github.com/agno-ai/agno)** - Powers our agentic architecture
- **[Electron](https://www.electronjs.org/)** - Cross-platform desktop app framework
- **[Flask](https://flask.palletsprojects.com/)** - Python web framework
- **[Supabase](https://supabase.com/)** - Open source Firebase alternative

---

<div align="center">

**[⭐ Star this repo](https://github.com/your-username/aetheria-ai-os)** • **[🐛 Report Bug](https://github.com/your-username/aetheria-ai-os/issues)** • **[💡 Request Feature](https://github.com/your-username/aetheria-ai-os/issues)**

Made with ❤️ by the Aetheria Team

</div>