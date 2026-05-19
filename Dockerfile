# Dockerfile (Final, Production-Ready Version)

FROM python:3.12-slim-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    nodejs \
    npm \
    python3-dev \
    libffi-dev \
    libssl-dev \
 && rm -rf /var/lib/apt/lists/*


WORKDIR /app

COPY python-backend/requirements.txt . 

RUN pip install --no-cache-dir -r requirements.txt

# The presentation tool runs inside this Python backend container but renders
# editable .pptx files with a Node renderer. Install pptxgenjs outside /app so
# docker-compose's ./python-backend:/app bind mount cannot hide node_modules.
RUN npm install --prefix /opt/aetheria-ppt pptxgenjs@4.0.1
ENV NODE_PATH=/opt/aetheria-ppt/node_modules

# Install Playwright browser binaries in a deterministic location for
# server-side browser automation used by mobile/web sessions.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install --with-deps chromium

COPY python-backend/ . 

EXPOSE 8765

ENV PORT=8765

ENV PYTHONUNBUFFERED=1

# CRITICAL FIX: Use the JSON array "exec" form for CMD.
# This bypasses the shell and prevents any misinterpretation of quotes.
# CMD now points directly to the instantiated app in `app.py`.
# Added logging flags for better visibility
CMD ["gunicorn", "--worker-class", "eventlet", "-w", "4", "--timeout", "300", "--keep-alive", "65", "--bind", "0.0.0.0:8765", "--log-level", "info", "--access-logfile", "-", "--error-logfile", "-", "app:app"]
