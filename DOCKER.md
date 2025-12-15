# AI-OS: Complete Docker Backend Configuration

This document provides a comprehensive guide to the Docker-based architecture for AI-OS, including multi-service orchestration, sandbox management, and complete deployment instructions.

## Architecture Overview

The AI-OS system consists of multiple Docker services working together:

1. **Main Web Server** - Flask/SocketIO application with Gunicorn
2. **Redis** - Message broker and caching layer
3. **Celery Worker** - Background task processing
4. **Flower** - Celery monitoring interface
5. **Sandbox Manager** - Secure code execution environment manager

## Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop/) installed and running
- [Docker Compose](https://docs.docker.com/compose/install/) installed
- Node.js and npm for the Electron frontend
- At least 4GB RAM available for containers
- 10GB+ free disk space

## Project Structure

```
project-root/
├── Dockerfile                    # Main web server image
├── docker-compose.yml           # Multi-service orchestration
├── Dockerfile.sandbox           # Sandbox execution environment
├── sandbox_manager/
│   ├── Dockerfile               # Sandbox manager service
│   ├── requirements.txt
│   └── main.py
├── python-backend/
│   ├── .env                     # Environment variables
│   ├── requirements.txt
│   ├── app.py
│   └── ...
└── tmp/                         # Shared temporary files
```

## Docker Files

### 1. Main Application Dockerfile

```dockerfile
# Dockerfile 

FROM python:3.11

WORKDIR /app

COPY python-backend/requirements.txt . 

RUN pip install --no-cache-dir -r requirements.txt

RUN pip install mcp

RUN apt-get update && apt-get install -y --no-install-recommends libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libxkbcommon0 libasound2 libatspi2.0-0

RUN playwright install chromium

COPY python-backend/ . 

EXPOSE 8765

ENV PORT=8765

ENV PYTHONUNBUFFERED=1

CMD ["gunicorn", "--worker-class", "eventlet", "-w", "4", "--timeout", "300", "--keep-alive", "65", "--bind", "0.0.0.0:8765", "app:app"]
```

**Key Features:**
- Python 3.11 base image with all backend dependencies
- Playwright for browser automation capabilities
- Gunicorn with eventlet workers for WebSocket support
- Browser dependencies for headless Chrome operations

### 2. Docker Compose Configuration

```yaml
# docker-compose.yml (Complete version with all services)

version: '3.8'

services:
  # Redis for Celery message brokering and backend caching
  redis:
    image: "redis:7.2-alpine"
    container_name: aios-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  # The main web server (Flask/SocketIO)
  web:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: aios-web
    ports:
      - "8765:8765"
    env_file:
      - ./python-backend/.env
    volumes:
      - ./python-backend:/app
    depends_on:
      - redis
      - sandbox-manager # Ensures sandbox-manager starts before the web server

  # The Celery worker for background AI tasks
  worker:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: aios-worker
    command: ["celery", "-A", "app.celery", "worker", "--loglevel=info", "--concurrency=4"]
    env_file:
      - ./python-backend/.env
    volumes:
      - ./python-backend:/app
    depends_on:
      - redis
      - web

  # Flower for monitoring Celery workers
  flower:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: aios-flower
    command: ["celery", "-A", "app.celery", "flower", "--broker=redis://redis:6379/0"]
    ports:
      - "5555:5555"
    depends_on:
      - redis
      - worker

  # --- NEW: The Sandbox Manager Service ---
  # This service manages creating, executing, and terminating sandbox containers.
  sandbox-manager:
    build:
      context: .
      dockerfile: sandbox_manager/Dockerfile
    container_name: aios-sandbox-manager
    ports:
      - "8000:8000"
    volumes:
      # CRITICAL: Mount the host's Docker socket into the container.
      # This allows the sandbox-manager to control the Docker daemon
      # to start and stop the actual sandbox containers.
      - /var/run/docker.sock:/var/run/docker.sock

volumes:
  redis_data:
```

### 3. Sandbox Environment Dockerfile

```dockerfile
# Dockerfile.sandbox
# This defines the environment where user code will run.

FROM ubuntu:22.04

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Update and install common tools needed by the agent
# git is needed for 'git clone', curl for downloading files, etc.
RUN apt-get update && apt-get install -y \
    python3.11 \
    python3-pip \
    git \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user for security.
# Running code as root inside a container is a major security risk.
RUN useradd -m -s /bin/bash sandboxuser

# Switch to the non-root user
USER sandboxuser
WORKDIR /home/sandboxuser

# Final check
CMD ["/bin/bash"]
```

### 4. Sandbox Manager Dockerfile

```dockerfile
# Dockerfile.manager
FROM python:3.11-slim

WORKDIR /app

COPY ./sandbox_manager/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ./sandbox_manager/ .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Environment Configuration

### Required Environment Variables (.env file)

Create a `.env` file in the `python-backend/` directory:

```env
# AI API Keys
OPENAI_API_KEY=sk-your-openai-key-here
GROQ_API_KEY=your-groq-key-here
ANTHROPIC_API_KEY=your-anthropic-key-here
MISTRAL_API_KEY=your-mistral-key-here

# Redis Configuration
REDIS_URL=redis://redis:6379/0

# Celery Configuration
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/0

# Sandbox Manager
SANDBOX_MANAGER_URL=http://sandbox-manager:8000

# Security
SECRET_KEY=your-secret-key-here

# Debug Settings
DEBUG=false
LOG_LEVEL=INFO
```

## Deployment Instructions

### 1. Complete System Startup

Start all services using Docker Compose:

```bash
# Build and start all services
docker-compose up --build -d

# View logs from all services
docker-compose logs -f

# View logs from specific service
docker-compose logs -f web
```

### 2. Individual Service Management

```bash
# Start specific services
docker-compose up redis web -d

# Stop all services
docker-compose down

# Stop and remove volumes (WARNING: This deletes data)
docker-compose down -v

# Restart a specific service
docker-compose restart web
```

### 3. Building Individual Images

```bash
# Build main application image
docker build -t aios-backend -f Dockerfile .

# Build sandbox environment
docker build -t aios-sandbox -f Dockerfile.sandbox .

# Build sandbox manager
docker build -t aios-sandbox-manager -f sandbox_manager/Dockerfile .
```

## Service Details and Ports

| Service | Port | Purpose | Health Check |
|---------|------|---------|--------------|
| Web Server | 8765 | Main Flask/SocketIO API | `http://localhost:8765/health` |
| Redis | 6379 | Message broker & cache | `redis-cli ping` |
| Flower | 5555 | Celery monitoring | `http://localhost:5555` |
| Sandbox Manager | 8000 | Code execution manager | `http://localhost:8000/health` |

## File Mounting for Multimodal Support

### Critical Configuration for File Access

The system needs access to user files for multimodal processing (images, audio, video, PDFs):

#### Windows Example:
```bash
# Mount user directories
docker-compose up -d
# Or for manual run:
docker run -d -p 8765:8765 \
  -v C:/Users/youruser/Downloads:/host_downloads \
  -v C:/Users/youruser/Documents:/host_documents \
  aios-backend
```

#### macOS/Linux Example:
```bash
# Mount user directories
docker run -d -p 8765:8765 \
  -v $HOME/Downloads:/host_downloads \
  -v $HOME/Documents:/host_documents \
  aios-backend
```

### Updated Docker Compose with File Mounts

```yaml
# Add to the web service in docker-compose.yml
web:
  build:
    context: .
    dockerfile: Dockerfile
  container_name: aios-web
  ports:
    - "8765:8765"
  env_file:
    - ./python-backend/.env
  volumes:
    - ./python-backend:/app
    # File access for multimodal support
    - ${HOME}/Downloads:/host_downloads
    - ${HOME}/Documents:/host_documents
    - ./tmp:/app/tmp
  depends_on:
    - redis
    - sandbox-manager
```

## Security Considerations

### Sandbox Security

1. **Non-root User**: Sandbox containers run as `sandboxuser` (non-root)
2. **Isolated Network**: Sandboxes run in isolated Docker networks
3. **Resource Limits**: CPU and memory limits applied to sandbox containers
4. **Temporary Execution**: Sandbox containers are destroyed after use

### Docker Socket Access

The sandbox manager needs Docker socket access to manage containers:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

**Security Note**: This gives the sandbox manager full Docker daemon access. In production, consider using Docker-in-Docker or rootless Docker.

### Environment Security

- Keep `.env` files out of version control
- Use Docker secrets for production deployments
- Regularly update base images for security patches
- Implement proper network segmentation

## Monitoring and Logging

### Service Health Checks

```bash
# Check all services status
docker-compose ps

# View real-time logs
docker-compose logs -f

# Check individual service health
curl http://localhost:8765/health  # Web server
curl http://localhost:8000/health  # Sandbox manager
redis-cli ping                     # Redis
```

### Flower Monitoring Interface

Access Celery monitoring at `http://localhost:5555`:
- View active tasks
- Monitor worker performance
- Task execution history
- Worker statistics

### Log Management

```bash
# View logs with timestamps
docker-compose logs -f -t

# View logs for specific timeframe
docker-compose logs --since 2024-01-01T00:00:00

# Export logs to file
docker-compose logs > aios-logs.txt
```

## Troubleshooting

### Common Issues

#### 1. Connection Issues
```bash
# Check if services are running
docker-compose ps

# Test network connectivity
docker-compose exec web ping redis
docker-compose exec web ping sandbox-manager
```

#### 2. File Access Problems
```bash
# Check mounted volumes
docker-compose exec web ls -la /host_downloads

# Verify file permissions
docker-compose exec web ls -la /app/tmp
```

#### 3. Memory Issues
```bash
# Check container resource usage
docker stats

# View system resources
docker system df
```

#### 4. Build Issues
```bash
# Clean build (removes cache)
docker-compose build --no-cache

# Remove all unused Docker resources
docker system prune -a
```

### Debugging Commands

```bash
# Enter running container
docker-compose exec web bash
docker-compose exec sandbox-manager bash

# View container logs
docker-compose logs web --tail 100

# Check environment variables
docker-compose exec web env

# Test API endpoints
curl -X GET http://localhost:8765/health
curl -X GET http://localhost:8000/health
```

## Production Deployment

### Performance Optimization

```yaml
# Production docker-compose.yml adjustments
services:
  web:
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '2'
        reservations:
          memory: 1G
          cpus: '1'
    
  worker:
    command: ["celery", "-A", "app.celery", "worker", "--loglevel=warning", "--concurrency=8"]
    deploy:
      replicas: 2
```

### Production Environment Variables

```env
# Production settings
DEBUG=false
LOG_LEVEL=WARNING
GUNICORN_WORKERS=8
GUNICORN_TIMEOUT=600
REDIS_MAXMEMORY=1gb
REDIS_MAXMEMORY_POLICY=allkeys-lru
```

### Backup and Recovery

```bash
# Backup Redis data
docker-compose exec redis redis-cli BGSAVE

# Backup volumes
docker run --rm -v aios_redis_data:/data -v $(pwd):/backup ubuntu tar czf /backup/redis-backup.tar.gz /data

# Restore from backup
docker run --rm -v aios_redis_data:/data -v $(pwd):/backup ubuntu tar xzf /backup/redis-backup.tar.gz -C /
```

## Development Workflow

### Hot Reload Development

For development with hot reload:

```yaml
# Development docker-compose.override.yml
version: '3.8'
services:
  web:
    command: ["python", "app.py"]  # Direct Python instead of Gunicorn
    environment:
      - FLASK_ENV=development
      - FLASK_DEBUG=1
    volumes:
      - ./python-backend:/app:delegated  # Better performance on macOS
```

### Testing

```bash
# Run tests in container
docker-compose exec web python -m pytest tests/

# Run with coverage
docker-compose exec web python -m pytest --cov=app tests/
```

## Maintenance

### Regular Maintenance Tasks

```bash
# Update images
docker-compose pull
docker-compose up -d

# Clean up unused resources
docker system prune -f

# Update dependencies
docker-compose build --no-cache
```

### Monitoring Resource Usage

```bash
# Monitor container resources
docker stats --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"

# Check disk usage
docker system df
```

---

## Quick Start Summary

1. **Setup**: Ensure Docker and Docker Compose are installed
2. **Configure**: Create `.env` file with your API keys
3. **Deploy**: Run `docker-compose up --build -d`
4. **Verify**: Check `http://localhost:8765/health` and `http://localhost:5555`
5. **Connect**: Start your Electron frontend with `npm start`

For additional support, check the logs with `docker-compose logs -f` and refer to the troubleshooting section above.