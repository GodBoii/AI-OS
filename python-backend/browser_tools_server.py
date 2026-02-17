# python-backend/browser_tools_server.py
"""
Server-side browser automation toolkit for mobile devices.
Uses Playwright to run headless browsers on the server, enabling
browser automation for platforms that cannot control local browsers.
"""

import logging
import json
import asyncio
import base64
import threading
import time
from typing import Dict, Any, Literal, Union, Optional
from contextlib import asynccontextmanager

from playwright.async_api import async_playwright, Browser, BrowserContext, Page, TimeoutError as PlaywrightTimeoutError

from agno.media import Image
from agno.tools import Toolkit
from agno.tools.function import ToolResult
from supabase_client import supabase_client

logger = logging.getLogger(__name__)

class ServerBrowserTools(Toolkit):
    """
    Server-side browser automation toolkit using Playwright.
    Manages browser contexts per session with automatic cleanup.
    """
    
    # Class-level browser instance (shared across all sessions)
    _browser: Optional[Browser] = None
    _playwright = None
    _browser_lock: Optional[asyncio.Lock] = None  # Lazily created on dedicated loop
    
    # Session contexts (one per user session)
    _contexts: Dict[str, BrowserContext] = {}
    _pages: Dict[str, Page] = {}
    
    # Dedicated event loop for Playwright async operations.
    # Eventlet monkey-patches asyncio, making loop.run_until_complete() fail
    # with "This event loop is already running". Running Playwright on a
    # separate OS thread with its own clean event loop avoids this entirely.
    _dedicated_loop: Optional[asyncio.AbstractEventLoop] = None
    _loop_thread: Optional[threading.Thread] = None
    _loop_init_lock = threading.Lock()
    
    def __init__(self, session_id: str, user_id: str, socketio=None, sid: str = None, redis_client=None, message_id: str = None, **kwargs):
        """
        Initialize server-side browser tools for a specific session.
        
        Args:
            session_id: Unique session identifier
            user_id: User identifier for storage paths
            socketio: Socket.IO instance for real-time updates (optional)
            sid: Socket.IO session ID (optional)
            redis_client: Redis client for pub/sub (optional)
            message_id: Current message ID for screenshot tracking (optional)
        """
        self.session_id = session_id
        self.user_id = user_id
        self.socketio = socketio
        self.sid = sid
        self.redis_client = redis_client
        self.message_id = message_id
        
        super().__init__(
            name="browser_tools",
            tools=[
                self.get_status, self.navigate, self.get_current_view,
                self.click, self.type_text, self.scroll, self.go_back,
                self.go_forward, self.refresh_page, self.extract_text_from_element,
                self.extract_table_data, self.wait_for_element,
                self.list_tabs, self.open_new_tab, self.switch_to_tab, self.close_tab,
                self.close_browser
            ],
        )
    
    @classmethod
    def _get_dedicated_loop(cls) -> asyncio.AbstractEventLoop:
        """Get or create a dedicated asyncio event loop running in a background thread.
        
        This is the key fix for eventlet compatibility:
        - Eventlet monkey-patches asyncio, making run_until_complete() fail
        - We create a SEPARATE OS thread with a clean asyncio event loop
        - All Playwright coroutines run on this dedicated loop
        - The calling eventlet green-thread blocks safely on future.result()
        """
        with cls._loop_init_lock:
            if cls._dedicated_loop is None or cls._dedicated_loop.is_closed():
                loop = asyncio.new_event_loop()
                cls._dedicated_loop = loop
                
                def _run_loop():
                    asyncio.set_event_loop(loop)
                    loop.run_forever()
                
                cls._loop_thread = threading.Thread(
                    target=_run_loop,
                    daemon=True,
                    name="playwright-event-loop"
                )
                cls._loop_thread.start()
                logger.info("[ServerBrowser] Started dedicated Playwright event loop thread")
        return cls._dedicated_loop
    
    @classmethod
    async def _ensure_browser(cls):
        """Ensure browser is launched (singleton pattern)."""
        # Lazily create asyncio.Lock on the dedicated loop thread
        if cls._browser_lock is None:
            cls._browser_lock = asyncio.Lock()
        
        async with cls._browser_lock:
            if cls._browser is None or not cls._browser.is_connected():
                logger.info("Launching Playwright browser...")
                cls._playwright = await async_playwright().start()
                cls._browser = await cls._playwright.chromium.launch(
                    headless=True,
                    args=[
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu'
                    ]
                )
                logger.info("Browser launched successfully")
    
    async def _get_or_create_context(self) -> BrowserContext:
        """Get or create browser context for this session."""
        await self._ensure_browser()
        
        if self.session_id not in self._contexts:
            logger.info(f"Creating new browser context for session {self.session_id}")
            self._contexts[self.session_id] = await self._browser.new_context(
                viewport={'width': 1280, 'height': 720},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            )
        
        return self._contexts[self.session_id]
    
    async def _get_or_create_page(self) -> Page:
        """Get or create page for this session."""
        if self.session_id not in self._pages:
            context = await self._get_or_create_context()
            self._pages[self.session_id] = await context.new_page()
            logger.info(f"Created new page for session {self.session_id}")
        
        return self._pages[self.session_id]
    
    async def _capture_screenshot(self) -> Optional[str]:
        """Capture screenshot and upload to Supabase (synchronous version for backward compatibility)."""
        try:
            page = await self._get_or_create_page()
            screenshot_bytes = await page.screenshot(full_page=False, type='png')
            
            # Upload to Supabase
            import uuid
            filename = f"{self.user_id}/{self.session_id}/{uuid.uuid4()}.png"
            
            supabase_client.storage.from_('media-uploads').upload(
                filename,
                screenshot_bytes,
                file_options={"content-type": "image/png"}
            )
            
            return filename
        except Exception as e:
            logger.error(f"Screenshot capture failed: {e}")
            return None
    
    def _emit_screenshot_event(self, action: str, page_url: str = None, screenshot_url: str = None):
        """Emit screenshot event to frontend via Redis pub/sub (non-blocking).
        
        The media-uploads bucket is private, so we generate a signed URL
        that the frontend can use directly in <img> tags without needing
        to construct URLs or have storage credentials.
        """
        if not self.redis_client or not screenshot_url:
            return
        
        try:
            # Generate a signed URL (valid for 2 hours) since the bucket is private
            # The raw storage path (e.g. user_id/session_id/uuid.png) won't work
            # with /object/public/ endpoint — it returns 400 Bad Request
            signed_url = screenshot_url  # fallback to raw path
            try:
                signed_response = supabase_client.storage.from_('media-uploads').create_signed_url(
                    path=screenshot_url,
                    expires_in=7200  # 2 hours
                )
                
                # Check for both camelCase (older SDKs) and snake_case (newer SDKs)
                if signed_response:
                    if 'signedURL' in signed_response:
                        signed_url = signed_response['signedURL']
                        logger.info(f"[Browser Screenshot] Generated signed URL (camelCase) for {action}")
                    elif 'signed_url' in signed_response:
                        signed_url = signed_response['signed_url']
                        logger.info(f"[Browser Screenshot] Generated signed URL (snake_case) for {action}")
                    else:
                        logger.warning(f"[Browser Screenshot] Signed URL response missing expected keys: {signed_response.keys()}")
            except Exception as sign_err:
                logger.error(f"[Browser Screenshot] Failed to generate signed URL: {sign_err}")
            
            event_data = {
                "screenshot_url": signed_url,
                "action": action,
                "page_url": page_url or "",
                "session_id": self.session_id,
                "message_id": self.message_id or "",
                "timestamp": int(time.time() * 1000)
            }
            
            # Publish to Redis channel
            channel = f"browser-screenshot:{self.session_id}"
            self.redis_client.publish(channel, json.dumps(event_data))
            logger.info(f"[Browser Screenshot] Published event to {channel}: {action}")
        except Exception as e:
            logger.error(f"[Browser Screenshot] Failed to emit event: {e}")
    
    async def _capture_and_emit_screenshot_async(self, action: str, page_url: str = None):
        """Capture screenshot and emit event asynchronously (fire-and-forget)."""
        try:
            screenshot_url = await self._capture_screenshot()
            if screenshot_url:
                self._emit_screenshot_event(action, page_url, screenshot_url)
        except Exception as e:
            logger.error(f"[Browser Screenshot] Async capture failed: {e}")
    
    def _run_async(self, coro):
        """Run an async coroutine on the dedicated Playwright event loop.
        
        Uses asyncio.run_coroutine_threadsafe() to submit the coroutine to the
        dedicated loop thread, then blocks the calling (eventlet green) thread
        until the result is available. This safely bridges eventlet's green threads
        with Playwright's native asyncio operations.
        """
        loop = self._get_dedicated_loop()
        future = asyncio.run_coroutine_threadsafe(coro, loop)
        try:
            return future.result(timeout=120)  # 2 min timeout for slow page loads
        except TimeoutError:
            future.cancel()
            logger.error("[ServerBrowser] Operation timed out after 120s")
            raise RuntimeError("Browser operation timed out")
        except Exception as e:
            logger.error(f"[ServerBrowser] Async operation failed: {e}")
            raise
    
    def _process_view_result(self, result: Dict[str, Any]) -> ToolResult:
        """Process result with screenshot."""
        if result.get("status") == "success" and "screenshot_path" in result:
            screenshot_path = result.pop("screenshot_path")
            try:
                image_bytes = supabase_client.storage.from_('media-uploads').download(screenshot_path)
                image_artifact = Image(content=image_bytes)
                return ToolResult(content=json.dumps(result), images=[image_artifact])
            except Exception as e:
                logger.error(f"Screenshot download failed: {e}")
                result["error"] = f"Could not retrieve screenshot"
                return ToolResult(content=json.dumps(result))
        
        return ToolResult(content=json.dumps(result))
    
    # ==================== PUBLIC TOOL METHODS ====================
    
    def get_status(self) -> Dict[str, Any]:
        """Check if browser is ready."""
        try:
            is_ready = self.session_id in self._pages
            return {
                "status": "success",
                "connected": True,
                "ready": is_ready,
                "message": "Server-side browser is ready" if is_ready else "Browser will be initialized on first use"
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}
    
    def navigate(self, url: str) -> Union[Dict[str, Any], ToolResult]:
        """Navigate to URL."""
        async def _navigate():
            try:
                if not url.startswith(('http://', 'https://')):
                    url_fixed = 'https://' + url
                else:
                    url_fixed = url
                
                page = await self._get_or_create_page()
                await page.goto(url_fixed, wait_until='networkidle', timeout=30000)
                
                # Fire screenshot capture in background (non-blocking)
                asyncio.create_task(self._capture_and_emit_screenshot_async('navigate', page.url))
                
                # Still capture screenshot for backward compatibility (agent can see it)
                screenshot_path = await self._capture_screenshot()
                
                return {
                    "status": "success",
                    "url": page.url,
                    "title": await page.title(),
                    "screenshot_path": screenshot_path
                }
            except PlaywrightTimeoutError:
                return {"status": "error", "error": "Page load timeout"}
            except Exception as e:
                logger.error(f"Navigation error: {e}")
                return {"status": "error", "error": str(e)}
        
        result = self._run_async(_navigate())
        return self._process_view_result(result)
    
    def get_current_view(self) -> Union[Dict[str, Any], ToolResult]:
        """Get current page view with screenshot."""
        async def _get_view():
            try:
                page = await self._get_or_create_page()
                
                # Fire screenshot capture in background
                asyncio.create_task(self._capture_and_emit_screenshot_async('get_current_view', page.url))
                
                screenshot_path = await self._capture_screenshot()
                
                # Extract visible text
                text_content = await page.evaluate('''() => {
                    return document.body.innerText.substring(0, 5000);
                }''')
                
                return {
                    "status": "success",
                    "url": page.url,
                    "title": await page.title(),
                    "text_preview": text_content[:500],
                    "screenshot_path": screenshot_path
                }
            except Exception as e:
                logger.error(f"Get view error: {e}")
                return {"status": "error", "error": str(e)}
        
        result = self._run_async(_get_view())
        return self._process_view_result(result)
    
    def click(self, selector: str, description: str = "") -> Union[Dict[str, Any], ToolResult]:
        """Click element by CSS selector."""
        async def _click():
            try:
                page = await self._get_or_create_page()
                await page.click(selector, timeout=10000)
                await page.wait_for_load_state('networkidle', timeout=10000)
                
                # Fire screenshot capture in background
                asyncio.create_task(self._capture_and_emit_screenshot_async('click', page.url))
                
                screenshot_path = await self._capture_screenshot()
                
                return {
                    "status": "success",
                    "message": f"Clicked: {description or selector}",
                    "url": page.url,
                    "screenshot_path": screenshot_path
                }
            except Exception as e:
                logger.error(f"Click error: {e}")
                return {"status": "error", "error": str(e)}
        
        result = self._run_async(_click())
        return self._process_view_result(result)
    
    def type_text(self, selector: str, text: str, description: str = "") -> Union[Dict[str, Any], ToolResult]:
        """Type text into element."""
        async def _type():
            try:
                page = await self._get_or_create_page()
                await page.fill(selector, text, timeout=10000)
                
                screenshot_path = await self._capture_screenshot()
                
                return {
                    "status": "success",
                    "message": f"Typed text into: {description or selector}",
                    "screenshot_path": screenshot_path
                }
            except Exception as e:
                logger.error(f"Type error: {e}")
                return {"status": "error", "error": str(e)}
        
        result = self._run_async(_type())
        return self._process_view_result(result)
    
    def scroll(self, direction: Literal['up', 'down']) -> Union[Dict[str, Any], ToolResult]:
        """Scroll page."""
        async def _scroll():
            try:
                page = await self._get_or_create_page()
                scroll_amount = 500 if direction == 'down' else -500
                await page.evaluate(f'window.scrollBy(0, {scroll_amount})')
                await page.wait_for_timeout(500)
                
                screenshot_path = await self._capture_screenshot()
                
                return {
                    "status": "success",
                    "message": f"Scrolled {direction}",
                    "screenshot_path": screenshot_path
                }
            except Exception as e:
                return {"status": "error", "error": str(e)}
        
        result = self._run_async(_scroll())
        return self._process_view_result(result)
    
    def go_back(self) -> Union[Dict[str, Any], ToolResult]:
        """Navigate back."""
        async def _back():
            try:
                page = await self._get_or_create_page()
                await page.go_back(wait_until='networkidle')
                
                # Fire screenshot capture in background
                asyncio.create_task(self._capture_and_emit_screenshot_async('go_back', page.url))
                
                screenshot_path = await self._capture_screenshot()
                
                return {
                    "status": "success",
                    "url": page.url,
                    "screenshot_path": screenshot_path
                }
            except Exception as e:
                return {"status": "error", "error": str(e)}
        
        result = self._run_async(_back())
        return self._process_view_result(result)
    
    def go_forward(self) -> Union[Dict[str, Any], ToolResult]:
        """Navigate forward."""
        async def _forward():
            try:
                page = await self._get_or_create_page()
                await page.go_forward(wait_until='networkidle')
                
                # Fire screenshot capture in background
                asyncio.create_task(self._capture_and_emit_screenshot_async('go_forward', page.url))
                
                screenshot_path = await self._capture_screenshot()
                
                return {
                    "status": "success",
                    "url": page.url,
                    "screenshot_path": screenshot_path
                }
            except Exception as e:
                return {"status": "error", "error": str(e)}
        
        result = self._run_async(_forward())
        return self._process_view_result(result)
    
    def refresh_page(self) -> Union[Dict[str, Any], ToolResult]:
        """Refresh current page."""
        async def _refresh():
            try:
                page = await self._get_or_create_page()
                await page.reload(wait_until='networkidle')
                
                # Fire screenshot capture in background
                asyncio.create_task(self._capture_and_emit_screenshot_async('refresh', page.url))
                
                screenshot_path = await self._capture_screenshot()
                
                return {
                    "status": "success",
                    "screenshot_path": screenshot_path
                }
            except Exception as e:
                return {"status": "error", "error": str(e)}
        
        result = self._run_async(_refresh())
        return self._process_view_result(result)

    def list_tabs(self) -> Union[Dict[str, Any], ToolResult]:
        """List all open tabs."""
        async def _list_tabs():
            try:
                context = await self._get_or_create_context()
                pages = context.pages
                tabs_info = []
                for i, p in enumerate(pages):
                    title = await p.title()
                    tabs_info.append({"index": i, "title": title, "url": p.url})
                
                return {
                    "status": "success",
                    "tabs": tabs_info,
                    "count": len(tabs_info)
                }
            except Exception as e:
                return {"status": "error", "error": str(e)}
        
        return ToolResult(content=json.dumps(self._run_async(_list_tabs())))

    def open_new_tab(self, url: str) -> Union[Dict[str, Any], ToolResult]:
        """Open a new tab and navigate to URL."""
        async def _open_tab():
            try:
                if not url.startswith(('http://', 'https://')):
                    url = 'https://' + url
                
                context = await self._get_or_create_context()
                page = await context.new_page()
                
                # Update current page reference for this session
                self._pages[self.session_id] = page
                
                await page.goto(url, wait_until='networkidle', timeout=30000)
                
                # Fire screenshot capture in background
                asyncio.create_task(self._capture_and_emit_screenshot_async('open_new_tab', page.url))
                
                screenshot_path = await self._capture_screenshot()
                
                return {
                    "status": "success",
                    "message": "Opened new tab",
                    "url": page.url,
                    "title": await page.title(),
                    "screenshot_path": screenshot_path
                }
            except Exception as e:
                return {"status": "error", "error": str(e)}
        
        result = self._run_async(_open_tab())
        return self._process_view_result(result)

    def switch_to_tab(self, tab_index: int) -> Union[Dict[str, Any], ToolResult]:
        """Switch to a specific tab by index."""
        async def _switch_tab():
            try:
                context = await self._get_or_create_context()
                pages = context.pages
                
                if 0 <= tab_index < len(pages):
                    page = pages[tab_index]
                    self._pages[self.session_id] = page
                    await page.bring_to_front()
                    
                    # Fire screenshot capture in background
                    asyncio.create_task(self._capture_and_emit_screenshot_async('switch_to_tab', page.url))
                    
                    screenshot_path = await self._capture_screenshot()
                    
                    return {
                        "status": "success",
                        "message": f"Switched to tab {tab_index}",
                        "url": page.url,
                        "title": await page.title(),
                        "screenshot_path": screenshot_path
                    }
                else:
                    return {"status": "error", "error": f"Invalid tab index: {tab_index}"}
            except Exception as e:
                return {"status": "error", "error": str(e)}
        
        result = self._run_async(_switch_tab())
        return self._process_view_result(result)

    def close_tab(self, tab_index: int) -> Union[Dict[str, Any], ToolResult]:
        """Close a specific tab by index."""
        async def _close_tab():
            try:
                context = await self._get_or_create_context()
                pages = context.pages
                
                if 0 <= tab_index < len(pages):
                    page = pages[tab_index]
                    await page.close()
                    
                    # If we closed the current page, switch to the last one available
                    if len(context.pages) > 0:
                        self._pages[self.session_id] = context.pages[-1]
                    else:
                        # No pages left, clear the reference
                        if self.session_id in self._pages:
                            del self._pages[self.session_id]
                    
                    return {"status": "success", "message": f"Closed tab {tab_index}"}
                else:
                    return {"status": "error", "error": f"Invalid tab index: {tab_index}"}
            except Exception as e:
                return {"status": "error", "error": str(e)}
        
        return ToolResult(content=json.dumps(self._run_async(_close_tab())))
    
    def extract_text_from_element(self, selector: str) -> Union[Dict[str, Any], ToolResult]:
        """Extract text from element."""
        async def _extract():
            try:
                page = await self._get_or_create_page()
                text = await page.text_content(selector, timeout=10000)
                
                return {
                    "status": "success",
                    "text": text
                }
            except Exception as e:
                return {"status": "error", "error": str(e)}
        
        return ToolResult(content=json.dumps(self._run_async(_extract())))
    
    def extract_table_data(self, selector: str) -> Union[Dict[str, Any], ToolResult]:
        """Extract table data."""
        async def _extract_table():
            try:
                page = await self._get_or_create_page()
                table_data = await page.evaluate(f'''(selector) => {{
                    const table = document.querySelector(selector);
                    if (!table) return null;
                    
                    const rows = Array.from(table.querySelectorAll('tr'));
                    return rows.map(row => 
                        Array.from(row.querySelectorAll('td, th')).map(cell => cell.innerText)
                    );
                }}''', selector)
                
                return {
                    "status": "success",
                    "table_data": table_data
                }
            except Exception as e:
                return {"status": "error", "error": str(e)}
        
        return ToolResult(content=json.dumps(self._run_async(_extract_table())))
    
    def wait_for_element(self, selector: str, timeout: int = 10) -> Union[Dict[str, Any], ToolResult]:
        """Wait for element to appear."""
        async def _wait():
            try:
                page = await self._get_or_create_page()
                await page.wait_for_selector(selector, timeout=timeout * 1000)
                
                return {
                    "status": "success",
                    "message": f"Element {selector} appeared"
                }
            except PlaywrightTimeoutError:
                return {"status": "error", "error": "Element did not appear in time"}
            except Exception as e:
                return {"status": "error", "error": str(e)}
        
        return ToolResult(content=json.dumps(self._run_async(_wait())))
    
    def close_browser(self) -> Dict[str, Any]:
        """Close browser context for this session."""
        async def _close():
            try:
                if self.session_id in self._pages:
                    await self._pages[self.session_id].close()
                    del self._pages[self.session_id]
                
                if self.session_id in self._contexts:
                    await self._contexts[self.session_id].close()
                    del self._contexts[self.session_id]
                
                return {"status": "success", "message": "Browser closed"}
            except Exception as e:
                return {"status": "error", "error": str(e)}
        
        return self._run_async(_close())
    
    @classmethod
    async def cleanup_all(cls):
        """Cleanup all browser resources (call on shutdown)."""
        try:
            for page in cls._pages.values():
                await page.close()
            for context in cls._contexts.values():
                await context.close()
            if cls._browser:
                await cls._browser.close()
            if cls._playwright:
                await cls._playwright.stop()
        except Exception as e:
            logger.error(f"[ServerBrowser] Error during cleanup: {e}")
        
        cls._pages.clear()
        cls._contexts.clear()
        cls._browser = None
        cls._playwright = None
        cls._browser_lock = None
        
        # Stop the dedicated event loop
        if cls._dedicated_loop and not cls._dedicated_loop.is_closed():
            cls._dedicated_loop.call_soon_threadsafe(cls._dedicated_loop.stop)
            if cls._loop_thread:
                cls._loop_thread.join(timeout=5)
            cls._dedicated_loop.close()
            cls._dedicated_loop = None
            cls._loop_thread = None
            logger.info("[ServerBrowser] Dedicated event loop stopped")
