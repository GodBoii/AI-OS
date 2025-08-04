# python-backend/browser_tools.py

import logging
import uuid
import base64
from typing import Dict, Any, Literal, Optional, List

import eventlet
from agno.agent import Agent
from agno.tools import Toolkit
from agno.models.google import Gemini
from agno.media import Image
from supabase_client import supabase_client

BROWSER_COMMAND_TIMEOUT_SECONDS = 120

logger = logging.getLogger(__name__)

class BrowserTools(Toolkit):
    """
    A toolkit that acts as a server-side proxy for controlling a browser on the client's machine.
    It intelligently uses a vision model to describe screenshots, providing a token-efficient
    summary of the webpage's visual content to the main agent.
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
        
        # --- MODIFICATION START (Phase 1) ---
        # Initialize conversation_history as None. It will be injected Just-In-Time.
        self.conversation_history: Optional[List[Dict[str, Any]]] = None
        # --- MODIFICATION END ---

        from agno.agent import Agent
        self.vision_agent = Agent(
            name="Vision_Agent",
            model=Gemini(id="gemini-2.5-flash-lite"),
        )

        super().__init__(
            name="browser_tools",
            tools=[
                # Existing Tools
                self.get_status,
                self.navigate,
                self.get_current_view,
                self.click,
                self.type_text,
                self.scroll,
                self.go_back,
                self.go_forward,
                # New Tools
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

    def _get_image_description(self, image_bytes: bytes) -> str:
        """
        Uses a dedicated vision agent to generate a text description of a screenshot,
        using the conversation history for context.
        """
        try:
            logger.info("Getting image description from vision model...")
            
            # Format the conversation history for the prompt
            formatted_history = "No conversation history available for this turn."
            if self.conversation_history:
                history_lines = []
                for turn in self.conversation_history:
                    role = "User" if turn.get("role") == "user" else "Assistant"
                    content = turn.get("content", "").strip()
                    if content:
                        # Truncate long assistant responses to keep the prompt focused
                        if role == "Assistant" and len(content) > 500:
                            content = content[:500] + "..."
                        history_lines.append(f"{role}: {content}")
                if history_lines:
                    formatted_history = "\n".join(history_lines)

            # Construct the new, context-aware prompt
            prompt = (
                f"""You are a specialized vision assistant that analyzes browser screenshots to help a main AI agent interact with websites accurately. Your role is to provide extremely detailed descriptions that enable precise web automation.

CONVERSATION CONTEXT:
<conversation_history>
{formatted_history}
</conversation_history>

INSTRUCTIONS:
1. **Context-Aware Analysis**: First, analyze if the user's current request (from conversation history) can be fulfilled by information visible in this screenshot. If so, prioritize describing those specific elements in detail.

2. **Comprehensive Description**: Always provide a complete, detailed description of the screenshot including:

**PAGE STRUCTURE & LAYOUT:**
- Page title and URL (if visible)
- Overall layout structure (header, main content, sidebar, footer)
- Navigation elements and menu structures
- Content organization and hierarchy

**VISUAL ELEMENTS:**
- All text content (headings, paragraphs, labels, buttons, links)
- Images, icons, and graphics with their positions
- Colors, styling, and visual design elements
- Spacing, alignment, and visual hierarchy

**INTERACTIVE ELEMENTS:**
- All clickable elements (buttons, links, form controls)
- Form fields (input boxes, dropdowns, checkboxes, radio buttons)
- Element positions and their relationships to each other
- Any hover states or visual indicators

**SPECIFIC DETAILS:**
- Element positioning (left, right, center, top, bottom)
- Colors of text, backgrounds, and UI elements
- Sizes and proportions of elements
- Any error messages, notifications, or status indicators
- Loading states or dynamic content

**CONTENT ANALYSIS:**
- Main content topics and subjects
- Any people, objects, or scenes in images
- Specific details about visual content that might be relevant to user queries
- Data in tables, lists, or structured formats

3. **Request Fulfillment**: If the user's request involves specific visual information (like "what color shirt is the person wearing" or "find the login button"), describe these elements with extra detail and clarity.

4. **Technical Information**: Include any technical details visible like:
- Form validation states
- Element accessibility features
- Dynamic content or animations
- Browser UI elements if relevant

