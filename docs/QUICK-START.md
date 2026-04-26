# Quick Start Guide

Get up and running with Aetheria AI in 5 minutes!

---

## Step 1: Install (2 minutes)

### Windows
1. Download `Aetheria.AI.Setup.exe` from [GitHub Releases](https://github.com/GodBoii/AI-OS-website/releases)
2. Run the installer
3. Launch from Start Menu

### macOS
1. Download `Aetheria.AI.dmg` from [GitHub Releases](https://github.com/GodBoii/AI-OS-website/releases)
2. Drag to Applications
3. Launch from Applications

### Linux
```bash
# AppImage
wget https://github.com/GodBoii/AI-OS-website/releases/download/v1.1.0/Aetheria.AI-1.1.0.AppImage
chmod +x Aetheria.AI-1.1.0.AppImage
./Aetheria.AI-1.1.0.AppImage
```

---

## Step 2: Create Account (1 minute)

1. Click **"Sign Up"**
2. Enter email and password
3. Verify email (check spam)
4. Log in

---

## Step 3: Configure API Keys (1 minute)

1. Click ⚙️ **Settings** in sidebar
2. Go to **Account** tab
3. Add at least one API key:
   - **OpenAI**: For GPT models
   - **Groq**: For fast inference (recommended)
   - **Google**: For Gemini models
4. Click **Save**

**Get API Keys:**
- OpenAI: [platform.openai.com](https://platform.openai.com)
- Groq: [console.groq.com](https://console.groq.com)
- Google: [makersuite.google.com](https://makersuite.google.com)

---

## Step 4: Try Your First Commands (1 minute)

### Basic Chat
```
"Hello! What can you help me with?"
```

### Web Search
```
"Search for the latest news about AI"
```

### Code Execution
```
"Create a Python script that generates 10 random numbers and sorts them"
```

### File Operations
```
"Create a JSON file with sample user data"
```

---

## Step 5: Explore Features

### Enable Computer Control (Desktop Only)
1. Go to Settings → **Capabilities**
2. Find **"System Automation"**
3. Click **"Enable"**
4. Grant permissions when prompted

**Try it:**
```
"Take a screenshot and describe what you see"
```

### Connect GitHub
1. Go to Settings → **Integrations**
2. Click **"Connect GitHub"**
3. Authorize the app

**Try it:**
```
"List my GitHub repositories"
"Clone the React repository"
```

### Connect Google Services
1. Go to Settings → **Integrations**
2. Click **"Connect Google"**
3. Select services (Gmail, Drive, Sheets)
4. Authorize the app

**Try it:**
```
"Check my unread emails"
"List files in my Google Drive"
```

---

## Common Use Cases

### 1. Software Development
```
"Create a REST API with Flask that has user authentication"
"Deploy my Next.js app to Vercel"
"Fix the bug in my authentication code"
```

### 2. Web Automation
```
"Go to Hacker News and get the top 10 stories"
"Fill out the contact form on example.com"
"Extract all product prices from this e-commerce site"
```

### 3. Research & Analysis
```
"Research quantum computing and create a summary"
"Analyze this CSV file and create visualizations"
"Compare the features of React vs Vue"
```

### 4. Desktop Automation
```
"Organize my Downloads folder by file type"
"Find all PDFs and create a list with their titles"
"Open VS Code and create a new Python project"
```

### 5. Deployment
```
"Create a blog with Next.js and deploy it"
"Deploy my React app to Vercel with custom domain"
"Set up a Cloudflare Worker for my API"
```

---

## Tips for Best Results

### 1. Be Specific
❌ "Make a website"
✅ "Create a portfolio website with React, including a hero section, about page, and contact form"

### 2. Break Down Complex Tasks
❌ "Build a full e-commerce platform"
✅ "First, create the product listing page with filtering"

### 3. Provide Context
❌ "Fix the bug"
✅ "Fix the authentication bug where users can't log in after password reset"

### 4. Use Project Workspace for Coding
1. Click **"Project Workspace"** in sidebar
2. Start a new project or clone from GitHub
3. Agent has full context of your project

### 5. Attach Files for Context
- Drag and drop files into chat
- Agent can read and understand them
- Supports code, documents, images, etc.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + N` | New chat |
| `Ctrl/Cmd + K` | Focus search |
| `Ctrl/Cmd + ,` | Open settings |
| `Ctrl/Cmd + Enter` | Send message |
| `Ctrl/Cmd + /` | Toggle sidebar |
| `Esc` | Stop agent |

---

## Understanding Agent Modes

### Default Mode (Reasoning Agent)
- General-purpose conversations
- Web search and research
- Planning and coordination
- Delegates to specialists

**Use for:** General questions, research, planning

### Coder Mode (Development Agent)
- Software development
- Code execution
- GitHub operations
- Deployments

**Use for:** Building apps, fixing bugs, deploying

### Computer Mode (Computer Agent)
- Desktop automation
- Browser control
- File operations
- Email and documents

**Use for:** Desktop tasks, automation, browser work

**Switching Modes:**
- Automatic based on context
- Or use Project/Computer Workspace

---

## Troubleshooting

### "Cannot connect to backend"
1. Check internet connection
2. Restart the app
3. Check firewall settings

### "Sandbox execution failed"
1. Ensure Docker is installed (for local development)
2. Check Settings → Capabilities
3. Try again in a few seconds

### "Authentication failed"
1. Verify email
2. Check password
3. Clear cache and try again

### "API key invalid"
1. Verify key is correct
2. Check key has credits
3. Try a different provider

---

## Getting Help

- **Documentation**: Full docs in the `docs/` folder
- **GitHub**: [Report issues](https://github.com/GodBoii/AI-OS-website/issues)
- **Email**: aetheriaai1@gmail.com
- **In-App**: Settings → Support

---

## Next Steps

Now that you're set up:

1. **[Read the User Guide](04-USER-GUIDE.md)** - Comprehensive usage guide
2. **[Explore Features](05-FEATURES.md)** - Detailed feature documentation
3. **[Check Examples](04-USER-GUIDE.md#examples)** - Real-world use cases
4. **[Learn Architecture](02-ARCHITECTURE.md)** - Understand how it works

---

## Welcome to Aetheria AI! 🚀

You're now ready to experience the future of AI interaction. Start with simple commands and gradually explore more advanced features.

**Pro Tip:** The agent learns from your interactions. The more you use it, the better it understands your preferences and workflow.

---

*Last Updated: April 18, 2026*
