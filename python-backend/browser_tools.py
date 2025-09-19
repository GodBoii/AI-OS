# python-backend/browser_tools.py (Final, Corrected Version for Agno v2.0.5)

import logging
import uuid
import json  # --- FIX: Import the json library for serialization ---
from typing import Dict, Any, Literal, Union

import eventlet
from agno.media import Image
from agno.tools import Toolkit
from agno.tools.function import ToolResult
from supabase_client import supabase_client

BROWSER_COMMAND_TIMEOUT_SECONDS = 120

logger = logging.getLogger(__name__)

class BrowserTools(Toolkit):
    """
    A toolkit that acts as a server-side proxy for controlling a browser on the client's machine.
    It passes screenshots directly back to the main agent for first-party visual analysis,
    leveraging Agno v2.0.5's multimodal tool output capabilities.
    """

    def __init__(self, sid: str, socketio, waiting_events: Dict[str, eventlet.event.Event]):
        """
        Initializes the BrowserTools toolkit.

        Args:
            sid (str): The unique Socket.IO session ID for the connected client.
            socketio: The main Flask-SocketIO server instance.
            waiting_events (Dict): A shared dictionary to store eventlet events.
        """
        self.sid = sid
        self.socketio = socketio
        self.waiting_events = waiting_events

        super().__init__(
            name="browser_tools",
            tools=[
                self.get_status,
                self.navigate,
                self.get_current_view,
                self.click,
                self.type_text,
                self.scroll,
                self.go_back,
                self.go_forward,
                self.list_tabs,
                self.open_new_tab,
                self.switch_to_tab,
                self.close_tab,
                self.hover_over_element,
                self.select_dropdown_option,
                self.handle_alert,
                self.press_key,
                self.extract_text_from_element,
                self.get_element_attributes,
                self.extract_table_data,
                self.refresh_page,
                self.wait_for_element,
                self.manage_cookies,
            ],
        )

    def _process_view_result(self, result: Dict[str, Any]) -> ToolResult:
        """
        Processes a result from the client that includes a screenshot.
        It downloads the screenshot, packages it into an agno.media.Image object,
        and returns a ToolResult containing the serialized result data and the image.
        """
        if result.get("status") == "success" and "screenshot_path" in result:
            screenshot_path = result.pop("screenshot_path")
            try:
                logger.info(f"Downloading screenshot from Supabase path: {screenshot_path}")
                image_bytes = supabase_client.storage.from_('media-uploads').download(screenshot_path)
                
                image_artifact = Image(content=image_bytes)
                
                # --- FIX: Serialize the dictionary to a JSON string for the 'content' field ---
                # This resolves the pydantic ValidationError.
                return ToolResult(
                    content=json.dumps(result),
                    images=[image_artifact]
                )
            except Exception as e:
                logger.error(f"Failed to download or process screenshot from {screenshot_path}: {e}")
                result["error"] = f"Error: Could not retrieve screenshot from path {screenshot_path}."
                # --- FIX: Also serialize the dictionary here ---
                return ToolResult(content=json.dumps(result))
        
        # --- FIX: Also serialize the dictionary for the no-screenshot case ---
        return ToolResult(content=json.dumps(result))

    def _send_command_and_wait(self, command_payload: Dict[str, Any]) -> Union[Dict[str, Any], ToolResult]:
        """
        Sends a command to the client and waits for the response.
        It now consistently returns a ToolResult or a simple dictionary on timeout.
        """
        request_id = str(uuid.uuid4())
        command_payload['request_id'] = request_id
        
        response_event = eventlet.event.Event()
        self.waiting_events[request_id] = response_event

        try:
            self.socketio.emit('browser-command', command_payload, room=self.sid)
            logger.info(f"Sent command '{command_payload['action']}' to client {self.sid} with request_id {request_id}")

            result = response_event.wait(timeout=BROWSER_COMMAND_TIMEOUT_SECONDS)
            
            if "screenshot_path" in result:
                return self._process_view_result(result)
            
            # --- FIX: Ensure even non-screenshot results are wrapped consistently ---
            # This makes the tool's output more predictable for the framework.
            return ToolResult(content=json.dumps(result))

        except eventlet.timeout.Timeout:
            logger.error(f"Timeout: Did not receive a response from the client for request_id {request_id}")
            # On timeout, a simple dictionary is still appropriate.
            return {"status": "error", "error": "The browser on the client machine did not respond in time."}
        finally:
            self.waiting_events.pop(request_id, None)

    # --- Public Tool Methods ---
    # The type hints are updated to reflect that the successful return type
    # will now consistently be a ToolResult or a simple dict in case of an error.

    def get_status(self) -> Dict[str, Any]:
        return self._send_command_and_wait({'action': 'status'})

    def navigate(self, url: str) -> Union[Dict[str, Any], ToolResult]:
        if not url.startswith(('http://', 'https://')):
            url = 'http://' + url
        return self._send_command_and_wait({'action': 'navigate', 'url': url})

    def get_current_view(self) -> Union[Dict[str, Any], ToolResult]:
        return self._send_command_and_wait({'action': 'get_view'})

    def click(self, element_id: int, description: str) -> Union[Dict[str, Any], ToolResult]:
        return self._send_command_and_wait({'action': 'click', 'element_id': element_id})

    def type_text(self, element_id: int, text: str, description: str) -> Union[Dict[str, Any], ToolResult]:
        return self._send_command_and_wait({'action': 'type', 'element_id': element_id, 'text': text})

    def scroll(self, direction: Literal['up', 'down']) -> Union[Dict[str, Any], ToolResult]:
        if direction not in ['up', 'down']:
            return {"status": "error", "error": "Invalid scroll direction. Must be 'up' or 'down'."}
        return self._send_command_and_wait({'action': 'scroll', 'direction': direction})

    def go_back(self) -> Union[Dict[str, Any], ToolResult]:
        return self._send_command_and_wait({'action': 'go_back'})

    def go_forward(self) -> Union[Dict[str, Any], ToolResult]:
        return self._send_command_and_wait({'action': 'go_forward'})

    def list_tabs(self) -> Union[Dict[str, Any], ToolResult]:
        return self._send_command_and_wait({'action': 'list_tabs'})

    def open_new_tab(self, url: str) -> Union[Dict[str, Any], ToolResult]:
        if not url.startswith(('http://', 'https://')):
            url = 'http://' + url
        return self._send_command_and_wait({'action': 'open_new_tab', 'url': url})

    def switch_to_tab(self, tab_index: int) -> Union[Dict[str, Any], ToolResult]:
        return self._send_command_and_wait({'action': 'switch_to_tab', 'tab_index': tab_index})

    def close_tab(self, tab_index: int) -> Union[Dict[str, Any], ToolResult]:
        return self._send_command_and_wait({'action': 'close_tab', 'tab_index': tab_index})

    def hover_over_element(self, element_id: int) -> Union[Dict[str, Any], ToolResult]:
        return self._send_command_and_wait({'action': 'hover', 'element_id': element_id})

    def select_dropdown_option(self, element_id: int, value: str) -> Union[Dict[str, Any], ToolResult]:
        return self._send_command_and_wait({'action': 'select_option', 'element_id': element_id, 'value': value})

    def handle_alert(self, action: Literal['accept', 'dismiss']) -> Dict[str, Any]:
        if action not in ['accept', 'dismiss']:
            return {"status": "error", "error": "Invalid alert action. Must be 'accept' or 'dismiss'."}
        return self._send_command_and_wait({'action': 'handle_alert', 'alert_action': action})

    def press_key(self, key: str) -> Union[Dict[str, Any], ToolResult]:
        allowed_keys = {'Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp'}
        if key not in allowed_keys:
            return {"status": "error", "error": f"Invalid key. Allowed keys are: {', '.join(allowed_keys)}"}
        return self._send_command_and_wait({'action': 'press_key', 'key': key})

    def extract_text_from_element(self, element_id: int) -> Union[Dict[str, Any], ToolResult]:
        return self._send_command_and_wait({'action': 'extract_text', 'element_id': element_id})

    def get_element_attributes(self, element_id: int) -> Union[Dict[str, Any], ToolResult]:
        return self._send_command_and_wait({'action': 'get_attributes', 'element_id': element_id})

    def extract_table_data(self, element_id: int) -> Union[Dict[str, Any], ToolResult]:
        return self._send_command_and_wait({'action': 'extract_table', 'element_id': element_id})

    def refresh_page(self) -> Union[Dict[str, Any], ToolResult]:
        return self._send_command_and_wait({'action': 'refresh'})

    def wait_for_element(self, selector: str, timeout: int = 10) -> Union[Dict[str, Any], ToolResult]:
        return self._send_command_and_wait({'action': 'wait_for_element', 'selector': selector, 'timeout': timeout})

    def manage_cookies(self, action: Literal['accept_all', 'clear_all']) -> Union[Dict[str, Any], ToolResult]:
        if action not in ['accept_all', 'clear_all']:
            return {"status": "error", "error": "Invalid cookie action. Must be 'accept_all' or 'clear_all'."}
        return self._send_command_and_wait({'action': 'manage_cookies', 'cookie_action': action})