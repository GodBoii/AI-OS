# sandbox_manager/main.py
import uvicorn
import docker
import uuid
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()
docker_client = docker.from_env()
SANDBOX_IMAGE = "godboi/aios-sandbox:latest"

class CommandRequest(BaseModel):
    command: str

# Dictionary to keep track of active containers (optional but good practice)
active_sessions = {}

@app.post("/sessions")
def create_session():
    """Creates a new sandbox container and returns its session ID."""
    sandbox_id = str(uuid.uuid4())
    container_name = f"sandbox-session-{sandbox_id}"
    try:
        container = docker_client.containers.run(
            SANDBOX_IMAGE,
            name=container_name,
            detach=True,        # Run in the background
            tty=True,           # Keep the container running
            auto_remove=False,  # Do not remove automatically
            user='sandboxuser',
            working_dir='/home/sandboxuser'
        )
        active_sessions[sandbox_id] = container.id
        return {"sandbox_id": sandbox_id}
    except docker.errors.APIError as e:
        raise HTTPException(status_code=500, detail=f"Failed to create sandbox container: {e}")

@app.post("/sessions/{sandbox_id}/exec")
def execute_in_session(sandbox_id: str, request: CommandRequest):
    """Executes a command in an existing sandbox session."""
    container_name = f"sandbox-session-{sandbox_id}"
    try:
        container = docker_client.containers.get(container_name)
        exit_code, (stdout, stderr) = container.exec_run(
            cmd=f"/bin/bash -c '{request.command}'",
            user='sandboxuser'
        )
        return {
            "stdout": stdout.decode('utf-8') if stdout else "",
            "stderr": stderr.decode('utf-8') if stderr else "",
            "exit_code": exit_code
        }
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Sandbox session not found.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An error occurred during execution: {e}")

@app.delete("/sessions/{sandbox_id}")
def terminate_session(sandbox_id: str):
    """Stops and removes a sandbox container."""
    container_name = f"sandbox-session-{sandbox_id}"
    try:
        container = docker_client.containers.get(container_name)
        container.stop()
        container.remove()
        if sandbox_id in active_sessions:
            del active_sessions[sandbox_id]
        return {"message": "Sandbox session terminated successfully."}
    except docker.errors.NotFound:
        return {"message": "Sandbox session already terminated."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to terminate session: {e}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)