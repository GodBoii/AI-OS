# python-backend/sandbox_tools.py
import os
import requests
from agno.tools import Toolkit
import uuid # Import the uuid library

socketio = None

def set_socketio_instance(sio):
    global socketio
    socketio = sio

class SandboxTools(Toolkit):
    def __init__(self):
        super().__init__(
            name="sandbox_tools",
            # Register both new tools
            tools=[self.prepare_sandbox_terminal, self.execute_command_in_terminal]
        )
        self.sandbox_api_url = os.getenv("SANDBOX_API_URL")
        if not self.sandbox_api_url:
            raise ValueError("SANDBOX_API_URL environment variable is not set.")

    def prepare_sandbox_terminal(self) -> str:
        """
        Prepares a new terminal window on the user's screen and returns its unique ID.
        This MUST be called before executing any command.
        
        Returns:
            A unique artifactId for the newly created terminal.
        """
        if not socketio:
            return "Error: Socket.IO instance not available."

        # Step 1: Programmatically generate a unique ID
        artifact_id = f"terminal-{uuid.uuid4()}"

        # Step 2: Emit the event to open a blank, waiting terminal on the frontend
        socketio.emit('sandbox-command-started', {
            'artifactId': artifact_id,
            'command': None, # No command yet, it's just preparing
            'status': 'waiting'
        })

        # Step 3: Return the ID to the agent
        return artifact_id

    def execute_command_in_terminal(self, command: str, artifactId: str) -> str:
        """
        Executes a shell command and sends the output to a specific, already-prepared terminal window.
        
        Args:
            command: The shell command to execute.
            artifactId: The unique ID of the terminal window, obtained from prepare_sandbox_terminal().
        
        Returns:
            A string containing the stdout and stderr from the command execution.
        """
        if not socketio:
            return "Error: Socket.IO instance not available."

        # Immediately update the terminal with the command being run
        socketio.emit('sandbox-command-update', {
            'artifactId': artifactId,
            'command': command
        })

        api_endpoint = f"{self.sandbox_api_url}/execute"
        payload = {"command": command}
        final_output = ""

        try:
            response = requests.post(api_endpoint, json=payload, timeout=310)
            response.raise_for_status()
            data = response.json()
            
            socketio.emit('sandbox-command-finished', {
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
            socketio.emit('sandbox-command-finished', {
                'artifactId': artifactId, 'stdout': '', 'stderr': error_message, 'exitCode': -1
            })
            final_output = error_message

        return final_output