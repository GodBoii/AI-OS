# python-backend/agent_runner.py

import logging
import json
import traceback
from typing import Dict, Any, List, Tuple

# --- Local Module Imports ---
# Import extensions and services that the runner depends on
from extensions import socketio
from assistant import get_llm_os
from supabase_client import supabase_client
from session_service import ConnectionManager

# --- Agno Framework Imports ---
from agno.media import Image, Audio, Video, File
from agno.run.agent import RunEvent
from agno.run.team import TeamRunEvent, TeamRunOutput

logger = logging.getLogger(__name__)


def process_files(files_data: List[Dict[str, Any]]) -> Tuple[List[Image], List[Audio], List[Video], List[File]]:
    """
    Processes a list of file data from the frontend, downloading media from
    Supabase storage or encoding text content, and converting them into
    Agno media objects.

    Args:
        files_data (List[Dict[str, Any]]): A list of file dictionaries from the client.

    Returns:
        A tuple containing lists of Image, Audio, Video, and File objects.
    """
    images, audio, videos, other_files = [], [], [], []
    if not files_data:
        return images, audio, videos, other_files

    for file_data in files_data:
        file_name = file_data.get('name', 'untitled')
        file_type = file_data.get('type', 'application/octet-stream')

        # Handle cloud-stored media files (images, videos, etc.)
        if 'path' in file_data:
            try:
                logger.info(f"Downloading file from Supabase storage: {file_data['path']}")
                file_bytes = supabase_client.storage.from_('media-uploads').download(file_data['path'])
                
                if file_type.startswith('image/'):
                    images.append(Image(content=file_bytes, name=file_name))
                elif file_type.startswith('audio/'):
                    audio.append(Audio(content=file_bytes, format=file_type.split('/')[-1], name=file_name))
                elif file_type.startswith('video/'):
                    videos.append(Video(content=file_bytes, name=file_name))
                else:
                    other_files.append(File(content=file_bytes, name=file_name, mime_type=file_type))
            except Exception as e:
                logger.error(f"Error downloading file {file_data['path']} from Supabase: {e}")
        
        # Handle text-based files sent directly from the client
        elif file_data.get('isText') and 'content' in file_data:
            logger.info(f"Processing text file content for: {file_name}")
            other_files.append(File(content=file_data['content'].encode('utf-8'), name=file_name, mime_type=file_type))

    return images, audio, videos, other_files


def run_agent_and_stream(
    sid: str,
    conversation_id: str,
    message_id: str,
    turn_data: dict,
    browser_tools_config: dict,
    custom_tool_config: dict,
    context_session_ids: List[str],
    connection_manager: ConnectionManager
):
    """
    Orchestrates a full agent run for a single user turn. This function is
    designed to be run in a separate greenlet to avoid blocking the main server thread.

    Args:
        sid (str): The client's Socket.IO session ID.
        conversation_id (str): The unique ID for the current conversation.
        message_id (str): The unique ID for the current message turn.
        turn_data (dict): Data for this turn, including the user message and files.
        browser_tools_config (dict): Configuration for the BrowserTools.
        custom_tool_config (dict): Configuration for custom tools like image generation.
        context_session_ids (List[str]): A list of session IDs to use as historical context.
        connection_manager (ConnectionManager): An instance of the session service.
    """
    try:
        # 1. Retrieve Session and User Data
        session_data = connection_manager.get_session(conversation_id)
        if not session_data:
            raise Exception(f"Session data not found for conversation {conversation_id}")
        user_id = session_data['user_id']

        # 2. Initialize the Agent
        agent = get_llm_os(
            user_id=user_id,
            session_info=session_data,
            browser_tools_config=browser_tools_config,
            custom_tool_config=custom_tool_config,
            **session_data['config']
        )

        # 3. Process Input Data
        images, audio, videos, other_files = process_files(turn_data.get('files', []))
        current_session_state = {'turn_context': turn_data}
        user_message = turn_data.get("user_message", "")
        
        # 4. Fetch and Prepend Historical Context
        historical_context_str = ""
        if context_session_ids:
            logger.info(f"Fetching context from {len(context_session_ids)} sessions.")
            historical_context_str = "CONTEXT FROM PREVIOUS CHATS:\n---\n"
            for session_id in context_session_ids:
                try:
                    response = supabase_client.from_('agno_sessions').select('runs').eq('session_id', session_id).single().execute()
                    if response.data and response.data.get('runs'):
                        runs = response.data['runs']
                        top_level_runs = [run for run in runs if not run.get('parent_run_id')]
                        for run in top_level_runs:
                            user_input = run.get('input', {}).get('input_content', '')
                            assistant_output = run.get('content', '')
                            if user_input:
                                historical_context_str += f"User: {user_input}\nAssistant: {assistant_output}\n---\n"
                except Exception as e:
                    logger.error(f"Failed to fetch or process context for session_id {session_id}: {e}")
            historical_context_str += "\n"
        
        final_user_message = f"{historical_context_str}CURRENT QUESTION:\n{user_message}" if historical_context_str else user_message

        # 5. Run the Agent and Stream Results
        run_output: TeamRunOutput | None = None
        for chunk in agent.run(
            input=final_user_message,
            images=images or None,
            audio=audio or None,
            videos=videos or None,
            files=other_files or None,
            session_id=conversation_id,
            session_state=current_session_state,
            stream=True,
            stream_intermediate_steps=True,
            add_history_to_context=True
        ):
            if not chunk or not hasattr(chunk, 'event'):
                continue

            if isinstance(chunk, TeamRunOutput):
                run_output = chunk

            owner_name = getattr(chunk, 'agent_name', None) or getattr(chunk, 'team_name', None)

            # Stream content and tool usage events to the client
            if chunk.event in (RunEvent.run_content.value, TeamRunEvent.run_content.value):
                is_final = owner_name == "Aetheria_AI" and not getattr(chunk, 'member_responses', [])
                socketio.emit("response", {"content": chunk.content, "streaming": True, "id": message_id, "agent_name": owner_name, "is_log": not is_final}, room=sid)
            elif chunk.event in (RunEvent.tool_call_started.value, TeamRunEvent.tool_call_started.value):
                socketio.emit("agent_step", {"type": "tool_start", "name": getattr(chunk.tool, 'tool_name', None), "agent_name": owner_name, "id": message_id}, room=sid)
            elif chunk.event in (RunEvent.tool_call_completed.value, TeamRunEvent.tool_call_completed.value):
                socketio.emit("agent_step", {"type": "tool_end", "name": getattr(chunk.tool, 'tool_name', None), "agent_name": owner_name, "id": message_id}, room=sid)

        # 6. Finalize the Stream and Log Metrics
        socketio.emit("response", {"done": True, "id": message_id}, room=sid)
        
        if run_output and run_output.metrics and (run_output.metrics.input_tokens > 0 or run_output.metrics.output_tokens > 0):
            supabase_client.from_('request_logs').insert({
                'user_id': user_id,
                'input_tokens': run_output.metrics.input_tokens,
                'output_tokens': run_output.metrics.output_tokens
            }).execute()

    except Exception as e:
        logger.error(f"Agent run failed for conversation {conversation_id}: {e}\n{traceback.format_exc()}")
        socketio.emit("error", {"message": str(e), "reset": True}, room=sid)