# python-backend/sandbox_tools.py
import os
import requests
from agno.tools import Toolkit
from typing import Optional, Set

class SandboxTools(Toolkit):
    """
    A toolkit for creating, managing, and interacting with a stateful, isolated sandbox environment.
    This toolkit follows a strict lifecycle: create -> execute -> close.
    """
    def __init__(self, sandbox_tracker_set: Optional[Set[str]] = None):
        """
        Initializes the SandboxTools.
        Args:
            sandbox_tracker_set (Optional[Set[str]]): A set to track the IDs of created sandboxes
                                                     for automatic cleanup on session termination.
        """
        super().__init__(
            name="sandbox_tools",
            tools=[self.create_sandbox, self.execute_in_sandbox, self.close_sandbox]
        )
        self.sandbox_tracker_set = sandbox_tracker_set
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
            response = requests.post(f"{self.sandbox_api_url}/sessions", timeout=30)
            response.raise_for_status()
            data = response.json()
            sandbox_id = data.get("sandbox_id")
            
            # If a tracker set was provided, add the new ID to it for cleanup.
            if self.sandbox_tracker_set is not None and sandbox_id:
                self.sandbox_tracker_set.add(sandbox_id)
                
            return f"Sandbox created with ID: {sandbox_id}"
        except requests.RequestException as e:
            return f"Error creating sandbox: {e}"

    def execute_in_sandbox(self, sandbox_id: str, command: str) -> str:
        """
        Executes a shell command inside a specific, existing sandbox session.
        This can be called multiple times after a sandbox is created.
        Args:
            sandbox_id (str): The ID of the sandbox session, obtained from create_sandbox.
            command (str): The shell command to execute.
        """
        if not sandbox_id:
            return "Error: sandbox_id is required. You must call create_sandbox() first."
            
        try:
            response = requests.post(
                f"{self.sandbox_api_url}/sessions/{sandbox_id}/exec",
                json={"command": command},
                timeout=310 # Long timeout for potentially long-running commands
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
        This should be called when the entire task is complete to free up resources.
        Args:
            sandbox_id (str): The ID of the sandbox session to close.
        """
        if not sandbox_id:
            return "Error: sandbox_id is required."

        try:
            response = requests.delete(f"{self.sandbox_api_url}/sessions/{sandbox_id}", timeout=30)
            response.raise_for_status()
            
            if self.sandbox_tracker_set is not None and sandbox_id in self.sandbox_tracker_set:
                self.sandbox_tracker_set.remove(sandbox_id)
                
            return response.json().get("message", "Session terminated.")
        except requests.RequestException as e:
            return f"Error closing sandbox: {e}"