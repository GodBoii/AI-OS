# python-backend/browser_tools.py

import os
import logging
import asyncio
import json
from typing import Dict, Any, List, Optional

# Use eventlet for cooperative multitasking, compatible with Flask-SocketIO
import eventlet
from agno.tools import Toolkit
from browser_use.llm import ChatGoogle

# Import browser-use components
from browser_use import Agent as BrowserUseAgent, BrowserSession, AgentHistoryList

logger = logging.getLogger(__name__)

# This global dictionary will store eventlet Events to signal when a browser is ready
browser_ready_events: Dict[str, eventlet.event.Event] = {}

class BrowserTools(Toolkit):
    """
    A state-aware toolkit for controlling a user's local browser.
    It orchestrates the browser's lifecycle via the Electron client and uses
    the browser-use library to perform web automation tasks.
    """

    def __init__(self, session_info: Dict[str, Any], socketio, sid: str):
        """
        Initializes the BrowserTools toolkit.

        Args:
            session_info (Dict[str, Any]): The state dictionary for the current user session.
            socketio: The Flask-SocketIO server instance for client communication.
            sid (str): The client's unique session ID for targeted communication.
        """
        super().__init__(
            name="browser_tools",
            tools=[
                self.browser_view,
                self.browser_navigate,
                self.browser_click,
                self.browser_input,
                self.browser_scroll,
                self.close_browser,
            ]
        )
        self.session_info = session_info
        self.socketio = socketio
        self.sid = sid
        self.cdp_url = "http://host.docker.internal:9222"
        # Use a capable but cost-effective model for browser-use's internal planning
        self.browser_llm = ChatGoogle(model='gemini-2.0-flash')

    def _process_browser_history(self, history: AgentHistoryList) -> str:
        """
        Processes the result from a browser-use run into a concise,
        LLM-friendly string format.
        """
        if not history or len(history) == 0:
            return "No action was taken or the page is empty."

        final_step = history[-1]
        
        # Extract key information from the final observation
        url = final_step.observation.get("url", "N/A")
        page_title = final_step.observation.get("page_title", "N/A")
        markdown = final_step.observation.get("markdown", "No content extracted.")
        interactive_elements = final_step.observation.get("interactive_elements", [])

        # Format the interactive elements list
        elements_summary = "\n".join(
            [f"- Element {el['index']}: {el['element']} (Type: {el['type']})" for el in interactive_elements]
        )

        # Assemble the final report string
        report = (
            f"Current URL: {url}\n"
            f"Page Title: {page_title}\n\n"
            f"--- Visible Interactive Elements ---\n"
            f"{elements_summary}\n\n"
            f"--- Page Content (Markdown) ---\n"
            f"{markdown}"
        )
        return report

    def _ensure_browser_is_ready(self) -> bool:
        """
        Ensures the managed browser is running. If not, it requests the client
        to launch it and waits for confirmation.
        """
        conversation_id = self.session_info.get("conversation_id")
        if not conversation_id:
            logger.error("Cannot ensure browser readiness without a conversation_id.")
            return False

        if self.session_info.get('browser_active', False):
            logger.info("Browser is already active for this session.")
            return True

        # Create a new event for this specific request
        ready_event = eventlet.event.Event()
        browser_ready_events[conversation_id] = ready_event

        try:
            logger.info(f"Requesting client to start browser for conversation: {conversation_id}")
            self.socketio.emit('request-start-browser', {'conversationId': conversation_id}, room=self.sid)

            # Wait for the client to confirm, with a timeout
            with eventlet.Timeout(30, TimeoutError("Client did not respond to browser start request.")):
                browser_is_ready = ready_event.wait()

            if browser_is_ready:
                logger.info("Client confirmed browser is ready.")
                self.session_info['browser_active'] = True
                return True
            else:
                logger.warning("Client reported that browser start was denied or failed.")
                self.session_info['browser_active'] = False
                return False

        except TimeoutError as e:
            logger.error(f"Timeout waiting for browser to become ready: {e}")
            return False
        finally:
            # Clean up the event from the global dictionary
            if conversation_id in browser_ready_events:
                del browser_ready_events[conversation_id]

    async def _run_browser_task_async(self, task: str) -> str:
        """
        The core async function that executes a task using the browser-use library.
        """
        try:
            browser_session = BrowserSession(cdp_url=self.cdp_url)
            browser_agent = BrowserUseAgent(
                task=task,
                llm=self.browser_llm,
                browser_session=browser_session
            )
            history = await browser_agent.run(max_steps=5) # Limit steps to prevent runaway actions
            return self._process_browser_history(history)
        except Exception as e:
            logger.error(f"An error occurred during browser-use execution: {e}", exc_info=True)
            # Check for common connection error to provide a better message
            if "ECONNREFUSED" in str(e):
                self.session_info['browser_active'] = False # Reset state
                return "Error: Could not connect to the browser. It might have been closed. Please try the action again to relaunch it."
            return f"An unexpected error occurred while controlling the browser: {str(e)}"

    # --- Public Tools for the AI Agent ---

    def browser_view(self) -> str:
        """
        Captures the current state of the browser, providing a list of interactive elements and a markdown representation of the visible content.
        This should be the first tool you use to understand what's on the page.
        """
        if not self._ensure_browser_is_ready():
            return "Browser could not be started. The user may have denied the request."
        
        return asyncio.run(self._run_browser_task_async("Get the current page state and list all interactive elements."))

    def browser_navigate(self, url: str) -> str:
        """
        Navigates the browser to a specific URL.

        Args:
            url (str): The full URL to navigate to (e.g., 'https://www.google.com').
        """
        if not self._ensure_browser_is_ready():
            return "Browser could not be started. The user may have denied the request."
        
        return asyncio.run(self._run_browser_task_async(f"Navigate to the URL: {url}"))

    def browser_click(self, element_index: int, description: Optional[str] = None) -> str:
        """
        Clicks on an interactive element on the page, identified by its index from the last `browser_view`.

        Args:
            element_index (int): The numerical index of the element to click.
            description (str, optional): A brief description of the element for confirmation (e.g., 'the login button').
        """
        if not self._ensure_browser_is_ready():
            return "Browser could not be started. The user may have denied the request."
        
        task = f"Click on the element with index {element_index}"
        if description:
            task += f", which is described as '{description}'."
        
        return asyncio.run(self._run_browser_task_async(task))

    def browser_input(self, element_index: int, text: str, description: Optional[str] = None) -> str:
        """
        Types text into an input field on the page, identified by its index.

        Args:
            element_index (int): The numerical index of the input field.
            text (str): The text to type into the field.
            description (str, optional): A brief description of the input field (e.g., 'the username field').
        """
        if not self._ensure_browser_is_ready():
            return "Browser could not be started. The user may have denied the request."
        
        task = f"Type the text '{text}' into the element with index {element_index}"
        if description:
            task += f", which is described as '{description}'."
            
        return asyncio.run(self._run_browser_task_async(task))

    def browser_scroll(self, direction: str) -> str:
        """
        Scrolls the browser page up or down.

        Args:
            direction (str): The direction to scroll. Must be either 'up' or 'down'.
        """
        if direction not in ['up', 'down']:
            return "Error: Invalid scroll direction. Please use 'up' or 'down'."
        
        if not self._ensure_browser_is_ready():
            return "Browser could not be started. The user may have denied the request."
        
        return asyncio.run(self._run_browser_task_async(f"Scroll the page {direction}."))

    def close_browser(self) -> str:
        """
        Closes the managed browser session on the user's desktop.
        """
        conversation_id = self.session_info.get("conversation_id")
        if not conversation_id:
            return "Error: Cannot close browser without a conversation_id."

        if not self.session_info.get('browser_active', False):
            return "Browser is not currently active."

        logger.info(f"Requesting client to stop browser for conversation: {conversation_id}")
        self.socketio.emit('request-stop-browser', {'conversationId': conversation_id}, room=self.sid)
        self.session_info['browser_active'] = False
        return "Browser has been closed."