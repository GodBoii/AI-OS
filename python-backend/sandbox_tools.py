# python-backend/sandbox_tools.py (Complete, Robust Version)

import os
import requests
from agno.tools import Toolkit
from typing import Optional, Set, Dict, Any
import logging

logger = logging.getLogger(__name__)

class SandboxTools(Toolkit):
    """
    A state-aware toolkit for interacting with an isolated sandbox environment.
    It ensures one sandbox is created and reused per session.
    """
    def __init__(self, session_info: Dict[str, Any]):
        """
        Initializes the SandboxTools with session-specific information.
        Args:
            session_info (Dict[str, Any]): The dictionary for the current user session.
                                           It must contain 'sandbox_ids' (a set) and
                                           can contain 'active_sandbox_id' (a string).
        """
        super().__init__(
            name="sandbox_tools",
            tools=[self.create_or_get_sandbox, self.execute_in_sandbox]
            # Note: close_sandbox is removed from the agent's available tools
            # as cleanup is now fully automatic on session disconnect.
        )
        self.session_info = session_info
        self.sandbox_api_url = os.getenv("SANDBOX_API_URL")
        if not self.sandbox_api_url:
            raise ValueError("SANDBOX_API_URL environment variable is not set.")

    def create_or_get_sandbox(self) -> str:
        """
        Creates a new sandbox if one doesn't exist for this session, otherwise returns
        the ID of the existing sandbox. This MUST be called before any command execution.
        Returns the unique sandbox_id for the current session.
        """
        # Check if a sandbox ID is already stored for this session
        active_id = self.session_info.get("active_sandbox_id")
        if active_id:
            logger.info(f"Reusing existing sandbox for session: {active_id}")
            return f"Existing sandbox ready with ID: {active_id}"

        # If no active sandbox, create a new one
        logger.info("No active sandbox found for session, creating a new one.")
        try:
            response = requests.post(f"{self.sandbox_api_url}/sessions", timeout=30)
            response.raise_for_status()
            data = response.json()
            new_sandbox_id = data.get("sandbox_id")

            if new_sandbox_id:
                # Store the new ID in the session dictionary for reuse
                self.session_info["active_sandbox_id"] = new_sandbox_id
                # Add to the tracker set for automatic cleanup on disconnect
                self.session_info.get("sandbox_ids", set()).add(new_sandbox_id)
                logger.info(f"Created and stored new sandbox ID: {new_sandbox_id}")
                return f"New sandbox created with ID: {new_sandbox_id}"
            else:
                return "Error: Sandbox service did not return a valid ID."

        except requests.RequestException as e:
            logger.error(f"Failed to create sandbox: {e}", exc_info=True)
            return f"Error creating sandbox: {e}"

    def execute_in_sandbox(self, sandbox_id: str, command: str) -> str:
        """
        Executes a shell command inside the specified sandbox session.
        Args:
            sandbox_id (str): The ID of the sandbox session, obtained from create_or_get_sandbox.
            command (str): The shell command to execute.
        """
        if not sandbox_id:
            return "Error: sandbox_id is required. You must call create_or_get_sandbox() first."

        # The agent might pass the full string from the create tool, so we extract the ID.
        if "ID:" in sandbox_id:
            try:
                sandbox_id = sandbox_id.split("ID:")[1].strip()
            except IndexError:
                return "Error: Could not parse sandbox_id. Please provide the ID directly."

        try:
            response = requests.post(
                f"{self.sandbox_api_url}/sessions/{sandbox_id}/exec",
                json={"command": command},
                timeout=310
            )
            response.raise_for_status()
            data = response.json()
            
            output = ""
            if data.get("stdout"):
                output += f"STDOUT:\n{data['stdout']}\n"
            if data.get("stderr"):
                output += f"STDERR:\n{data['stderr']}\n"
            
            # Only add exit code if it's not 0 for cleaner output
            if data.get("exit_code", 0) != 0:
                output += f"Exit Code: {data['exit_code']}"

            return output if output else "Command executed successfully with no output."
            
        except requests.RequestException as e:
            logger.error(f"Failed to execute command in sandbox {sandbox_id}: {e}", exc_info=True)
            return f"Error executing command: {e}"