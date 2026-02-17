# python-backend/sandbox_tools.py (Complete, Updated Version with Persistence)

import os
import requests
import eventlet
from agno.tools import Toolkit
from typing import Optional, Set, Dict, Any, List
import logging

logger = logging.getLogger(__name__)

class SandboxTools(Toolkit):
    """
    A state-aware toolkit for interacting with an isolated sandbox environment.
    It ensures one sandbox is created and reused per session.
    Now includes automatic persistence of execution history to Postgres + R2.
    """
    def __init__(
        self, 
        session_info: Dict[str, Any],
        persistence_service=None,
        user_id: str = None,
        session_id: str = None,
        message_id: str = None,
        socketio=None,
        sid: str = None
    ):
        """
        Initializes the SandboxTools with session-specific information.
        Args:
            session_info (Dict[str, Any]): The dictionary for the current user session.
            persistence_service: SandboxPersistenceService instance (optional)
            user_id: User ID for persistence (optional)
            session_id: Session ID for persistence (optional)
            message_id: Message ID for linking to frontend (optional)
            socketio: Socket.IO instance for real-time events (optional)
            sid: Socket ID for emitting events (optional)
        """
        super().__init__(
            name="sandbox_tools",
            tools=[self.execute_in_sandbox]
        )
        self.session_info = session_info
        self.sandbox_api_url = os.getenv("SANDBOX_API_URL")
        if not self.sandbox_api_url:
            raise ValueError("SANDBOX_API_URL environment variable is not set.")
        
        # Persistence dependencies
        self.persistence_service = persistence_service
        self.user_id = user_id
        self.session_id = session_id
        self.message_id = message_id
        self.socketio = socketio
        self.sid = sid

    def _create_or_get_sandbox_id(self) -> Optional[str]:
        """
        Internal helper function. Creates a new sandbox if one doesn't exist for this session,
        otherwise returns the ID of the existing sandbox.
        Returns the unique sandbox_id string or None if creation fails.
        """
        active_id = self.session_info.get("active_sandbox_id")
        if active_id:
            return active_id

        try:
            response = requests.post(f"{self.sandbox_api_url}/sessions", timeout=30)
            response.raise_for_status()
            data = response.json()
            new_sandbox_id = data.get("sandbox_id")

            if new_sandbox_id:
                self.session_info["active_sandbox_id"] = new_sandbox_id
                # This correctly handles the list from Redis session data.
                if "sandbox_ids" not in self.session_info:
                    self.session_info["sandbox_ids"] = []
                if new_sandbox_id not in self.session_info["sandbox_ids"]:
                    self.session_info["sandbox_ids"].append(new_sandbox_id)
                
                return new_sandbox_id
            else:
                logger.error("Sandbox: No valid ID returned")
                return None

        except requests.RequestException as e:
            logger.error(f"Sandbox creation failed: {e}")
            return None

    def execute_in_sandbox(self, command: str) -> str:
        """
        Executes a shell command inside an isolated sandbox environment.
        If a sandbox for the current session does not exist, it will be created automatically.
        Now automatically persists execution history to Postgres + R2.
        Also tracks file artifacts created during execution.
        
        Args:
            command (str): The shell command to execute (e.g., 'ls -la', 'git clone ...').
        """
        # Get or create sandbox
        sandbox_id = self._create_or_get_sandbox_id()
        if not sandbox_id:
            return "Error: Failed to create or retrieve the sandbox session. Cannot execute command."
        
        # Snapshot files BEFORE execution (for artifact detection)
        files_before = set()
        if self.persistence_service and self.user_id and self.session_id:
            try:
                files_before = self._get_sandbox_files(sandbox_id)
            except Exception as e:
                logger.warning(f"Failed to snapshot files before execution: {e}")
        
        # Create execution record in Postgres (if persistence is enabled)
        execution_id = None
        if self.persistence_service and self.user_id and self.session_id:
            try:
                execution_id = self.persistence_service.create_execution_record(
                    user_id=self.user_id,
                    session_id=self.session_id,
                    sandbox_id=sandbox_id,
                    command=command,
                    message_id=self.message_id
                )
                logger.info(f"Created execution record: {execution_id}")
                
                # Emit socket event: command started
                if self.socketio and self.sid:
                    self.socketio.emit("sandbox-command-started", {
                        "id": self.message_id,
                        "execution_id": execution_id,
                        "command": command
                    }, room=self.sid)
                    
            except Exception as e:
                logger.error(f"Failed to create execution record: {e}")
                # Don't fail the command execution if persistence fails
        
        # Execute command in sandbox
        try:
            response = requests.post(
                f"{self.sandbox_api_url}/sessions/{sandbox_id}/exec",
                json={"command": command},
                timeout=310
            )
            response.raise_for_status()
            data = response.json()
            
            stdout = data.get("stdout", "")
            stderr = data.get("stderr", "")
            exit_code = data.get("exit_code", 0)
            
            # Persist output asynchronously (non-blocking)
            if execution_id and self.persistence_service:
                eventlet.spawn(
                    self._persist_output_async,
                    execution_id,
                    stdout,
                    stderr,
                    exit_code
                )
            
            # Emit socket event: command finished (without artifacts - they come later)
            if self.socketio and self.sid:
                self.socketio.emit("sandbox-command-finished", {
                    "id": self.message_id,
                    "execution_id": execution_id,
                    "command": command,
                    "stdout": stdout,
                    "stderr": stderr,
                    "exit_code": exit_code
                }, room=self.sid)
            
            # Detect and process artifacts AFTER emitting command finished
            # This happens asynchronously so chat isn't blocked
            if self.persistence_service and self.user_id and self.session_id and execution_id:
                eventlet.spawn(
                    self._detect_and_emit_artifacts_async,
                    sandbox_id,
                    execution_id,
                    files_before
                )
            
            # Format output for agent
            output = ""
            if stdout:
                output += f"STDOUT:\n{stdout}\n"
            if stderr:
                output += f"STDERR:\n{stderr}\n"
            if exit_code != 0:
                output += f"Exit Code: {exit_code}"

            return output if output else "Command executed successfully with no output."
            
        except requests.RequestException as e:
            logger.error(f"Failed to execute command in sandbox {sandbox_id}: {e}", exc_info=True)
            
            # Mark execution as failed if persistence is enabled
            if execution_id and self.persistence_service:
                try:
                    self.persistence_service.persist_execution_output(
                        execution_id=execution_id,
                        stdout="",
                        stderr=f"Error: {str(e)}",
                        exit_code=-1
                    )
                except:
                    pass
            
            return f"Error executing command: {e}"
    
    def _get_sandbox_files(self, sandbox_id: str) -> Set[str]:
        """
        Get set of file paths in sandbox.
        Used for detecting new files after command execution.
        
        Returns:
            Set of file paths
        """
        try:
            response = requests.get(
                f"{self.sandbox_api_url}/sessions/{sandbox_id}/files",
                params={"path": "/home/sandboxuser"},
                timeout=30
            )
            response.raise_for_status()
            data = response.json()
            
            # Return set of file paths
            return {f['path'] for f in data.get('files', [])}
            
        except Exception as e:
            logger.error(f"Failed to list sandbox files: {e}")
            return set()
    
    def _process_artifacts(
        self,
        sandbox_id: str,
        execution_id: str,
        file_paths: Set[str],
        message_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Process new files as artifacts: download from sandbox, upload to R2, store in DB.
        
        Args:
            sandbox_id: Sandbox ID
            execution_id: Execution ID
            file_paths: Set of file paths to process
            message_id: Frontend message ID for linking
            
        Returns:
            List of artifact metadata dicts
        """
        artifacts = []
        
        # Limit to reasonable number of files
        MAX_ARTIFACTS = 20
        file_list = list(file_paths)[:MAX_ARTIFACTS]
        
        for file_path in file_list:
            try:
                # Skip system files and hidden files
                if file_path.startswith('/home/sandboxuser/.'):
                    continue
                
                # Get file content from sandbox
                response = requests.get(
                    f"{self.sandbox_api_url}/sessions/{sandbox_id}/files/content",
                    params={"filepath": file_path},
                    timeout=30
                )
                
                if response.status_code != 200:
                    logger.warning(f"Failed to read file {file_path}: {response.status_code}")
                    continue
                
                file_data = response.json()
                file_content_raw = file_data.get('content', '')
                encoding = file_data.get('encoding', 'utf-8')
                
                # Decode based on encoding
                if encoding == 'base64':
                    import base64
                    file_content = base64.b64decode(file_content_raw)
                elif isinstance(file_content_raw, str):
                    file_content = file_content_raw.encode('utf-8')
                elif isinstance(file_content_raw, bytes):
                    file_content = file_content_raw
                else:
                    # It's likely a list of integers (byte array from JSON)
                    file_content = bytes(file_content_raw)
                
                # Skip empty files
                if not file_content or len(file_content) == 0:
                    continue
                
                # Skip very large files (> 10MB)
                if len(file_content) > 10 * 1024 * 1024:
                    logger.warning(f"Skipping large file {file_path}: {len(file_content)} bytes")
                    continue
                
                # Create artifact in persistence service
                artifact_id = self.persistence_service.create_artifact(
                    execution_id=execution_id,
                    user_id=self.user_id,
                    session_id=self.session_id,
                    sandbox_id=sandbox_id,
                    file_path=file_path,
                    file_content=file_content,
                    message_id=message_id
                )
                
                if artifact_id:
                    import os
                    filename = os.path.basename(file_path)
                    
                    artifacts.append({
                        'artifact_id': artifact_id,
                        'filename': filename,
                        'file_path': file_path,
                        'size_bytes': len(file_content),
                        'execution_id': execution_id
                    })
                    logger.info(f"Created artifact {artifact_id} for file {file_path}")
                    
            except Exception as e:
                logger.error(f"Failed to process artifact {file_path}: {e}")
                continue
        
        return artifacts
    
    def _persist_output_async(self, execution_id, stdout, stderr, exit_code):
        """
        Asynchronously persist execution output to avoid blocking agent execution.
        This runs in a separate greenlet.
        """
        try:
            self.persistence_service.persist_execution_output(
                execution_id=execution_id,
                stdout=stdout,
                stderr=stderr,
                exit_code=exit_code
            )
            logger.info(f"Persisted output for execution {execution_id}")
        except Exception as e:
            logger.error(f"Failed to persist output asynchronously: {e}")
    
    def _detect_and_emit_artifacts_async(self, sandbox_id, execution_id, files_before):
        """
        Asynchronously detect new files and emit artifact event to frontend.
        This runs in a separate greenlet to avoid blocking the chat.
        
        Args:
            sandbox_id: Sandbox ID
            execution_id: Execution ID
            files_before: Set of file paths before command execution
        """
        try:
            # Get files after execution
            files_after = self._get_sandbox_files(sandbox_id)
            new_files = files_after - files_before
            
            if not new_files:
                logger.info(f"No new files detected for execution {execution_id}")
                return
            
            logger.info(f"Detected {len(new_files)} new/modified files")
            
            # Process artifacts (download, upload to R2, store in DB)
            artifacts_data = self._process_artifacts(
                sandbox_id, execution_id, new_files, self.message_id
            )
            
            if not artifacts_data:
                logger.info(f"No artifacts created for execution {execution_id}")
                return
            
            # Emit separate socket event with artifact data
            if self.socketio and self.sid:
                self.socketio.emit("sandbox-artifacts-created", {
                    "id": self.message_id,
                    "execution_id": execution_id,
                    "artifacts": artifacts_data
                }, room=self.sid)
                logger.info(f"Emitted artifact event with {len(artifacts_data)} artifacts")
            
        except Exception as e:
            logger.error(f"Failed to detect and emit artifacts: {e}", exc_info=True)
