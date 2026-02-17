# sandbox_manager/main.py (Complete, Updated Version)

import uvicorn
import docker
import uuid
import logging
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# --- Step 1: Configure Logging ---
# This will ensure any errors are printed to the container's logs with full details.
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# --- Initialize Docker Client ---
# This will now work correctly because the Docker socket is mounted in the run command.
try:
    docker_client = docker.from_env()
except docker.errors.DockerException as e:
    logger.error("Could not connect to Docker daemon. Is it running and is the socket mounted?", exc_info=True)
    # Exit if Docker is not available, as the service is non-functional without it.
    raise RuntimeError("Failed to connect to Docker daemon.") from e


SANDBOX_IMAGE = "godboi/aios-sandbox:latest"

class CommandRequest(BaseModel):
    command: str

@app.post("/sessions")
def create_session():
    """Creates a new sandbox container and returns its session ID."""
    sandbox_id = str(uuid.uuid4())
    container_name = f"sandbox-session-{sandbox_id}"
    logger.info(f"Received request to create sandbox session: {container_name}")
    try:
        container = docker_client.containers.run(
            SANDBOX_IMAGE,
            name=container_name,
            detach=True,        # Run in the background
            tty=True,           # Keep the container running to accept exec commands
            auto_remove=False,  # We will remove it manually via the DELETE endpoint
            user='sandboxuser',
            working_dir='/home/sandboxuser'
        )
        logger.info(f"Successfully created container {container.short_id} for session {sandbox_id}")
        return {"sandbox_id": sandbox_id}
    except docker.errors.APIError as e:
        logger.error(f"Docker API error during sandbox creation for {container_name}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create sandbox container: {e}")

@app.post("/sessions/{sandbox_id}/exec")
def execute_in_session(sandbox_id: str, request: CommandRequest):
    """Executes a command in an existing sandbox session."""
    container_name = f"sandbox-session-{sandbox_id}"
    logger.info(f"Executing command in {container_name}: {request.command}")
    try:
        container = docker_client.containers.get(container_name)
        
        shell_command = ["/bin/bash", "-c", request.command]
        exit_code, (stdout, stderr) = container.exec_run(
            cmd=shell_command,
            demux=True 
        )
        
        stdout_str = stdout.decode('utf-8', errors='ignore') if stdout else ""
        stderr_str = stderr.decode('utf-8', errors='ignore') if stderr else ""
        
        logger.info(f"Command in {container_name} finished with exit code {exit_code}")
        if stdout_str:
            logger.info(f"STDOUT: {stdout_str.strip()}")
        if stderr_str:
            logger.warning(f"STDERR: {stderr_str.strip()}")

        return {
            "stdout": stdout_str,
            "stderr": stderr_str,
            "exit_code": exit_code
        }
    except docker.errors.NotFound:
        logger.warning(f"Execution failed: sandbox session {container_name} not found.")
        raise HTTPException(status_code=404, detail="Sandbox session not found.")
    except Exception as e:
        # --- Step 3: Log the Full Exception ---
        # This ensures we see the real error instead of just a generic 500.
        logger.error(f"An unexpected exception occurred during execution in {container_name}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"An error occurred during execution: {e}")

@app.get("/sessions/{sandbox_id}/files")
def list_sandbox_files(sandbox_id: str, path: str = "/home/sandboxuser"):
    """
    List all files in the sandbox filesystem.
    Returns file paths, sizes, and modification times.
    """
    container_name = f"sandbox-session-{sandbox_id}"
    logger.info(f"Listing files in {container_name} at path: {path}")
    try:
        container = docker_client.containers.get(container_name)
        
        # Use find command to list all files with details
        # Format: filepath|size|mtime
        find_command = [
            "/bin/bash", "-c",
            f"find {path} -type f -printf '%p|%s|%T@\\n' 2>/dev/null || true"
        ]
        
        exit_code, output = container.exec_run(cmd=find_command)
        output_str = output.decode('utf-8', errors='ignore') if output else ""
        
        files = []
        for line in output_str.strip().split('\n'):
            if not line:
                continue
            parts = line.split('|')
            if len(parts) == 3:
                filepath, size, mtime = parts
                files.append({
                    'path': filepath,
                    'size': int(size) if size.isdigit() else 0,
                    'mtime': float(mtime) if mtime.replace('.', '').isdigit() else 0
                })
        
        logger.info(f"Found {len(files)} files in {container_name}")
        return {"files": files}
        
    except docker.errors.NotFound:
        logger.warning(f"List files failed: sandbox session {container_name} not found.")
        raise HTTPException(status_code=404, detail="Sandbox session not found.")
    except Exception as e:
        logger.error(f"Error listing files in {container_name}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list files: {e}")

@app.get("/sessions/{sandbox_id}/files/content")
def get_file_content(sandbox_id: str, filepath: str):
    """
    Get the content of a specific file from the sandbox.
    Returns binary content as base64 encoded string in JSON.
    """
    container_name = f"sandbox-session-{sandbox_id}"
    logger.info(f"Reading file from {container_name}: {filepath}")
    try:
        container = docker_client.containers.get(container_name)
        
        # Read file content
        exit_code, output = container.exec_run(
            cmd=["/bin/cat", filepath]
        )
        
        if exit_code != 0:
            raise HTTPException(status_code=404, detail=f"File not found: {filepath}")
        
        # Return as base64 to handle binary files properly
        import base64
        content_b64 = base64.b64encode(output).decode('utf-8') if output else ""
        
        return {
            "content": content_b64,
            "size": len(output) if output else 0,
            "encoding": "base64"
        }
        
    except docker.errors.NotFound:
        logger.warning(f"Get file content failed: sandbox session {container_name} not found.")
        raise HTTPException(status_code=404, detail="Sandbox session not found.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error reading file from {container_name}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to read file: {e}")

@app.delete("/sessions/{sandbox_id}")
def terminate_session(sandbox_id: str):
    """Stops and removes a sandbox container."""
    container_name = f"sandbox-session-{sandbox_id}"
    logger.info(f"Received request to terminate session: {container_name}")
    try:
        container = docker_client.containers.get(container_name)
        container.stop()
        container.remove()
        logger.info(f"Successfully stopped and removed {container_name}.")
        return {"message": "Sandbox session terminated successfully."}
    except docker.errors.NotFound:
        logger.warning(f"Termination request for non-existent session: {container_name}")
        return {"message": "Sandbox session already terminated."}
    except Exception as e:
        logger.error(f"An unexpected exception occurred during termination of {container_name}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to terminate session: {e}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)