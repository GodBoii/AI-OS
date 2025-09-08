# Dockerfile 

FROM python:3.11-slim-bookworm

WORKDIR /app

COPY python-backend/requirements.txt . 

RUN pip install --no-cache-dir -r requirements.txt

COPY python-backend/ . 

EXPOSE 8765

ENV PORT=8765

ENV PYTHONUNBUFFERED=1

CMD ["gunicorn", "--worker-class", "eventlet", "-w", "1", "--timeout", "300", "--keep-alive", "65", "--bind", "0.0.0.0:8765", "app:create_app()"]