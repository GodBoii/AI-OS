# Installation & Setup Guide

## Prerequisites

Before installing Aetheria AI, ensure your system meets the following requirements:

### System Requirements

**Minimum:**
- **OS**: Windows 10/11, macOS 10.15+, Ubuntu 20.04+
- **RAM**: 4 GB
- **Storage**: 2 GB free space
- **Internet**: Broadband connection
- **Display**: 1280x720 resolution

**Recommended:**
- **OS**: Windows 11, macOS 12+, Ubuntu 22.04+
- **RAM**: 8 GB or more
- **Storage**: 10 GB free space (for Docker containers)
- **Internet**: High-speed broadband
- **Display**: 1920x1080 or higher

### Required Software

**For Desktop App:**
- No additional software required (standalone installer)

**For Development:**
- **Node.js**: 16.x or higher
- **Python**: 3.11 or higher
- **Docker**: Latest version
- **Git**: Latest version

---

## Installation Methods

### Method 1: Desktop Application (Recommended for Users)

#### Windows

1. **Download the Installer**
   - Visit [GitHub Releases](https://github.com/GodBoii/AI-OS-website/releases)
   - Download `Aetheria.AI.Setup.{version}.exe`

2. **Run the Installer**
   ```
   Double-click the downloaded .exe file
   Follow the installation wizard
   ```

3. **Launch the Application**
   - Find "Aetheria AI" in your Start Menu
   - Or use the desktop shortcut

#### macOS

1. **Download the Installer**
   - Visit [GitHub Releases](https://github.com/GodBoii/AI-OS-website/releases)
   - Download `Aetheria.AI-{version}.dmg`

2. **Install the Application**
   ```
   Open the .dmg file
   Drag Aetheria AI to Applications folder
   ```

3. **Launch the Application**
   - Open from Applications folder
   - Or use Spotlight (Cmd+Space, type "Aetheria")

#### Linux

**AppImage (Universal):**

1. **Download AppImage**
   ```bash
   wget https://github.com/GodBoii/AI-OS-website/releases/download/v1.1.0/Aetheria.AI-1.1.0.AppImage
   ```

2. **Make Executable**
   ```bash
   chmod +x Aetheria.AI-1.1.0.AppImage
   ```

3. **Run**
   ```bash
   ./Aetheria.AI-1.1.0.AppImage
   ```

**Debian/Ubuntu (.deb):**

```bash
wget https://github.com/GodBoii/AI-OS-website/releases/download/v1.1.0/aetheria-ai_1.1.0_amd64.deb
sudo dpkg -i aetheria-ai_1.1.0_amd64.deb
sudo apt-get install -f  # Install dependencies
```

**Fedora/RHEL (.rpm):**

```bash
wget https://github.com/GodBoii/AI-OS-website/releases/download/v1.1.0/aetheria-ai-1.1.0.x86_64.rpm
sudo rpm -i aetheria-ai-1.1.0.x86_64.rpm
```

---

### Method 2: Development Setup

For developers who want to run from source or contribute to the project.

#### 1. Clone the Repository

```bash
git clone https://github.com/GodBoii/AI-OS-website.git
cd AI-OS-website
```

#### 2. Install Frontend Dependencies

```bash
npm install
```

#### 3. Install Backend Dependencies

```bash
cd python-backend
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
cd ..
```

#### 4. Set Up Environment Variables

Create `.env` file in `python-backend/` directory:

```bash
# Core Configuration
FLASK_SECRET_KEY=your-secret-key-here
DATABASE_URL=postgresql://user:password@host:5432/database
REDIS_URL=redis://localhost:6379/0
SANDBOX_API_URL=http://localhost:8000

# LLM Providers (at least one required)
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
GOOGLE_API_KEY=...

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Convex (Usage Tracking)
CONVEX_DEPLOYMENT_URL=https://your-deployment.convex.cloud
CONVEX_DEPLOY_KEY=...

# Cloudflare R2 (Storage)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=aios-media

# OAuth (Optional)
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Razorpay (Optional - for payments)
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...

# Composio (Optional - for WhatsApp)
COMPOSIO_API_KEY=...
```

#### 5. Set Up Docker Infrastructure

```bash
# Start Redis and Sandbox Manager
docker-compose up -d redis sandbox-manager
```

#### 6. Initialize Database

The database schema is automatically created by Supabase. You need to:

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Run the SQL migrations (if provided in `database/` folder)
3. Enable Row Level Security (RLS) on all tables

#### 7. Run the Application

**Terminal 1 - Backend:**
```bash
cd python-backend
python app.py
```

**Terminal 2 - Frontend:**
```bash
npm start
```

The application will open automatically in Electron.

---

### Method 3: Docker Deployment (Production)

For deploying the backend to a server.

#### 1. Clone and Configure

```bash
git clone https://github.com/GodBoii/AI-OS-website.git
cd AI-OS-website
```

Create `python-backend/.env` with production values.

#### 2. Build and Run

```bash
docker-compose up -d
```

This starts:
- **web** - Flask backend (port 8765)
- **redis** - Redis cache (port 6379)
- **sandbox-manager** - Sandbox API (port 8000)
- **flower** - Celery monitoring (port 5555)

#### 3. Verify Deployment

```bash
# Check running containers
docker-compose ps

# View logs
docker-compose logs -f web

# Test API
curl http://localhost:8765/health
```

#### 4. Set Up Reverse Proxy (Optional)

**Nginx Configuration:**

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8765;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

#### 5. Enable HTTPS (Recommended)

```bash
# Install Certbot
sudo apt-get install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d your-domain.com
```

---

## Configuration

### Frontend Configuration

**Location:** `js/config.js`

```javascript
const config = {
    // Backend URL
    BACKEND_URL: 'http://localhost:8765',
    
    // Supabase
    SUPABASE_URL: 'https://your-project.supabase.co',
    SUPABASE_ANON_KEY: 'your-anon-key',
    
    // Convex
    CONVEX_URL: 'https://your-deployment.convex.cloud',
    
    // Features
    ENABLE_VOICE_INPUT: true,
    ENABLE_COMPUTER_CONTROL: true,
    ENABLE_BROWSER_AUTOMATION: true,
};
```

### Backend Configuration

**Location:** `python-backend/.env`

See "Method 2: Development Setup" section above for complete environment variables.

### Docker Configuration

**Location:** `docker-compose.yml`

```yaml
version: '3.8'

services:
  redis:
    image: "redis:7.2-alpine"
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  web:
    build: .
    ports:
      - "8765:8765"
    env_file:
      - ./python-backend/.env
    depends_on:
      - redis
      - sandbox-manager

  sandbox-manager:
    build:
      context: ./sandbox_manager
    ports:
      - "127.0.0.1:8000:8000"

  flower:
    build: .
    command: ["celery", "-A", "celery_app:celery_app", "flower"]
    ports:
      - "5555:5555"
    env_file:
      - ./python-backend/.env
    depends_on:
      - redis

volumes:
  redis_data:
```

---

## First-Time Setup

### 1. Create an Account

1. Launch Aetheria AI
2. Click "Sign Up" on the welcome screen
3. Enter your email and password
4. Verify your email (check spam folder)
5. Log in with your credentials

### 2. Configure API Keys

1. Click the settings icon (⚙️) in the sidebar
2. Navigate to "Account" tab
3. Enter your LLM API keys:
   - OpenAI API Key (for GPT models)
   - Groq API Key (for fast inference)
   - Google API Key (for Gemini models)
4. Click "Save"

### 3. Connect Integrations (Optional)

**GitHub:**
1. Go to Settings → Integrations
2. Click "Connect GitHub"
3. Authorize the application
4. You'll be redirected back to Aetheria AI

**Google Services:**
1. Go to Settings → Integrations
2. Click "Connect Google"
3. Select the services you want to enable:
   - Gmail
   - Google Drive
   - Google Sheets
4. Authorize the application

**Vercel:**
1. Go to Settings → Integrations
2. Click "Connect Vercel"
3. Authorize the application
4. Select the teams you want to access

### 4. Enable Computer Control (Desktop Only)

1. Go to Settings → Capabilities
2. Find "System Automation"
3. Click "Enable"
4. Grant permissions when prompted:
   - Screen recording (for screenshots)
   - Accessibility (for mouse/keyboard control)

### 5. Test the Setup

Try these commands to verify everything works:

```
"Hello! Can you introduce yourself?"
→ Tests basic chat functionality

"Search for the latest news about AI"
→ Tests web search integration

"Create a simple Python script that prints 'Hello World'"
→ Tests sandbox execution

"Take a screenshot" (Desktop only)
→ Tests computer control
```

---

## Troubleshooting Installation

### Common Issues

#### Issue: "Cannot connect to backend"

**Solution:**
1. Check if backend is running: `curl http://localhost:8765/health`
2. Verify `BACKEND_URL` in `js/config.js`
3. Check firewall settings
4. Review backend logs for errors

#### Issue: "Sandbox execution failed"

**Solution:**
1. Verify Docker is running: `docker ps`
2. Check sandbox manager: `curl http://localhost:8000/health`
3. Ensure `SANDBOX_API_URL` is set correctly
4. Review sandbox manager logs: `docker-compose logs sandbox-manager`

#### Issue: "Authentication failed"

**Solution:**
1. Verify Supabase credentials in `.env`
2. Check Supabase project status
3. Ensure RLS policies are configured
4. Clear browser cache and try again

#### Issue: "Redis connection error"

**Solution:**
1. Check if Redis is running: `redis-cli ping`
2. Verify `REDIS_URL` in `.env`
3. Restart Redis: `docker-compose restart redis`

#### Issue: "Module not found" errors

**Solution:**
```bash
# Backend
cd python-backend
pip install -r requirements.txt

# Frontend
npm install
```

#### Issue: Electron app won't start

**Solution:**
1. Delete `node_modules` and reinstall:
   ```bash
   rm -rf node_modules
   npm install
   ```
2. Rebuild native modules:
   ```bash
   npm run rebuild:native
   ```
3. Check for conflicting processes on port 8765

---

## Updating Aetheria AI

### Desktop App

The application includes an auto-updater:

1. When an update is available, you'll see a notification
2. Click "Download Update"
3. The update will download in the background
4. Click "Install and Restart" when ready

**Manual Update:**
1. Download the latest installer from GitHub Releases
2. Run the installer (it will update the existing installation)

### Development Setup

```bash
# Pull latest changes
git pull origin main

# Update frontend dependencies
npm install

# Update backend dependencies
cd python-backend
pip install -r requirements.txt --upgrade

# Restart services
docker-compose restart
```

---

## Uninstallation

### Windows

1. Open "Add or Remove Programs"
2. Find "Aetheria AI"
3. Click "Uninstall"
4. Follow the wizard

**Clean Uninstall:**
```powershell
# Remove user data
Remove-Item -Recurse -Force "$env:APPDATA\Aetheria AI"
```

### macOS

1. Open Finder
2. Go to Applications
3. Drag "Aetheria AI" to Trash
4. Empty Trash

**Clean Uninstall:**
```bash
# Remove user data
rm -rf ~/Library/Application\ Support/Aetheria\ AI
rm -rf ~/Library/Preferences/com.aetheria-ai.desktop.plist
rm -rf ~/Library/Logs/Aetheria\ AI
```

### Linux

**AppImage:**
```bash
rm Aetheria.AI-*.AppImage
```

**Debian/Ubuntu:**
```bash
sudo apt-get remove aetheria-ai
```

**Fedora/RHEL:**
```bash
sudo rpm -e aetheria-ai
```

**Clean Uninstall:**
```bash
# Remove user data
rm -rf ~/.config/Aetheria\ AI
rm -rf ~/.local/share/Aetheria\ AI
```

---

## Next Steps

Now that you have Aetheria AI installed:

1. **[Read the User Guide](04-USER-GUIDE.md)** - Learn how to use the application
2. **[Explore Features](05-FEATURES.md)** - Discover what you can do
3. **[Check out Examples](04-USER-GUIDE.md#examples)** - See real-world use cases

---

## Getting Help

If you encounter issues during installation:

- **Documentation**: Check the [Troubleshooting Guide](14-TROUBLESHOOTING.md)
- **GitHub Issues**: [Report a bug](https://github.com/GodBoii/AI-OS-website/issues)
- **Email Support**: aetheriaai1@gmail.com

---

*Last Updated: April 18, 2026*
