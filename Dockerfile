# Dockerfile (Corrected COPY paths)

# Use an official Python runtime as a parent image
FROM python:3.11

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file from the python-backend subdir into the container at /app
COPY python-backend/requirements.txt . 
# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# --- MODIFICATION START ---
# First, update the package lists. Then, install the OS-level dependencies
# that Playwright's browsers need to run. This command is provided by Playwright.
RUN apt-get update && apt-get install -y --no-install-recommends libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libxkbcommon0 libasound2 libatspi2.0-0

# Now, install the browser binaries required by Playwright for the crawl tool.
RUN playwright install chromium
# --- MODIFICATION END ---

# Copy the rest of the python-backend application code into the container at /app
COPY python-backend/ . 

# Make port 8765 available to the world outside this container
# This doesn't publish the port, just documents it.
EXPOSE 8765

# Define environment variables (can be overridden at runtime)
ENV PORT=8765
ENV PYTHONUNBUFFERED=1

# Command to run the application using Gunicorn
# Assumes your Flask app instance in app.py is named 'app'
# Uses eventlet for SocketIO compatibility
# Update the CMD line to add timeout parameter
CMD ["gunicorn", "--worker-class", "eventlet", "-w", "4", "--timeout", "300", "--keep-alive", "65", "--bind", "0.0.0.0:8765", "app:app"]