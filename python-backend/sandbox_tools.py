# python-backend/sandbox_tools.py
import os
import requests
from agno.tools import Toolkit

class SandboxTools(Toolkit):
    def __init__(self, socketio_instance=None): # socketio_instance is no longer needed here
        super().__init__(
            name="sandbox_tools",
            tools=[self.create_sandbox, self.execute_in_sandbox, self.close_sandbox]
        )
        self.sandbox_api_url = os.getenv("SANDBOX_API_URL")
        if not self.sandbox_api_url:
            raise ValueError("SANDBOX_API_URL environment variable is not set.")

    def create_sandbox(self) -> str:
        """
        Creates a new, stateful sandbox session for executing commands.
        This MUST be called before any command execution.
        Returns a unique sandbox_id that must be used for all subsequent calls.
        """
        try:
            response = requests.post(f"{self.sandbox_api_url}/sessions")
            response.raise_for_status()
            data = response.json()
            return f"Sandbox created with ID: {data['sandbox_id']}"
        except requests.RequestException as e:
            return f"Error creating sandbox: {e}"

    def execute_in_sandbox(self, sandbox_id: str, command: str) -> str:
        """
        Executes a shell command inside a specific sandbox session.
        Args:
            sandbox_id (str): The ID of the sandbox session, obtained from create_sandbox.
            command (str): The shell command to execute.
        """
        try:
            response = requests.post(
                f"{self.sandbox_api_url}/sessions/{sandbox_id}/exec",
                json={"command": command}
            )
            response.raise_for_status()
            data = response.json()
            
            output = ""
            if data.get("stdout"):
                output += f"STDOUT:\n{data['stdout']}\n"
            if data.get("stderr"):
                output += f"STDERR:\n{data['stderr']}\n"
            output += f"Exit Code: {data['exit_code']}"
            return output
            
        except requests.RequestException as e:
            return f"Error executing command: {e}"

    def close_sandbox(self, sandbox_id: str) -> str:
        """
        Terminates and cleans up a sandbox session.
        This should be called when the task is complete to free up resources.
        Args:
            sandbox_id (str): The ID of the sandbox session to close.
        """
        try:
            response = requests.delete(f"{self.sandbox_api_url}/sessions/{sandbox_id}")
            response.raise_for_status()
            return response.json().get("message", "Session terminated.")
        except requests.RequestException as e:
            return f"Error closing sandbox: {e}"