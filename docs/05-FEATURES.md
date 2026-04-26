# Features & Capabilities

## Overview

Aetheria AI provides a comprehensive suite of features that transform how you interact with AI. This document details all major features, their capabilities, and how to use them effectively.

---

## 1. Multi-Agent System

### Reasoning Agent

**Purpose:** Strategic planning and task coordination

**Capabilities:**
- Analyzes user intent and decomposes complex tasks
- Plans multi-step workflows
- Delegates specialized work to appropriate agents
- Synthesizes results from multiple sources
- Maintains conversation context and continuity

**Example Use Cases:**
```
"Research quantum computing, summarize findings, and create a presentation"
→ Plans: Search → Analyze → Synthesize → Generate slides

"Build a todo app with React and deploy it"
→ Plans: Design → Code → Test → Deploy
```

**Tools Available:**
- Web search (DuckDuckGo)
- Browser automation
- File management
- Agent delegation

---

### Development Agent (Coder)

**Purpose:** Software engineering and development tasks

**Capabilities:**
- Full-stack development (frontend, backend, database)
- Code analysis and refactoring
- Debugging and error fixing
- Git operations and version control
- Deployment to various platforms
- Database management

**Workflow:**
1. **Inspect** - Analyze existing code/project
2. **Edit** - Make surgical, targeted changes
3. **Verify** - Test and validate changes
4. **Summarize** - Report what was done

**Example Use Cases:**
```
"Clone the Express.js repo and add TypeScript support"
"Fix the authentication bug in my Next.js app"
"Deploy my React app to Vercel"
"Create a REST API with Flask and PostgreSQL"
```

**Tools Available:**
- Sandbox execution (cloud or local)
- GitHub integration
- Deployment tools (Vercel, Cloudflare)
- Database tools
- File vault access

---

### Computer Agent

**Purpose:** Desktop and browser automation

**Capabilities:**
- Desktop screenshot capture
- Mouse and keyboard control
- Window management
- File system operations
- Browser automation
- Email and document management

**Permission Model:**
- Requires explicit user permission
- Scoped access to specific folders
- Revocable at any time
- Desktop-only feature

**Example Use Cases:**
```
"Take a screenshot and analyze what's on my screen"
"Open Chrome, go to GitHub, and check my notifications"
"Find all PDFs in Downloads and organize them by date"
"Send an email to john@example.com with the report"
```

**Tools Available:**
- Computer control tools
- Browser automation
- Google Email
- Google Drive
- Google Sheets

---

### Task Agent

**Purpose:** Background task execution

**Capabilities:**
- Long-running research tasks
- Scheduled operations
- Batch processing
- Asynchronous workflows

**Use Cases:**
- Deep web research
- Data scraping and analysis
- Periodic monitoring
- Bulk operations

---

## 2. Secure Code Execution

### Sandbox Environment

**Architecture:**
- Isolated Docker container (Ubuntu 22.04)
- Non-root user (`sandboxuser`)
- Persistent workspace across sessions
- Full terminal access

**Capabilities:**
- Execute Python, JavaScript, Shell scripts
- Install packages (pip, npm, apt)
- Git operations
- File system operations
- Network access (for API calls)

**Security Features:**
- Complete process isolation
- Filesystem isolation
- Resource limits (CPU, memory)
- No access to host system
- Automatic cleanup

**Workspace Structure:**
```
/home/sandboxuser/workspace/
├── projects/
│   └── your-project/
├── scripts/
├── data/
└── temp/
```

**Example Operations:**

**Execute Python:**
```python
# Agent can run:
python3 script.py
pip install requests
python3 -c "import requests; print(requests.get('https://api.github.com').json())"
```

**Execute JavaScript:**
```bash
node script.js
npm install express
npm run build
```

**Shell Commands:**
```bash
git clone https://github.com/user/repo
cd repo && npm install
curl https://api.example.com/data
```

### Persistence

**Automatic Saving:**
- Execution history saved to PostgreSQL
- Workspace snapshots uploaded to R2
- Restored automatically on session resume

**Manual Operations:**
- Save files to user vault for permanent storage
- Export results to local machine
- Share workspace with other sessions

---

## 3. Web Automation

### Dual-Mode Browser Control

#### Client-Side (Desktop)

**Technology:** Playwright

**Capabilities:**
- Direct browser control
- Fast execution
- Full browser features
- Local file access

**Use Cases:**
- Interactive web tasks
- File downloads
- Complex workflows
- Testing and debugging

#### Server-Side (Web/Mobile)

**Technology:** Playwright on backend

**Capabilities:**
- Cloud-based execution
- Works on mobile/web
- Scalable
- No local browser required

**Use Cases:**
- Mobile app usage
- Web app usage
- Headless automation
- Scheduled tasks

### Browser Operations