Provide your analysis in a clear, structured format that gives the main agent all necessary information to understand and interact with the webpage effectively."""
            )
            
            image = Image(content=image_bytes)
            response = self.vision_agent.run(prompt, images=[image])
            
            description = response.content if response.content else "Could not generate a description for the image."
            logger.info(f"Vision model description: {description[:1000000]}...")
            return description
        except Exception as e:
            logger.error(f"Error getting image description from vision model: {e}", exc_info=True)
            return "Error: Failed to analyze the screenshot with the vision model."

    def _process_view_result(self, result: Dict[str, Any]) -> Dict[str, Any]:
        if result.get("status") == "success" and "screenshot_path" in result:
            screenshot_path = result.pop("screenshot_path")
            try:
                logger.info(f"Downloading screenshot from Supabase path: {screenshot_path}")
                image_bytes = supabase_client.storage.from_('media-uploads').download(screenshot_path)
                description = self._get_image_description(image_bytes)
                result["screenshot_description"] = description
            except Exception as e:
                logger.error(f"Failed to download or process screenshot from {screenshot_path}: {e}")
                result["screenshot_description"] = f"Error: Could not retrieve screenshot from path {screenshot_path}."
        return result

    def _send_command_and_wait(self, command_payload: Dict[str, Any]) -> Dict[str, Any]:
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
            return result
        except eventlet.timeout.Timeout:
            logger.error(f"Timeout: Did not receive a response from the client for request_id {request_id}")
            return {"status": "error", "error": "The browser on the client machine did not respond in time."}
        finally:
            self.waiting_events.pop(request_id, None)

    # --- Public Tool Methods (Unchanged) ---
    def get_status(self) -> Dict[str, Any]:
        return self._send_command_and_wait({'action': 'status'})

    def navigate(self, url: str) -> Dict[str, Any]:
        if not url.startswith(('http://', 'https://')):
            url = 'http://' + url
        return self._send_command_and_wait({'action': 'navigate', 'url': url})

    def get_current_view(self) -> Dict[str, Any]:
        return self._send_command_and_wait({'action': 'get_view'})

    def click(self, element_id: int, description: str) -> Dict[str, Any]:
        return self._send_command_and_wait({'action': 'click', 'element_id': element_id})

    def type_text(self, element_id: int, text: str, description: str) -> Dict[str, Any]:
        return self._send_command_and_wait({'action': 'type', 'element_id': element_id, 'text': text})

    def scroll(self, direction: Literal['up', 'down']) -> Dict[str, Any]:
        if direction not in ['up', 'down']:
            return {"status": "error", "error": "Invalid scroll direction. Must be 'up' or 'down'."}
        return self._send_command_and_wait({'action': 'scroll', 'direction': direction})

    def go_back(self) -> Dict[str, Any]:
        return self._send_command_and_wait({'action': 'go_back'})

    def go_forward(self) -> Dict[str, Any]:
        return self._send_command_and_wait({'action': 'go_forward'})

        # Add these new methods inside the BrowserTools class

    # --- 1. Tab Management Tools ---
    def list_tabs(self) -> Dict[str, Any]:
        """
        Returns a list of all currently open browser tabs. Each tab is represented
        by a dictionary containing its 'index', 'title', and 'url'.
        """
        return self._send_command_and_wait({'action': 'list_tabs'})

    def open_new_tab(self, url: str) -> Dict[str, Any]:
        """
        Opens a new browser tab and navigates to the specified URL, making it the active tab.

        Args:
            url (str): The URL to open in the new tab.
        
        Returns: A view of the new page after navigation.
        """
        if not url.startswith(('http://', 'https://')):
            url = 'http://' + url
        return self._send_command_and_wait({'action': 'open_new_tab', 'url': url})

    def switch_to_tab(self, tab_index: int) -> Dict[str, Any]:
        """
        Switches the browser's focus to the tab at the specified index.
        The index for each tab can be found by calling the 'list_tabs' tool.

        Args:
            tab_index (int): The index of the tab to switch to.
        
        Returns: A view of the page in the newly active tab.
        """
        return self._send_command_and_wait({'action': 'switch_to_tab', 'tab_index': tab_index})

    def close_tab(self, tab_index: int) -> Dict[str, Any]:
        """
        Closes the browser tab at the specified index.

        Args:
            tab_index (int): The index of the tab to close, obtained from 'list_tabs'.
        
        Returns: A status message indicating success or failure.
        """
        return self._send_command_and_wait({'action': 'close_tab', 'tab_index': tab_index})

    # --- 2. Advanced Interaction Tools ---
    def hover_over_element(self, element_id: int) -> Dict[str, Any]:
        """
        Simulates hovering the mouse cursor over a specific element.
        Useful for revealing hidden menus or tooltips that appear on hover.

        Args:
            element_id (int): The ID of the element to hover over.
        
        Returns: A view of the page after the hover action.
        """
        return self._send_command_and_wait({'action': 'hover', 'element_id': element_id})

    def select_dropdown_option(self, element_id: int, value: str) -> Dict[str, Any]:
        """
        Selects an option from a <select> dropdown menu.

        Args:
            element_id (int): The ID of the <select> element.
            value (str): The 'value' attribute of the <option> to be selected.
        
        Returns: A view of the page after the selection.
        """
        return self._send_command_and_wait({'action': 'select_option', 'element_id': element_id, 'value': value})

    def handle_alert(self, action: Literal['accept', 'dismiss']) -> Dict[str, Any]:
        """
        Handles a native browser pop-up alert by either accepting ('OK') or dismissing ('Cancel') it.

        Args:
            action (str): The action to perform. Must be either 'accept' or 'dismiss'.
        
        Returns: A status message.
        """
        if action not in ['accept', 'dismiss']:
            return {"status": "error", "error": "Invalid alert action. Must be 'accept' or 'dismiss'."}
        return self._send_command_and_wait({'action': 'handle_alert', 'alert_action': action})

    def press_key(self, key: str) -> Dict[str, Any]:
        """
        Simulates a single keyboard press on the current page. Useful for submitting forms ('Enter'),
        closing modals ('Escape'), or navigating menus ('ArrowDown', 'ArrowUp', 'Tab').

        Args:
            key (str): The key to press. Allowed keys are: 'Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp'.
        
        Returns: A view of the page after the key press.
        """
        allowed_keys = {'Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp'}
        if key not in allowed_keys:
            return {"status": "error", "error": f"Invalid key. Allowed keys are: {', '.join(allowed_keys)}"}
        return self._send_command_and_wait({'action': 'press_key', 'key': key})

    # --- 3. Data Extraction Tools ---
    def extract_text_from_element(self, element_id: int) -> str:
        """
        Extracts all the text content from a single element, such as a paragraph or an article body.

        Args:
            element_id (int): The ID of the element from which to extract text.
        
        Returns: The text content of the element as a string.
        """
        return self._send_command_and_wait({'action': 'extract_text', 'element_id': element_id})

    def get_element_attributes(self, element_id: int) -> Dict[str, Any]:
        """
        Gets all attributes of a specific element, such as 'href' for a link or 'src' for an image.

        Args:
            element_id (int): The ID of the element.
        
        Returns: A dictionary of the element's attributes.
        """
        return self._send_command_and_wait({'action': 'get_attributes', 'element_id': element_id})

    def extract_table_data(self, element_id: int) -> str:
        """
        Extracts data from a <table> element and returns it in a structured Markdown format.

        Args:
            element_id (int): The ID of the <table> element.
        
        Returns: A Markdown formatted string of the table data.
        """
        return self._send_command_and_wait({'action': 'extract_table', 'element_id': element_id})

    # --- 4. Browser State & Environment Tools ---
    def refresh_page(self) -> Dict[str, Any]:
        """
        Reloads the current browser page.
        
        Returns: A view of the page after it has been refreshed.
        """
        return self._send_command_and_wait({'action': 'refresh'})

    def wait_for_element(self, selector: str, timeout: int = 10) -> Dict[str, Any]:
        """
        Pauses execution until an element matching the CSS selector appears on the page.

        Args:
            selector (str): The CSS selector to wait for (e.g., '#my-id', '.my-class', 'div > p').
            timeout (int): The maximum time to wait in seconds. Defaults to 10.
        
        Returns: A status message indicating if the element was found.
        """
        return self._send_command_and_wait({'action': 'wait_for_element', 'selector': selector, 'timeout': timeout})

    def manage_cookies(self, action: Literal['accept_all', 'clear_all']) -> Dict[str, Any]:
        """
        Performs common cookie operations. 'accept_all' attempts to click a common cookie consent button.
        'clear_all' removes all cookies for the current site.

        Args:
            action (str): The cookie action to perform. Must be 'accept_all' or 'clear_all'.
        
        Returns: A status message and a view of the page after the action.
        """
        if action not in ['accept_all', 'clear_all']:
            return {"status": "error", "error": "Invalid cookie action. Must be 'accept_all' or 'clear_all'."}
        return self._send_command_and_wait({'action': 'manage_cookies', 'cookie_action': action})