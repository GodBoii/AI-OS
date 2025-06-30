# python-backend/sandbox_tools.py
import os
import requests
from agno.tools import Toolkit
import uuid # Import the uuid library

socketio = None

class SandboxTools(Toolkit):
    # The __init__ method now accepts the socketio object
    def __init__(self, socketio_instance):
        super().__init__(
            name="sandbox_tools",
            tools=[self.prepare_sandbox_terminal, self.execute_command_in_terminal]
        )
        # Store the socketio instance on the object itself, not as a global
        self.socketio = socketio_instance
        self.sandbox_api_url = os.getenv("SANDBOX_API_URL")
        if not self.sandbox_api_url:
            raise ValueError("SANDBOX_API_URL environment variable is not set.")

    def prepare_sandbox_terminal(self) -> str:
        """Prepares a new terminal window..."""
        # Use the instance's socketio object
        if not self.socketio:
            return "Error: Socket.IO instance not available."

        artifact_id = f"terminal-{uuid.uuid4()}"

        # Use self.socketio to emit
        self.socketio.emit('sandbox-command-started', {
            'artifactId': artifact_id,
            'command': None,
            'status': 'waiting'
        })
        return artifact_id

    def execute_command_in_terminal(self, command: str, artifactId: str) -> str:
        """Executes a shell command..."""
        # Use the instance's socketio object
        if not self.socketio:
            return "Error: Socket.IO instance not available."

        # Use self.socketio to emit
        self.socketio.emit('sandbox-command-update', {
            'artifactId': artifactId,
            'command': command
        })

        # ... (rest of the function remains the same, but uses self.socketio) ...
        api_endpoint = f"{self.sandbox_api_url}/execute"
        payload = {"command": command}
        final_output = ""

        try:
            response = requests.post(api_endpoint, json=payload, timeout=310)
            response.raise_for_status()
            data = response.json()
            
            self.socketio.emit('sandbox-command-finished', {
                'artifactId': artifactId,
                'stdout': data.get('stdout', ''),
                'stderr': data.get('stderr', ''),
                'exitCode': data.get('exit_code', -1)
            })

            if data.get("stdout"): final_output += f"STDOUT:\n{data['stdout']}\n"
            if data.get("stderr"): final_output += f"STDERR:\n{data['stderr']}\n"
            final_output += f"Exit Code: {data['exit_code']}"

        except requests.RequestException as e:
            error_message = f"Error communicating with the sandbox service: {e}"
            self.socketio.emit('sandbox-command-finished', {
                'artifactId': artifactId, 'stdout': '', 'stderr': error_message, 'exitCode': -1
            })
            final_output = error_message

        return final_output