**Navigation:**
```
navigate(url) - Go to URL
go_back() - Navigate back
go_forward() - Navigate forward
refresh_page() - Reload page
```

**Interaction:**
```
click(selector) - Click element
type_text(selector, text) - Type text
scroll(direction, amount) - Scroll page
hover_over_element(selector) - Hover
press_key(key) - Press keyboard key
```

**Data Extraction:**
```
get_current_view() - Screenshot + HTML
extract_text_from_element(selector) - Get text
get_element_attributes(selector) - Get attributes
extract_table_data(selector) - Parse table
```

**Tab Management:**
```
list_tabs() - List all tabs
open_new_tab(url) - Open new tab
switch_to_tab(index) - Switch tab
close_tab(index) - Close tab
```

**Advanced:**
```
wait_for_element(selector, timeout) - Wait for element
select_dropdown_option(selector, value) - Select dropdown
handle_alert(action) - Handle alert/confirm
manage_cookies(action, data) - Cookie management
```

### Example Workflows

**Web Scraping:**
```
User: "Go to Hacker News and get the top 10 stories"

Agent:
1. navigate("https://news.ycombinator.com")
2. extract_table_data(".itemlist")
3. Parse and format results
4. Return structured data
```

**Form Automation:**
```
User: "Fill out the contact form on example.com"

Agent:
1. navigate("https://example.com/contact")
2. type_text("#name", "John Doe")
3. type_text("#email", "john@example.com")
4. type_text("#message", "Hello!")
5. click("button[type='submit']")
6. Confirm submission
```

---

## 4. Desktop Control

### Permission System

**Initial Setup:**
1. User enables computer control in settings
2. Agent requests permission on first use
3. User grants/denies with optional scope
4. Permissions persist until revoked

**Scoped Access:**
- Specific folders only
- Read-only or read-write
- Time-limited access
- Revocable anytime

### Computer Operations

**Screenshot:**
```
screenshot() - Capture full screen
screenshot(region) - Capture region
```

**Mouse Control:**
```
mouse_move(x, y) - Move mouse
mouse_click(x, y, button) - Click
mouse_double_click(x, y) - Double click
mouse_drag(x1, y1, x2, y2) - Drag
```

**Keyboard Control:**
```
keyboard_type(text) - Type text
keyboard_press(key) - Press key
keyboard_hotkey(keys) - Press combination
```

**Window Management:**
```
list_windows() - List all windows
focus_window(title) - Focus window
minimize_window(title) - Minimize
maximize_window(title) - Maximize
close_window(title) - Close window
```

**File Operations:**
```
list_files(path) - List files
read_file(path) - Read file
write_file(path, content) - Write file
move_file(src, dest) - Move file
delete_file(path) - Delete file
```

**System Operations:**
```
execute_command(cmd) - Run shell command
get_system_info() - Get system info
get_clipboard() - Get clipboard content
set_clipboard(text) - Set clipboard
```

### Example Workflows

**Screenshot Analysis:**
```
User: "Take a screenshot and tell me what's on my screen"

Agent:
1. screenshot()
2. Analyze image with vision model
3. Describe contents
4. Answer questions about it
```

**File Organization:**
```
User: "Organize my Downloads folder by file type"

Agent:
1. get_status() - Check permissions
2. list_files("~/Downloads")
3. Group by extension
4. Create folders (Images, Documents, etc.)
5. move_file() for each file
6. Report results
```

**Automated Workflow:**
```
User: "Open VS Code, create a new file, and paste my clipboard"

Agent:
1. execute_command("code")
2. Wait for window
3. keyboard_hotkey("Ctrl+N")
4. get_clipboard()
5. keyboard_type(clipboard_content)
6. Confirm completion
```

---

## 5. Project Workspace

### Overview

Dedicated environment for software development with specialized UI and agent.

### Features

**File Tree Navigation:**
- Browse sandbox workspace
- Browse deployed project files
- Syntax-highlighted preview
- Real-time file updates

**Coder Agent Integration:**
- Specialized for coding tasks
- Context-aware of project structure
- Surgical code edits
- Verification workflows

**Terminal Access:**
- Built-in xterm terminal
- Direct sandbox access
- Command history
- Copy/paste support

**GitHub Integration:**
- Clone repositories
- Commit changes
- Create branches
- Push to remote

### Workflows

**Starting a Project:**
```
1. Click "New Project" in workspace
2. Choose: Clone from GitHub or Start fresh
3. Agent sets up environment
4. File tree populates
5. Start coding with agent
```

**Editing Code:**
```
1. Browse file tree
2. Click file to preview
3. Ask agent to make changes
4. Agent edits and verifies
5. Changes reflected in tree
```

**Deploying:**
```
1. Agent prepares deployment
2. Runs build process
3. Deploys to platform (Vercel, etc.)
4. Provides live URL
5. Adds to deployments list
```

