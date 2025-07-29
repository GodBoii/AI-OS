# Dockerfile 

FROM python:3.11

WORKDIR /app

COPY python-backend/requirements.txt . 

RUN pip install --no-cache-dir -r requirements.txt

RUN apt-get update && apt-get install -y --no-install-recommends libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libxkbcommon0 libasound2 libatspi2.0-0

RUN playwright install chromium

RUN pip install browser-use

COPY python-backend/ . 

EXPOSE 8765

ENV PORT=8765

ENV PYTHONUNBUFFERED=1

CMD ["gunicorn", "--worker-class", "eventlet", "-w", "4", "--timeout", "300", "--keep-alive", "65", "--bind", "0.0.0.0:8765", "app:app"]