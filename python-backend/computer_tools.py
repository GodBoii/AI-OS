# python-backend/computer_tools.py
# Computer Control Toolkit for AI Agent Desktop Automation

import logging
import uuid
import json
import base64
import time
from typing import Dict, Any, Literal, Union, Optional

from redis import Redis

from agno.media import Image
from agno.tools import Toolkit
from agno.tools.function import ToolResult
from supabase_client import supabase_client

COMPUTER_COMMAND_TIMEOUT_SECONDS = 120

logger = logging.getLogger(__name__)


class ComputerTools(Toolkit):
    """
    A comprehensive toolkit for controlling desktop computers through AI agents.
    Provides perception, interaction, window management, and system control capabilities.
    
    This toolkit uses Redis Pub/Sub for scalable, distributed command handling,
    making it safe for multi-worker environments.
    """

    def __init__(self, sid: str, socketio, redis_client: Redis, **kwargs):
        """
        Initializes the ComputerTools toolkit.

        Args:
            sid (str): The unique Socket.IO session ID for the connected client.
            socketio: The main Flask-SocketIO server instance.
            redis_client (Redis): An initialized Redis client for Pub/Sub.
        """
        self.sid = sid
        self.socketio = socketio
        self.redis_client = redis_client
        self.message_id = kwargs.pop("message_id", None)
        self.conversation_id = kwargs.pop("conversation_id", None)
        self.delegation_id = kwargs.pop("delegation_id", None)
        self.delegated_agent = kwargs.pop("delegated_agent", None)

        super().__init__(
            name="computer_tools",
            tools=[
                # Permission & Status
                self.get_status,
                self.request_permission,
                
                # Perception Layer
                self.take_screenshot,
                self.get_active_window,
                self.get_cursor_position,
                self.read_clipboard,
                self.ocr_screen,
                
                # Interaction Layer
                self.move_mouse,
                self.click_mouse,
                self.type_text,
                self.press_hotkey,
                self.scroll,
                self.drag_drop,
                
                # Window Management
                self.list_windows,
                self.focus_window,
                self.resize_window,
                self.minimize_window,
                self.maximize_window,
                self.close_window,
                
                # System Layer
                self.run_command,
                self.list_files,
                self.read_file,
                self.write_file,
                self.delete_file,
                self.create_directory,
                self.open_application,
                self.close_application,
                self.get_volume,
                self.set_volume,
                self.get_system_info,

                # OS Status & Control
                self.get_battery_status,
                self.get_brightness,
                self.set_brightness,
                self.get_network_status,
                self.get_bluetooth_status,
                self.get_focus_status,
                self.list_processes,
                self.kill_process,
                self.open_path,
                self.reveal_in_folder,
                
                # Application Discovery
                self.list_installed_apps,
                
                # Screen Element Detection (Accessibility API)
                self.get_screen_elements,
                self.find_element_by_text,
                self.get_window_state,
                self.perform_element_action,
            ],
        )

    def _frontend_room(self) -> Optional[str]:
        if self.conversation_id:
            return f"conv:{self.conversation_id}"
        return self.sid

    def _attach_delegation_metadata(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if self.delegation_id:
            payload["delegation_id"] = self.delegation_id
        if self.delegated_agent:
            payload["delegated_agent"] = self.delegated_agent
        return payload

    def _process_screenshot_result(self, result: Dict[str, Any]) -> ToolResult:
        """Process result with screenshot."""
        result = dict(result)
        screenshot_path = result.pop("screenshot_path", None)
        screenshot_base64 = result.pop("screenshot_base64", None)
        if result.get("status") == "success":
            try:
                if screenshot_base64:
                    if not isinstance(screenshot_base64, str) or len(screenshot_base64) > 24_000_000:
                        raise ValueError("Invalid or oversized inline screenshot")
                    image_bytes = base64.b64decode(screenshot_base64, validate=True)
                elif screenshot_path:
                    image_bytes = supabase_client.storage.from_('media-uploads').download(screenshot_path)
                else:
                    raise ValueError("No screenshot bytes or storage path returned")
                image_artifact = Image(content=image_bytes)
                return ToolResult(content=json.dumps(result), images=[image_artifact])
            except Exception:
                logger.exception("Computer screenshot retrieval failed")
                result["status"] = "error"
                result["error"] = "Could not retrieve the captured screenshot. Capture again before coordinate input."
                return ToolResult(content=json.dumps(result))
        
        return ToolResult(content=json.dumps(result))

    def _emit_tool_result_preview(self, action: str, result: Dict[str, Any]) -> None:
        """Emit frontend-only preview metadata for computer tool outputs."""
        metadata = result.get("metadata")
        if not isinstance(metadata, dict):
            logger.info("[ComputerToolPreview] Skip emit for '%s': missing metadata", action)
            return
        if metadata.get("kind") != "computer_tool_output":
            logger.info(
                "[ComputerToolPreview] Skip emit for '%s': unsupported metadata kind=%s",
                action,
                metadata.get("kind"),
            )
            return

        payload = {
            "id": self.message_id,
            "conversation_id": self.conversation_id,
            "tool_name": action,
            "metadata": metadata,
        }
        payload = self._attach_delegation_metadata(payload)
        logger.info(
            "[ComputerToolPreview] Emitting preview event action=%s message_id=%s preview_type=%s output_id=%s",
            action,
            self.message_id,
            metadata.get("preview_type"),
            metadata.get("output_id"),
        )
        room_name = self._frontend_room()
        if not room_name:
            return
        self.socketio.emit("computer_tool_result_preview", payload, room=room_name)

    def _send_command_and_wait(self, command_payload: Dict[str, Any]) -> Union[Dict[str, Any], ToolResult]:
        """
        Sends a command to the client via SocketIO and waits for the response
        on a unique Redis Pub/Sub channel with a bounded wait and subscription cleanup.
        """
        if not self.sid or not self.socketio or not self.redis_client:
            return {"status": "error", "error": "Computer bridge is unavailable in this session/device."}
        command_payload = dict(command_payload)
        command_timeout = COMPUTER_COMMAND_TIMEOUT_SECONDS
        typing_text = command_payload.get('text') if command_payload.get('action') == 'type_text' else (
            command_payload.get('value') if command_payload.get('element_action') == 'set_value' else None
        )
        if isinstance(typing_text, str) and len(typing_text) > 500:
            # Desktop speed is a local preference. Allow the slowest configured
            # pace rather than timing out a valid long entry at 120 seconds.
            command_timeout = max(command_timeout, 30 + len(typing_text) * 0.22)
        request_id = str(uuid.uuid4())
        command_payload['request_id'] = request_id
        command_payload['expires_at_ms'] = int((time.time() + command_timeout) * 1000)
        if self.message_id:
            command_payload['message_id'] = self.message_id
        if self.conversation_id:
            command_payload['conversation_id'] = self.conversation_id
        if self.delegation_id:
            command_payload['delegation_id'] = self.delegation_id
        if self.delegated_agent:
            command_payload['delegated_agent'] = self.delegated_agent
        action = command_payload.get('action')
        
        response_channel = f"computer-response:{request_id}"
        pubsub = None
        
        try:
            pubsub = self.redis_client.pubsub()
            pubsub.subscribe(response_channel)
            deadline = time.monotonic() + command_timeout
            # A fast desktop response must not race ahead of Redis subscription setup.
            subscribed = False
            while time.monotonic() < deadline:
                message = pubsub.get_message(timeout=min(1.0, max(0.0, deadline - time.monotonic())))
                if message and message.get('type') == 'subscribe':
                    channel = message.get('channel')
                    if isinstance(channel, bytes):
                        channel = channel.decode('utf-8')
                    if channel == response_channel:
                        subscribed = True
                        break
            if not subscribed:
                return {"status": "error", "error": "Computer response subscription did not become ready. No command was sent.",
                        "request_id": request_id, "outcome": "not_executed"}
            
            # 1. Send the command to the client
            self.socketio.emit('computer-command', command_payload, room=self.sid)
            logger.info(f"ComputerTools: Sent command '{action}' to client {self.sid}")
            
            # 2. Emit notification to client about tool usage
            self._emit_tool_notification(action, command_payload)

            # 3. Wait for a message on the subscribed channel
            while time.monotonic() < deadline:
                message = pubsub.get_message(timeout=min(1.0, max(0.0, deadline - time.monotonic())))
                if message and message['type'] == 'message':
                    result = json.loads(message['data'])
                    if not isinstance(result, dict):
                        raise ValueError("Computer bridge returned a non-object response")
                    self._emit_tool_result_preview(action, result)
                    
                    # Process screenshot results specially
                    if "screenshot_path" in result or "screenshot_base64" in result:
                        return self._process_screenshot_result(result)
                    
                    return ToolResult(content=json.dumps(result))

            return {"status": "error", "error": "Computer command timed out. Its outcome is unknown; observe before retrying.",
                    "request_id": request_id, "outcome": "unknown"}

        except Exception as e:
            logger.exception("Computer command failed action=%s request_id=%s", action, request_id)
            return {"status": "error", "error": f"An internal error occurred: {e}"}
        finally:
            # 4. Always clean up the subscription
            if pubsub is not None:
                try:
                    pubsub.unsubscribe(response_channel)
                except Exception:
                    logger.exception("Computer response unsubscribe failed")
                finally:
                    try:
                        pubsub.close()
                    except Exception:
                        logger.exception("Computer response cleanup failed")
    
    def _emit_tool_notification(self, action: str, payload: Dict[str, Any]) -> None:
        """Emit notification to client about computer tool usage."""
        # Map actions to user-friendly messages
        action_messages = {
            'take_screenshot': 'Captured screen',
            'get_active_window': 'Checked active window',
            'get_cursor_position': 'Read cursor position',
            'read_clipboard': 'Read clipboard',
            'ocr_screen': 'Extracted text from screen',
            'move_mouse': f"Moved mouse to ({payload.get('x', '?')}, {payload.get('y', '?')})",
            'click_mouse': f"Clicked {payload.get('button', 'left')} mouse button",
            'type_text': f"Typed text",
            'press_hotkey': f"Pressed {payload.get('keys', 'hotkey')}",
            'scroll': f"Scrolled {payload.get('direction', 'down')}",
            'drag_drop': 'Performed drag & drop',
            'list_windows': 'Listed open windows',
            'focus_window': f"Focused window",
            'resize_window': 'Resized window',
            'minimize_window': 'Minimized window',
            'maximize_window': 'Maximized window',
            'close_window': 'Closed window',
            'run_command': f"Executed command",
            'list_files': f"Listed files in {payload.get('directory', 'directory')}",
            'read_file': f"Read file",
            'write_file': f"Wrote to file",
            'delete_file': f"Deleted file",
            'create_directory': f"Created directory",
            'open_application': f"Opened {payload.get('app_name', 'application')}",
            'close_application': f"Closed {payload.get('app_name', 'application')}",
            'get_volume': 'Checked system volume',
            'set_volume': f"Set volume to {payload.get('volume', '?')}%",
            'get_system_info': 'Retrieved system information',
            'list_installed_apps': 'Scanning installed applications',
            'get_screen_elements': 'Reading UI elements from screen',
            'find_element_by_text': f"Searching for element: {payload.get('text', '?')}",
            'get_battery_status': 'Checked battery status',
            'get_brightness': 'Checked screen brightness',
            'set_brightness': f"Set brightness to {payload.get('level', '?')}%",
            'get_network_status': 'Checked network status',
            'get_bluetooth_status': 'Checked Bluetooth status',
            'get_focus_status': 'Checked Do Not Disturb status',
            'list_processes': 'Listed running processes',
            'kill_process': f"Stopped process {payload.get('pid', '?')}",
            'open_path': 'Opened a file',
            'reveal_in_folder': 'Showed a file in its folder',
        }
        
        message = action_messages.get(action, f"Executed {action.replace('_', ' ')}")
        
        # Emit notification event to client
        if not self.sid:
            return
        self.socketio.emit('computer-tool-notification', {
            'action': action,
            'message': message,
            'delegation_id': self.delegation_id,
            'delegated_agent': self.delegated_agent,
            'timestamp': str(uuid.uuid4())  # Use as unique ID
        }, room=self.sid)

    # ===== PERMISSION & STATUS =====

    def get_status(self) -> Union[Dict[str, Any], ToolResult]:
        """
        Get the current status of computer control.
        Returns whether control is enabled, platform info, and screen size.
        """
        return self._send_command_and_wait({'action': 'get_status'})

    def request_permission(self) -> Union[Dict[str, Any], ToolResult]:
        """
        Request permission to control the computer.
        Must be called before any other computer control operations.
        """
        return self._send_command_and_wait({'action': 'request_permission'})

    # ===== PERCEPTION LAYER =====

    def take_screenshot(self, window_id: Optional[int] = None, display_id: Optional[str] = None) -> Union[Dict[str, Any], ToolResult]:
        """
        Take a screenshot of the entire screen.
        Returns the screenshot as an image artifact for vision model analysis.
        
        Use this to see what's currently on the screen before taking actions.
        """
        payload = {'action': 'take_screenshot', **self._target(window_id)}
        if display_id is not None:
            payload['display_id'] = display_id
        return self._send_command_and_wait(payload)

    def get_active_window(self) -> Union[Dict[str, Any], ToolResult]:
        """
        Get information about the currently active window.
        Returns window title, owner application, bounds, and platform.
        
        Use this to understand what application the user is currently using.
        """
        return self._send_command_and_wait({'action': 'get_active_window'})

    def get_cursor_position(self) -> Union[Dict[str, Any], ToolResult]:
        """
        Get the current mouse cursor position.
        Returns x and y coordinates.
        """
        return self._send_command_and_wait({'action': 'get_cursor_position'})

    def read_clipboard(self) -> Union[Dict[str, Any], ToolResult]:
        """
        Read the current clipboard contents.
        Returns text content and whether an image is present.
        
        Use this to see what the user has copied.
        """
        return self._send_command_and_wait({'action': 'read_clipboard'})

    def ocr_screen(self, window_id: Optional[int] = None) -> Union[Dict[str, Any], ToolResult]:
        """
        Perform OCR (Optical Character Recognition) on the current screen.
        Returns English text, OCR confidence, and word-center screen coordinates.
        Recognition runs locally. Small labels can be misread; prefer accessibility
        controls when available and verify OCR targets against the screenshot.
        """
        return self._send_command_and_wait({'action': 'ocr_screen', **self._target(window_id)})

    # ===== INTERACTION LAYER =====

    def move_mouse(self, x: int, y: int, smooth: bool = False, window_id: Optional[int] = None, screenshot_id: Optional[str] = None) -> Union[Dict[str, Any], ToolResult]:
        """
        Move the mouse cursor to specific coordinates.
        
        Args:
            x: X coordinate on screen
            y: Y coordinate on screen
            smooth: If True, moves smoothly; if False, jumps instantly
        
        Use this after analyzing a screenshot to position the cursor.
        """
        return self._send_command_and_wait({
            'action': 'move_mouse',
            **self._target(window_id, screenshot_id),
            'x': x,
            'y': y,
            'smooth': smooth
        })

    def click_mouse(
        self, 
        button: Literal['left', 'right', 'middle'] = 'left',
        double: bool = False,
        x: Optional[int] = None,
        y: Optional[int] = None,
        window_id: Optional[int] = None,
        screenshot_id: Optional[str] = None,
    ) -> Union[Dict[str, Any], ToolResult]:
        """
        Click the mouse button at current position or specified coordinates.
        
        Args:
            button: Which mouse button to click ('left', 'right', 'middle')
            double: If True, performs a double-click
            x: Optional X coordinate to click at
            y: Optional Y coordinate to click at
        
        If x and y are provided, moves to that position first, then clicks.
        Pass window_id to bind input to the app. With screenshot_id, x/y are pixels
        in that screenshot. Otherwise they are absolute screen pixels.
        """
        payload = {
            'action': 'click_mouse',
            **self._target(window_id, screenshot_id),
            'button': button,
            'double': double
        }
        if x is not None:
            payload['x'] = x
        if y is not None:
            payload['y'] = y
        
        return self._send_command_and_wait(payload)

    def type_text(self, text: str, window_id: Optional[int] = None) -> Union[Dict[str, Any], ToolResult]:
        """
        Type text at the current cursor position.
        
        Args:
            text: The text to type
        
        Make sure to click on an input field first before typing.
        Uses the user's saved Instant, Fast, or Slow typing speed from Settings.
        """
        return self._send_command_and_wait({
            'action': 'type_text',
            **self._target(window_id),
            'text': text
        })

    def press_hotkey(self, keys: list[str], window_id: Optional[int] = None) -> Union[Dict[str, Any], ToolResult]:
        """
        Press a keyboard hotkey combination.
        
        Args:
            keys: List of keys to press together (e.g., ['ctrl', 'c'] for copy)
        
        Common keys: ctrl, alt, shift, cmd, win, enter, tab, escape, space,
        backspace, delete, up, down, left, right, home, end, pageup, pagedown,
        f1-f12, and single characters (a-z, 0-9)
        
        Examples:
            - Copy: ['ctrl', 'c']
            - Paste: ['ctrl', 'v']
            - Save: ['ctrl', 's']
            - Switch window: ['alt', 'tab']
            - Show desktop: ['win', 'd']
        """
        return self._send_command_and_wait({
            'action': 'press_hotkey',
            **self._target(window_id),
            'keys': keys
        })

    def scroll(self, direction: Literal['up', 'down', 'left', 'right'], amount: int = 3,
               window_id: Optional[int] = None, x: Optional[int] = None, y: Optional[int] = None,
               screenshot_id: Optional[str] = None) -> Union[Dict[str, Any], ToolResult]:
        """
        Scroll the mouse wheel.
        
        Args:
            direction: 'up' or 'down'
            amount: Number of scroll steps (default 3)
        """
        payload = {
            'action': 'scroll',
            **self._target(window_id, screenshot_id),
            'direction': direction,
            'amount': amount
        }
        if x is not None:
            payload['x'] = x
        if y is not None:
            payload['y'] = y
        return self._send_command_and_wait(payload)

    def drag_drop(self, from_x: int, from_y: int, to_x: int, to_y: int,
                  window_id: Optional[int] = None, screenshot_id: Optional[str] = None) -> Union[Dict[str, Any], ToolResult]:
        """
        Drag and drop from one position to another.
        
        Args:
            from_x: Starting X coordinate
            from_y: Starting Y coordinate
            to_x: Ending X coordinate
            to_y: Ending Y coordinate
        
        Use this to move files, rearrange windows, or interact with drag-drop interfaces.
        """
        return self._send_command_and_wait({
            'action': 'drag_drop',
            **self._target(window_id, screenshot_id),
            'from_x': from_x,
            'from_y': from_y,
            'to_x': to_x,
            'to_y': to_y
        })

    # ===== WINDOW MANAGEMENT =====

    def list_windows(self) -> Union[Dict[str, Any], ToolResult]:
        """
        List all open windows on the system.
        Returns a list of windows with their IDs, titles, bounds, and process IDs.
        
        Use this to see what applications are currently open.
        """
        return self._send_command_and_wait({'action': 'list_windows'})

    def focus_window(self, window_id: Optional[int] = None, title: Optional[str] = None) -> Union[Dict[str, Any], ToolResult]:
        """
        Bring a window to the front and focus it.
        
        Args:
            window_id: The window ID from list_windows()
            title: Case-insensitive title search, accepted only for one unique match
        
        Prefer window_id when multiple windows have similar titles.
        """
        payload = {'action': 'focus_window'}
        if window_id is not None:
            payload['window_id'] = window_id
        if title is not None:
            payload['title'] = title
        
        return self._send_command_and_wait(payload)

    def resize_window(self, window_id: int, width: int, height: int) -> Union[Dict[str, Any], ToolResult]:
        """
        Resize a window to specific dimensions.
        
        Args:
            window_id: The window ID from list_windows()
            width: New width in pixels
            height: New height in pixels
        """
        return self._send_command_and_wait({
            'action': 'resize_window',
            'window_id': window_id,
            'width': width,
            'height': height
        })

    def minimize_window(self, window_id: int) -> Union[Dict[str, Any], ToolResult]:
        """
        Minimize a window.
        
        Args:
            window_id: The window ID from list_windows()
        """
        return self._send_command_and_wait({
            'action': 'minimize_window',
            'window_id': window_id
        })

    def maximize_window(self, window_id: int) -> Union[Dict[str, Any], ToolResult]:
        """
        Maximize a window to full screen.
        
        Args:
            window_id: The window ID from list_windows()
        """
        return self._send_command_and_wait({
            'action': 'maximize_window',
            'window_id': window_id
        })

    def close_window(self, window_id: int) -> Union[Dict[str, Any], ToolResult]:
        """
        Request that a specific window close normally.
        
        Args:
            window_id: The window ID from list_windows()
        
        Applications may display a prompt to save unsaved work.
        """
        return self._send_command_and_wait({
            'action': 'close_window',
            'window_id': window_id
        })

    # ===== SYSTEM LAYER =====

    def run_command(self, command: str, timeout: int = 30) -> Union[Dict[str, Any], ToolResult]:
        """
        Execute a shell command on the system.
        
        Args:
            command: The command to execute
            timeout: Maximum execution time in seconds (default 30)
        
        Returns stdout and stderr from the command.
        
        Platform-specific commands:
        - Windows: PowerShell commands (e.g., "Get-Process", "dir")
        - Mac: Bash commands (e.g., "ls", "ps aux")
        - Linux: Bash commands
        
        SECURITY: Dangerous commands (rm -rf /, format, etc.) are blocked.
        """
        return self._send_command_and_wait({
            'action': 'run_command',
            'command': command,
            'timeout': timeout * 1000  # Convert to milliseconds
        })

    def list_files(self, directory: str) -> Union[Dict[str, Any], ToolResult]:
        """
        List files and directories in a specified path.
        
        Args:
            directory: Path to the directory to list
        
        Returns a list of files and directories with their types.
        """
        return self._send_command_and_wait({
            'action': 'list_files',
            'directory': directory
        })

    def read_file(self, file_path: str, encoding: str = 'utf8') -> Union[Dict[str, Any], ToolResult]:
        """
        Read the contents of a file.
        
        Args:
            file_path: Path to the file to read
            encoding: File encoding (default 'utf8')
        
        Returns the file content as a string.
        """
        return self._send_command_and_wait({
            'action': 'read_file',
            'file_path': file_path,
            'encoding': encoding
        })

    def write_file(self, file_path: str, content: str, encoding: str = 'utf8') -> Union[Dict[str, Any], ToolResult]:
        """
        Write content to a file (creates or overwrites).
        
        Args:
            file_path: Path to the file to write
            content: Content to write to the file
            encoding: File encoding (default 'utf8')
        """
        return self._send_command_and_wait({
            'action': 'write_file',
            'file_path': file_path,
            'content': content,
            'encoding': encoding
        })

    def delete_file(self, file_path: str) -> Union[Dict[str, Any], ToolResult]:
        """
        Delete a file or directory.
        
        Args:
            file_path: Path to the file or directory to delete
        
        WARNING: This permanently deletes files. Cannot be undone.
        """
        return self._send_command_and_wait({
            'action': 'delete_file',
            'file_path': file_path
        })

    def create_directory(self, directory_path: str) -> Union[Dict[str, Any], ToolResult]:
        """
        Create a new directory (including parent directories if needed).
        
        Args:
            directory_path: Path to the directory to create
        """
        return self._send_command_and_wait({
            'action': 'create_directory',
            'directory_path': directory_path
        })

    def open_application(self, app_name: str) -> Union[Dict[str, Any], ToolResult]:
        """
        Open an application by name.
        
        Args:
            app_name: Name of the application to open
        
        Platform-specific examples:
        - Windows: "notepad", "chrome", "code"
        - Mac: "Safari", "TextEdit", "Visual Studio Code"
        - Linux: "firefox", "gedit", "code"
        """
        return self._send_command_and_wait({
            'action': 'open_application',
            'app_name': app_name
        })

    def close_application(self, app_name: str) -> Union[Dict[str, Any], ToolResult]:
        """
        Request that an application's open windows close normally.
        
        Args:
            app_name: Name of the application to close
        
        Applications may display a prompt to save unsaved work.
        """
        return self._send_command_and_wait({
            'action': 'close_application',
            'app_name': app_name
        })

    def get_volume(self) -> Union[Dict[str, Any], ToolResult]:
        """
        Get the current system volume level and mute status.
        
        Returns volume (0-100) and whether the system is muted.
        """
        return self._send_command_and_wait({'action': 'get_volume'})

    def set_volume(self, volume: Optional[int] = None, mute: Optional[bool] = None) -> Union[Dict[str, Any], ToolResult]:
        """
        Set the system volume level or mute status.
        
        Args:
            volume: Volume level (0-100), optional
            mute: Whether to mute the system, optional
        
        You can set volume, mute status, or both.
        """
        payload = {'action': 'set_volume'}
        if volume is not None:
            payload['volume'] = volume
        if mute is not None:
            payload['mute'] = mute
        
        return self._send_command_and_wait(payload)

    def get_system_info(self) -> Union[Dict[str, Any], ToolResult]:
        """
        Get comprehensive system information.
        
        Returns:
        - Platform (Windows, Mac, Linux)
        - Architecture (x64, arm64, etc.)
        - Hostname
        - Memory (total and free)
        - CPU count
        - System uptime
        - Display information
        - System idle time
        
        Use this to understand the user's system configuration.
        """
        return self._send_command_and_wait({'action': 'get_system_info'})

    # ===== OS STATUS & CONTROL =====

    def get_battery_status(self) -> Union[Dict[str, Any], ToolResult]:
        """
        Get the battery level and charging state of the user's computer.

        Returns has_battery, percent (0-100), state (charging, discharging,
        plugged-in, full), minutes_remaining when known, and on_battery_power.
        Desktops without a battery return has_battery=false.
        """
        return self._send_command_and_wait({'action': 'get_battery_status'})

    def get_brightness(self) -> Union[Dict[str, Any], ToolResult]:
        """
        Get the built-in display brightness as a percentage (0-100).

        Works for laptop screens. External monitors usually cannot be read.
        """
        return self._send_command_and_wait({'action': 'get_brightness'})

    def set_brightness(self, level: int) -> Union[Dict[str, Any], ToolResult]:
        """
        Set the built-in display brightness.

        Args:
            level: Brightness percentage from 0 to 100.

        Works for laptop screens. External monitors usually cannot be changed.
        """
        return self._send_command_and_wait({'action': 'set_brightness', 'level': level})

    def get_network_status(self) -> Union[Dict[str, Any], ToolResult]:
        """
        Get internet connectivity and Wi-Fi details.

        Returns online (whether the OS reports an internet connection) and wifi
        with connected, ssid (network name) and signal_percent when available.
        This only reads the state; it cannot change Wi-Fi settings.
        """
        return self._send_command_and_wait({'action': 'get_network_status'})

    def get_bluetooth_status(self) -> Union[Dict[str, Any], ToolResult]:
        """
        Get whether Bluetooth is available and on, plus connected devices where
        the OS reports them. This only reads the state.
        """
        return self._send_command_and_wait({'action': 'get_bluetooth_status'})

    def get_focus_status(self) -> Union[Dict[str, Any], ToolResult]:
        """
        Check whether Do Not Disturb / Focus mode is on.

        Returns do_not_disturb as true, false, or null when the OS does not
        share it. Use it before sending the user something time-sensitive.
        """
        return self._send_command_and_wait({'action': 'get_focus_status'})

    def list_processes(self, name: Optional[str] = None, limit: int = 25) -> Union[Dict[str, Any], ToolResult]:
        """
        List running processes, largest memory users first.

        Args:
            name: Optional part of a process name to filter by (e.g. "chrome").
            limit: Maximum number of processes to return (1-200, default 25).

        Returns pid, name, memory_mb and CPU usage for each process.
        """
        payload: Dict[str, Any] = {'action': 'list_processes', 'limit': limit}
        if name:
            payload['name'] = name
        return self._send_command_and_wait(payload)

    def kill_process(self, pid: int, force: bool = False) -> Union[Dict[str, Any], ToolResult]:
        """
        Stop a running process by its pid (from list_processes).

        Args:
            pid: Process ID to stop.
            force: False (default) asks the program to close so it can save its
                work. True kills it immediately and may lose unsaved data; only
                use it after a normal stop failed and the user agreed.

        Confirm with the user before stopping anything they did not ask about.
        Aetheria ai itself and core OS processes cannot be stopped.
        """
        return self._send_command_and_wait({'action': 'kill_process', 'pid': pid, 'force': bool(force)})

    def open_path(self, path: str) -> Union[Dict[str, Any], ToolResult]:
        """
        Open a file or folder with its default application (like double-clicking it).

        Args:
            path: Absolute path inside the user's allowed computer scope.
        """
        return self._send_command_and_wait({'action': 'open_path', 'path': path})

    def reveal_in_folder(self, path: str) -> Union[Dict[str, Any], ToolResult]:
        """
        Show a file selected in Explorer, Finder or the Linux file manager.

        Args:
            path: Absolute path inside the user's allowed computer scope.
        """
        return self._send_command_and_wait({'action': 'reveal_in_folder', 'path': path})

    # ===== APPLICATION DISCOVERY =====

    def list_installed_apps(self) -> Union[Dict[str, Any], ToolResult]:
        """
        List all installed applications on the host operating system.
        
        Returns names, identifiers, versions, publishers, and launching commands.
        
        On Windows: Scans Start Menu (Get-StartApps) and Registry Uninstall keys
        for both UWP/Store apps and legacy desktop applications.
        On macOS: Scans /Applications and ~/Applications for .app bundles.
        On Linux: Parses .desktop entry files from standard application directories.
        
        Use this to discover what software is available to open on the user's computer
        before attempting to launch an application.
        """
        return self._send_command_and_wait({'action': 'list_installed_apps'})

    # ===== SCREEN ELEMENT DETECTION =====

    @staticmethod
    def _target(window_id: Optional[int] = None, screenshot_id: Optional[str] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        if window_id is not None:
            payload['window_id'] = window_id
        if screenshot_id is not None:
            payload['screenshot_id'] = screenshot_id
        return payload

    def get_window_state(self, window_id: int, include_screenshot: bool = True, limit: int = 200) -> Union[Dict[str, Any], ToolResult]:
        """Observe one window with a screenshot and Windows accessibility state.

        Screenshot coordinates are image-relative when passed back with screenshot_id.
        Captures the visible desktop region, so the window must be on one display.
        Set include_screenshot=False for a faster accessibility-only observation.
        """
        return self._send_command_and_wait({'action': 'get_window_state', 'window_id': window_id,
                                           'include_screenshot': include_screenshot, 'limit': limit})

    def perform_element_action(self, observation_id: str, element_id: str,
                               element_action: Literal['invoke', 'focus', 'toggle', 'select', 'expand', 'collapse', 'set_value'],
                               value: Optional[str] = None) -> Union[Dict[str, Any], ToolResult]:
        """Act on a control from the latest Windows accessibility observation.

        References expire after 30 seconds or another input action. Use only supported
        Patterns returned for the control. Invoke clicks buttons, focus selects the
        input focus, and set_value replaces an editable value using the user's saved
        typing speed. Returns fresh state and verifies the field value.
        If unsupported, observe a screenshot and use targeted mouse/keyboard input.
        """
        return self._send_command_and_wait({'action': 'perform_element_action', 'observation_id': observation_id,
                                           'element_id': element_id, 'element_action': element_action, 'value': value})

    def get_screen_elements(self, window_title: Optional[str] = None, element_type: Optional[str] = None,
                            window_id: Optional[int] = None, limit: int = 200) -> Union[Dict[str, Any], ToolResult]:
        """
        Get interactive UI elements on screen using the OS accessibility tree.
        Returns element names, types, and exact screen coordinates for precise clicking.
        
        Args:
            window_title: Optional window title to scope the search to a specific window.
            element_type: Optional filter for element type. 
                          Options: 'button', 'edit', 'text', 'link', 'checkbox', 
                          'radio', 'combobox', 'list', 'menu', 'tab'
        
        Returns a bounded list with observation_id, element_id, supported Patterns,
        focus, values, toggle states, and screen coordinates. Check truncated; filter
        by control type or exact text when the window contains many controls.
        Currently supported on Windows only (uses UI Automation API).
        """
        payload = {'action': 'get_screen_elements', **self._target(window_id), 'limit': limit}
        if window_title:
            payload['window_title'] = window_title
        if element_type:
            payload['element_type'] = element_type
        return self._send_command_and_wait(payload)

    def find_element_by_text(self, text: str, window_title: Optional[str] = None,
                             window_id: Optional[int] = None) -> Union[Dict[str, Any], ToolResult]:
        """
        Find a specific UI element by its visible text/label and get its click coordinates.
        
        Args:
            text: The exact visible text of the element (e.g., "Save", "OK", "File")
            window_title: Optional window title to scope the search
        
        Returns matching controls and an observation_id. recommended_click is null
        when more than one enabled control matches. Inspect the list to disambiguate.
        
        Example: find_element_by_text("Save") → returns {x: 450, y: 320} → click_mouse(x=450, y=320)
        """
        payload = {'action': 'find_element_by_text', 'text': text, **self._target(window_id)}
        if window_title:
            payload['window_title'] = window_title
        return self._send_command_and_wait(payload)