### Execution Modes

**Cloud Mode (Default):**
- Executes in Docker sandbox
- Persistent across sessions
- Full isolation
- Accessible from anywhere

**Local Mode:**
- Executes on your machine
- Direct file system access
- Faster execution
- Desktop-only

---

## 6. Deployment Management

### Supported Platforms

**Vercel:**
- Next.js, React, Vue, etc.
- Automatic builds
- Custom domains
- Environment variables

**Cloudflare Workers:**
- Serverless functions
- Edge deployment
- KV storage
- R2 storage

**Custom Deployments:**
- Generic deployment support
- Manual configuration
- Flexible hosting

### Deployment Workflow

**1. Prepare:**
```
Agent analyzes project
Identifies framework
Configures build settings
Sets environment variables
```

**2. Build:**
```
Runs build command
Validates output
Optimizes assets
Generates manifest
```

**3. Deploy:**
```
Uploads to platform
Configures routing
Sets up domains
Verifies deployment
```

**4. Manage:**
```
View live site
Browse source files
Update configuration
Redeploy changes
```

### Deployment UI

**Deployments List:**
- All your deployed projects
- Status and URLs
- Last updated
- Quick actions

**Deployment Details:**
- Live site preview
- Source file browser
- Deployment logs
- Configuration

**File Browser:**
- Navigate deployed files
- View source code
- Syntax highlighting
- Download files

---

## 7. Third-Party Integrations

### GitHub

**Capabilities:**
- List repositories
- Clone repositories
- Create/update files
- Commit changes
- Create branches
- Create pull requests
- Manage issues
- Add comments

**Authentication:**
- OAuth flow
- Stored securely in database
- Automatic token refresh

**Example Operations:**
```
"List my GitHub repositories"
"Clone the React repository"
"Create an issue in my repo about the bug"
"Create a PR to fix the authentication"
```

### Google Services

#### Gmail

**Capabilities:**
- Read emails
- Send emails
- Search emails
- Reply to emails
- Manage labels
- Archive/delete

**Example Operations:**
```
"Check my unread emails"
"Send an email to john@example.com"
"Search for emails from GitHub"
"Reply to the latest email from Sarah"
```

#### Google Drive

**Capabilities:**
- Search files
- Read file content
- Create files
- Update files
- Share files
- Manage permissions

**Example Operations:**
```
"Find my presentation about AI"
"Read the content of report.docx"
"Create a new document with this content"
"Share the file with john@example.com"
```

#### Google Sheets

**Capabilities:**
- Search spreadsheets
- List sheets/tabs
- Read cell ranges
- Write to cells
- Batch operations
- Create spreadsheets
- Manage tabs

**Example Operations:**
```
"Read data from Sheet1 A1:B10"
"Write this data to the spreadsheet"
"Create a new sheet called 'Q1 Results'"
"Sum column A and put result in B1"
```

### Vercel

**Capabilities:**
- List projects
- Deploy projects
- Get deployment status
- Manage domains
- Environment variables

**Example Operations:**
```
"Deploy my Next.js app to Vercel"
"List my Vercel projects"
"Add a custom domain to my deployment"
```

### Supabase

**Capabilities:**
- Database queries
- Table management
- Row operations
- Authentication
- Storage operations

**Example Operations:**
```
"Query the users table"
"Insert a new row into products"
"Update user with id 123"
```

### Composio (WhatsApp)

**Capabilities:**
- Send messages
- Read messages
- Manage contacts
- Group operations

**Requirements:**
- Composio API key
- Active WhatsApp connection

**Example Operations:**
```
"Send a WhatsApp message to John"
"Check my WhatsApp messages"
```

---

## 8. File Management

### User File Vault

**Purpose:** Persistent storage for user files across sessions

**Capabilities:**
- Upload files from local machine
- Store files from sandbox
- Download files to local machine
- Share files between sessions
- Organize with folders

**Supported File Types:**
- Documents (PDF, DOCX, TXT, MD)
- Images (PNG, JPG, GIF, SVG)
- Code files (JS, PY, HTML, CSS, etc.)
- Data files (JSON, CSV, XML)
- Archives (ZIP, TAR, GZ)

**Operations:**
```
list_files() - List all files
upload_file(path) - Upload file
download_file(file_id) - Download file
read_file(file_id) - Read content
delete_file(file_id) - Delete file
```

**Example Workflows:**
```
"Upload my resume.pdf to the vault"
"List all my Python files"
"Read the content of config.json"
"Download the report I created yesterday"
```

### Attachments

**Chat Attachments:**
- Drag and drop files
- Click to attach
- Multiple files supported
- Preview before sending

**Supported Types:**
- Images (displayed inline)
- Documents (extracted text)
- Audio (transcribed)
- Video (analyzed)
- Code (syntax highlighted)

