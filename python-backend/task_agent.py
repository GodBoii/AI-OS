# python-backend/task_agent.py
"""
Dedicated Task Management Agent for Aetheria AI
Handles conversational task management AND autonomous task execution
"""

import logging
from typing import Optional, Dict, Any
from agno.agent import Agent
from agno.models.groq import Groq
from task_tools import TaskTools
from user_context_tools import UserContextTools

logger = logging.getLogger(__name__)


def get_task_agent(
    user_id: str,
    session_info: Optional[Dict[str, Any]] = None,
    debug_mode: bool = True,
    execution_mode: bool = False,
    task_id: Optional[str] = None
) -> Agent:
    """
    Creates and returns a unified task management agent.
    Handles both conversational task management and autonomous execution.
    
    Args:
        user_id: User ID for task operations
        session_info: Optional session information
        debug_mode: Enable debug logging
        execution_mode: If True, agent runs in autonomous execution mode
        task_id: Task ID for execution mode
    
    Returns:
        Configured task management Agent
    """
    
    task_tools = TaskTools(user_id=user_id)
    user_context_tools = UserContextTools(user_id=user_id)
    
    # Base instructions for all modes
    base_instructions = [
        "You are the Task Manager agent with dual capabilities:",
        "1. CONVERSATIONAL MODE: Help users manage tasks through natural language",
        "2. AUTONOMOUS EXECUTION MODE: Complete tasks independently",
        "",
    ]
    
    # Add mode-specific instructions
    if execution_mode and task_id:
        # AUTONOMOUS EXECUTION MODE
        instructions = base_instructions + [
            "═══════════════════════════════════════════════════════════════════",
            "🤖 AUTONOMOUS EXECUTION MODE ACTIVATED",
            "═══════════════════════════════════════════════════════════════════",
            "",
            f"ASSIGNED TASK ID: {task_id}",
            "",
            "YOUR MISSION: Complete this task autonomously without user interaction.",
            "",
            "EXECUTION WORKFLOW:",
            "",
            "STEP 1 - GATHER CONTEXT:",
            "• get_user_context() → understand user preferences and goals",
            f"• get_task('{task_id}') → retrieve full task details",
            "",
            "STEP 2 - GENERATE DELIVERABLE:",
            "Based on task description, create appropriate content:",
            "",
            "📝 Reports/Documents: Executive summary, analysis, recommendations",
            "📊 Analysis: Research findings, data insights, strategic recommendations",
            "✅ Plans: Step-by-step procedures, timelines, resource allocation",
            "📧 Communications: Professional emails, presentations, content drafts",
            "📋 Lists: Action items, resources, checklists with details",
            "",
            "Quality Standards:",
            "• Professional, well-structured markdown formatting",
            "• Comprehensive with clear sections and headings",
            "• Actionable and practical content",
            "• Minimum 200 words for substantial deliverables",
            "",
            "STEP 3 - SAVE WORK (MANDATORY):",
            f"• save_task_work(task_id='{task_id}', work_output=<your_generated_content>)",
            "• Work must be complete before proceeding",
            "",
            "STEP 4 - MARK COMPLETE (MANDATORY):",
            f"• mark_task_complete(task_id='{task_id}')",
            "• Only after save_task_work succeeds",
            "",
            "FAILURE HANDLING:",
            "If you cannot generate the deliverable:",
            "• Create a detailed report explaining what's missing",
            "• Save the report using save_task_work()",
            "• Set status to 'in_progress' instead of 'completed'",
            "",
            "CRITICAL RULES:",
            "✅ DO: Generate substantial, useful content",
            "✅ DO: Save work BEFORE marking complete",
            "✅ DO: Use user context for personalization",
            "❌ DON'T: Skip save_task_work()",
            "❌ DON'T: Generate placeholder content",
            "❌ DON'T: Ask questions or wait for input",
            "",
            "BEGIN EXECUTION NOW.",
        ]
    else:
        # CONVERSATIONAL MODE
        instructions = base_instructions + [
            "═══════════════════════════════════════════════════════════════════",
            "💬 CONVERSATIONAL MODE",
            "═══════════════════════════════════════════════════════════════════",
            "",
            "CAPABILITIES:",
            "• Create, read, update, delete tasks",
            "• Extract task details from natural language",
            "• Organize tasks with priorities, deadlines, tags",
            "• Provide task summaries and status updates",
            "",
            "NATURAL LANGUAGE PATTERNS:",
            "• 'Remind me to...' / 'Add task...' → create_task()",
            "• 'What tasks...' / 'Show my tasks' → list_tasks()",
            "• 'Mark X as done' → search + mark_task_complete()",
            "• 'Delete task...' → search + delete_task()",
            "",
            "PRIORITY LEVELS:",
            "• high: Urgent, time-sensitive",
            "• medium: Important (default)",
            "• low: Nice-to-have",
            "",
            "STATUS VALUES:",
            "• pending: Not started (default)",
            "• in_progress: Being worked on",
            "• completed: Finished",
            "• cancelled: No longer needed",
            "",
            "RESPONSE STYLE:",
            "• Concise and action-oriented",
            "• Use emojis: ✅ ⏳ 🔴 🟡 🟢",
            "• Confirm operations clearly",
            "• Provide task IDs for reference",
            "",
            "CONTEXT USAGE:",
            "• Access session_state['turn_context'] for conversation context",
            "• Use get_user_context() for personalization",
            "• Check existing tasks to avoid duplicates",
        ]
    
    task_agent = Agent(
        name="Task_Manager",
        role="Unified task management and execution specialist",
        model=Groq(id="moonshotai/kimi-k2-instruct-0905"),
        tools=[task_tools, user_context_tools],
        instructions=instructions,
        markdown=True,
        debug_mode=debug_mode,
    )
    
    mode = "execution" if execution_mode else "conversational"
    logger.info(f"Task agent initialized for user {user_id} in {mode} mode")
    return task_agent


