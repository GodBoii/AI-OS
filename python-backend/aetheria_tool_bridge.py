# python-backend/aetheria_tool_bridge.py
"""
Aetheria Tool Bridge for Task Agent
Allows Task Agent to delegate complex queries to Aetheria AI system
without streaming to frontend (background execution mode)
"""

import os
import logging
import uuid
import traceback
from typing import Optional, Dict, Any
from agno.tools import Toolkit

logger = logging.getLogger(__name__)


class AetheriaToolBridge(Toolkit):
    """
    Bridge tool that allows Task Agent to delegate complex queries to Aetheria AI.
    
    This tool creates a lightweight Aetheria instance and runs queries in non-streaming
    mode, capturing the response without emitting to frontend. This enables Task Agent
    to leverage Aetheria's full tool ecosystem (internet search, email, drive, research)
    without duplicating tools.
    
    Key Features:
    - Non-streaming execution (no Socket.IO emission)
    - Isolated session (doesn't pollute user's chat history)
    - Full access to Aetheria's tools via delegation
    - Error handling with fallback responses
    """
    
    def __init__(
        self,
        user_id: str,
        task_context: Optional[Dict[str, Any]] = None,
        debug_mode: bool = False
    ):
        """
        Initialize the Aetheria Tool Bridge.
        
        Args:
            user_id: User ID for tool authentication and context
            task_context: Optional context about the current task being executed
            debug_mode: Enable debug logging
        """
        super().__init__(name="aetheria_bridge")
        self.user_id = user_id
        self.task_context = task_context or {}
        self.debug_mode = debug_mode
        
        # Register the main delegation tool
        self.register(self.delegate_to_aetheria)
        self.register(self.search_internet)
        self.register(self.research_topic)
        self.register(self.access_email)
        self.register(self.access_drive)
    
    def _get_aetheria_team(self):
        """
        Lazily create an Aetheria team instance for background execution.
        This avoids circular imports and creates a fresh instance per call.
        """
        # Import here to avoid circular dependency
        from assistant import get_llm_os
        
        # Create Aetheria with all tools enabled but no streaming config
        # No browser_tools_config or custom_tool_config since we're in background
        team = get_llm_os(
            user_id=self.user_id,
            session_info=None,
            internet_search=True,
            coding_assistant=False,  # No sandbox needed for research tasks
            World_Agent=True,
            Planner_Agent=False,  # Skip planner for direct execution
            enable_supabase=False,
            use_memory=False,  # Don't save memories for background queries
            debug_mode=self.debug_mode,
            enable_github=False,
            enable_vercel=False,
            enable_google_email=True,
            enable_google_drive=True,
            enable_browser=False,  # No browser in background mode
            browser_tools_config=None,
            custom_tool_config=None,
        )
        
        return team
    
    def _execute_query(self, query: str, context: Optional[str] = None) -> str:
        """
        Execute a query against Aetheria in non-streaming mode.
        
        Args:
            query: The query to execute
            context: Optional additional context
        
        Returns:
            Response content from Aetheria
        """
        try:
            team = self._get_aetheria_team()
            
            # Build the full query with context
            full_query = query
            if context:
                full_query = f"Context: {context}\n\nQuery: {query}"
            
            if self.task_context:
                task_info = f"Task Context: {self.task_context}"
                full_query = f"{task_info}\n\n{full_query}"
            
            # Generate unique session ID for this background query
            # This keeps it separate from user's chat sessions
            background_session_id = f"task-bg-{uuid.uuid4()}"
            
            logger.info(f"[AetheriaBridge] Executing query for user {self.user_id}")
            logger.debug(f"[AetheriaBridge] Query: {full_query[:200]}...")
            
            # Run in non-streaming mode - this captures the full response
            run_response = team.run(
                input=full_query,
                session_id=background_session_id,
                stream=False,  # Critical: No streaming for background execution
                stream_intermediate_steps=False,
            )
            
            # Extract content from response
            if run_response and hasattr(run_response, 'content'):
                content = run_response.content
                logger.info(f"[AetheriaBridge] Response received: {len(content)} chars")
                return content
            else:
                logger.warning("[AetheriaBridge] Empty response from Aetheria")
                return "Unable to get response from Aetheria AI system."
                
        except Exception as e:
            logger.error(f"[AetheriaBridge] Error executing query: {e}")
            logger.error(traceback.format_exc())
            return f"Error executing query: {str(e)}"
    
    def delegate_to_aetheria(
        self,
        query: str,
        context: Optional[str] = None,
        expected_output: Optional[str] = None
    ) -> str:
        """
        Delegate a complex query to Aetheria AI for execution.
        
        Use this when you need capabilities beyond task management:
        - Internet search and research
        - Email operations (read, search, send)
        - Google Drive operations (search, read files)
        - World knowledge (Wikipedia, ArXiv, HackerNews, YouTube)
        - API calls to external services
        
        Args:
            query: The query or task to delegate to Aetheria
            context: Optional context about why this query is needed
            expected_output: Optional description of expected output format
        
        Returns:
            Response from Aetheria AI
        
        Examples:
            - delegate_to_aetheria("Search for latest news about AI agents")
            - delegate_to_aetheria("Find my recent emails about project updates")
            - delegate_to_aetheria("Research quantum computing breakthroughs in 2024")
        """
        logger.info(f"[AetheriaBridge] Delegating query to Aetheria: {query[:100]}...")
        
        # Add expected output hint if provided
        if expected_output:
            query = f"{query}\n\nExpected output format: {expected_output}"
        
        return self._execute_query(query, context)
    
    def search_internet(
        self,
        search_query: str,
        num_results: int = 5
    ) -> str:
        """
        Search the internet for information using Aetheria's search capabilities.
        
        Args:
            search_query: What to search for
            num_results: Number of results to return (default: 5)
        
        Returns:
            Search results summary
        
        Examples:
            - search_internet("best practices for Python async programming")
            - search_internet("latest developments in renewable energy")
        """
        query = f"Search the internet for: {search_query}. Provide {num_results} relevant results with summaries."
        return self._execute_query(query)
    
    def research_topic(
        self,
        topic: str,
        sources: Optional[str] = None,
        depth: str = "moderate"
    ) -> str:
        """
        Research a topic using Aetheria's knowledge tools (Wikipedia, ArXiv, HackerNews, YouTube).
        
        Args:
            topic: The topic to research
            sources: Preferred sources - 'wikipedia', 'arxiv', 'hackernews', 'youtube', or 'all'
            depth: Research depth - 'brief', 'moderate', or 'comprehensive'
        
        Returns:
            Research findings and summary
        
        Examples:
            - research_topic("machine learning transformers", sources="arxiv", depth="comprehensive")
            - research_topic("startup funding trends", sources="hackernews")
        """
        source_hint = f" Focus on {sources} sources." if sources else ""
        depth_hint = {
            "brief": "Provide a brief overview.",
            "moderate": "Provide a moderate-depth analysis with key points.",
            "comprehensive": "Provide a comprehensive analysis with detailed findings."
        }.get(depth, "")
        
        query = f"Research the topic: {topic}.{source_hint} {depth_hint}"
        return self._execute_query(query)
    
    def access_email(
        self,
        action: str,
        query: Optional[str] = None,
        to: Optional[str] = None,
        subject: Optional[str] = None,
        body: Optional[str] = None
    ) -> str:
        """
        Access email functionality through Aetheria.
        
        Args:
            action: Email action - 'read', 'search', or 'send'
            query: Search query (for 'search' action)
            to: Recipient email (for 'send' action)
            subject: Email subject (for 'send' action)
            body: Email body (for 'send' action)
        
        Returns:
            Email operation result
        
        Examples:
            - access_email("read") - Read latest emails
            - access_email("search", query="from:boss@company.com")
            - access_email("send", to="team@company.com", subject="Update", body="...")
        """
        if action == "read":
            query_str = "Read my latest unread emails and summarize them."
        elif action == "search" and query:
            query_str = f"Search my emails for: {query}"
        elif action == "send" and to and subject and body:
            query_str = f"Send an email to {to} with subject '{subject}' and body: {body}"
        else:
            return "Invalid email action. Use 'read', 'search' (with query), or 'send' (with to, subject, body)."
        
        return self._execute_query(query_str)
    
    def access_drive(
        self,
        action: str,
        query: Optional[str] = None,
        file_id: Optional[str] = None,
        file_name: Optional[str] = None,
        content: Optional[str] = None
    ) -> str:
        """
        Access Google Drive functionality through Aetheria.
        
        Args:
            action: Drive action - 'search', 'read', or 'create'
            query: Search query (for 'search' action)
            file_id: File ID (for 'read' action)
            file_name: File name (for 'create' action)
            content: File content (for 'create' action)
        
        Returns:
            Drive operation result
        
        Examples:
            - access_drive("search", query="project proposal")
            - access_drive("read", file_id="abc123")
            - access_drive("create", file_name="Report.txt", content="...")
        """
        if action == "search" and query:
            query_str = f"Search my Google Drive for files matching: {query}"
        elif action == "read" and file_id:
            query_str = f"Read the content of Google Drive file with ID: {file_id}"
        elif action == "create" and file_name:
            content_preview = content[:200] if content else "empty"
            query_str = f"Create a new file in Google Drive named '{file_name}' with content: {content_preview}..."
        else:
            return "Invalid drive action. Use 'search' (with query), 'read' (with file_id), or 'create' (with file_name)."
        
        return self._execute_query(query_str)