**Processing:**
- Images: OCR, analysis
- PDFs: Text extraction
- Audio: Whisper transcription
- Video: Frame analysis
- Code: Syntax parsing

---

## 9. Voice Input/Output

### Voice Input (Whisper)

**Capabilities:**
- Real-time speech recognition
- Multiple languages
- High accuracy
- Noise reduction

**Usage:**
1. Click microphone icon
2. Speak your message
3. Click again to stop
4. Text appears in input
5. Edit if needed
6. Send

**Supported Languages:**
- English
- Spanish
- French
- German
- Chinese
- Japanese
- And 90+ more

### Voice Output (TTS)

**Capabilities:**
- Natural-sounding voices
- Multiple languages
- Adjustable speed
- Emotion support

**Usage:**
- Automatic for agent responses
- Toggle on/off in settings
- Adjust voice and speed

---

## 10. Session Management

### Sessions

**What is a Session?**
- A conversation thread
- Persistent across app restarts
- Includes all messages and context
- Stored in database

**Session Features:**
- Automatic title generation
- Search and filter
- Export to PDF
- Delete sessions
- Pin important sessions

**Session History:**
- View all past sessions
- Search by content
- Filter by date
- Preview messages
- Resume any session

### Memory System

**Agentic Memory:**
- Agent learns from interactions
- Remembers user preferences
- Recalls past conversations
- Context-aware responses

**Session Summaries:**
- Automatic summarization
- Reduces context window usage
- Maintains continuity
- Improves performance

**User Memories:**
- Explicit facts about user
- Preferences and settings
- Project context
- Custom instructions

---

## 11. Task Management

### To-Do List

**Features:**
- Create tasks
- Set priorities (High, Medium, Low)
- Set due dates
- Mark complete
- Edit/delete tasks
- Filter and sort

**Integration:**
- Agent can create tasks
- Reminders and notifications
- Sync across devices

**Example:**
```
User: "Add a task to review the PR by Friday"

Agent creates:
- Title: Review PR
- Priority: High
- Due: Friday
- Status: Pending
```

---

## 12. Notifications

### Types

**System Notifications:**
- Agent responses
- Task completions
- Errors and warnings
- Updates available

**Integration Notifications:**
- GitHub events
- Email arrivals
- Calendar reminders

**Settings:**
- Enable/disable per type
- Sound preferences
- Desktop notifications
- In-app toasts

---

## 13. Account & Subscription

### Account Management

**Profile:**
- Email and name
- Avatar
- Preferences
- API keys

**Usage Tracking:**
- Token usage (input/output)
- Daily/monthly limits
- Usage graphs
- Historical data

**Subscription Plans:**
- Free tier
- Pro tier
- Enterprise tier
- Custom plans

**Payment:**
- Razorpay integration
- Secure payment processing
- Automatic billing
- Invoice history

---

## 14. Advanced Features

### Artifacts

**What are Artifacts?**
- AI-generated content (code, diagrams, etc.)
- Displayed in dedicated UI
- Editable and downloadable
- Shareable

**Types:**
- Code snippets
- HTML previews
- Diagrams (Mermaid)
- Documents
- Data visualizations

### Context Handling

**File Context:**
- Attach files to messages
- Agent reads and understands
- Maintains context across messages

**Project Context:**
- Workspace awareness
- File structure understanding
- Dependency tracking

### Streaming

**Real-time Streaming:**
- Agent thoughts stream live
- Tool executions shown in real-time
- Partial responses displayed
- Cancellable mid-stream

---

## Feature Comparison

| Feature | Free | Pro | Enterprise |
|---------|------|-----|------------|
| Chat Messages | 100/day | Unlimited | Unlimited |
| Code Execution | ✓ | ✓ | ✓ |
| Browser Automation | ✓ | ✓ | ✓ |
| Computer Control | ✓ | ✓ | ✓ |
| GitHub Integration | ✓ | ✓ | ✓ |
| Google Services | ✓ | ✓ | ✓ |
| Deployments | 3 | Unlimited | Unlimited |
| File Storage | 1 GB | 10 GB | Unlimited |
| Voice Input | ✓ | ✓ | ✓ |
| Priority Support | ✗ | ✓ | ✓ |
| Custom Models | ✗ | ✗ | ✓ |
| Team Features | ✗ | ✗ | ✓ |

---

## Coming Soon

### Planned Features

- **Multi-modal Vision**: Enhanced image understanding
- **Video Analysis**: Analyze video content
- **Custom Tools**: Create your own tools
- **Team Collaboration**: Share sessions and workspaces
- **Plugin System**: Extend functionality
- **Mobile App**: iOS and Android apps
- **API Access**: Programmatic access
- **Webhooks**: Event-driven integrations

---

*Last Updated: April 18, 2026*
