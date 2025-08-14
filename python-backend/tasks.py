# python-backend/tasks.py

import os
import logging
import json
import traceback
from typing import Dict, Any, List, Tuple

# --- Centralized Imports ---
# Import the Celery app instance and shared clients
from celery_app import celery
from clients import redis_client, supabase_client

# --- Application-Specific Imports ---
from flask_socketio import SocketIO
from assistant import get_llm_os
from browser_tools import BrowserTools
from agno.media import Image, Audio, Video, File
from agno.run.response import RunEvent
from agno.run.team import TeamRunEvent

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


def process_files(files_data: List[Dict[str, Any]]) -> Tuple[List[Image], List[Audio], List[Video], List[File]]:
    """Helper function to process file data into Agno media objects."""
    images, audio, videos, other_files = [], [], [], []
    if not files_data:
        return images, audio, videos, other_files
    
    logger.info(f"Processing {len(files_data)} files into agno objects")
    for file_data in files_data:
        file_name = file_data.get('name', 'unnamed_file')
        file_type = file_data.get('type', '')
        
        if 'path' in file_data:
            try:
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
                logger.error(f"Error downloading file from Supabase at path {file_data['path']}: {e}")
        elif file_data.get('isText') and 'content' in file_data:
            try:
                other_files.append(File(content=file_data['content'].encode('utf-8'), name=file_name, mime_type=file_type))
            except Exception as e:
                logger.error(f"Error creating File object for {file_name}: {e}")
    return images, audio, videos, other_files


@celery.task(name="run_agent_task")
def run_agent_task(sid: str, conversation_id: str, message_id: str, turn_data: dict, browser_tools_config: dict):
    """
    This Celery task runs the agent in the background, ensuring it completes
    without being terminated by web server timeouts.
    """
    # A Celery worker runs in a separate process, so it needs its own SocketIO
    # instance to communicate back to the client via the Redis message queue.
    task_socketio = SocketIO(message_queue=os.getenv("REDIS_URL"))
    
    try:
        logger.info(f"Celery worker picked up job for conversation: {conversation_id}")
        session_json = redis_client.get(f"session:{conversation_id}")
        if not session_json:
            raise Exception(f"Session data not found for conversation_id: {conversation_id}")
        
        session_data = json.loads(session_json)
        user_id = session_data['user_id']
        message = turn_data['user_message']
        
        agent = get_llm_os(
            user_id=user_id,
            session_info=session_data,
            browser_tools_config=browser_tools_config,
            **session_data['config']
        )
        
        previous_history = session_data.get("history", [])
        current_turn_message = {"role": "user", "content": message}
        complete_history = previous_history + [current_turn_message]

        for tool in agent.tools:
            if isinstance(tool, BrowserTools):
                logger.info("Injecting complete conversation history into BrowserTools instance.")
                tool.conversation_history = complete_history
                break
        
        images, audio, videos, other_files = process_files(turn_data.get('files', []))

        if agent.team_session_state is None:
            agent.team_session_state = {}
        agent.team_session_state['turn_context'] = turn_data
        
        final_assistant_response = ""
        
        import inspect
        params = inspect.signature(agent.run).parameters
        supported_params = {'message': message, 'stream': True, 'stream_intermediate_steps': True, 'user_id': user_id}
        if 'images' in params and images: supported_params['images'] = images
        if 'audio' in params and audio: supported_params['audio'] = audio
        if 'videos' in params and videos: supported_params['videos'] = videos
        if 'files' in params and other_files: supported_params['files'] = other_files

        for chunk in agent.run(**supported_params):
            if not chunk or not hasattr(chunk, 'event'):
                continue
            
            owner_name = getattr(chunk, 'agent_name', None) or getattr(chunk, 'team_name', None)
            
            if chunk.event in (RunEvent.run_response_content.value, TeamRunEvent.run_response_content.value):
                is_final_content = owner_name == "Aetheria_AI" and not (hasattr(chunk, 'member_responses') and bool(chunk.member_responses))
                task_socketio.emit("response", {
                    "content": chunk.content, "streaming": True, "id": message_id,
                    "agent_name": owner_name, "team_name": owner_name, "is_log": not is_final_content,
                }, room=sid)
                if chunk.content and is_final_content:
                    final_assistant_response += chunk.content
            
            elif chunk.event in (RunEvent.tool_call_started.value, TeamRunEvent.tool_call_started.value):
                task_socketio.emit("agent_step", {
                    "type": "tool_start", "name": getattr(chunk.tool, 'tool_name', None),
                    "agent_name": owner_name, "team_name": owner_name, "id": message_id
                }, room=sid)

            elif chunk.event in (RunEvent.tool_call_completed.value, TeamRunEvent.tool_call_completed.value):
                task_socketio.emit("agent_step", {
                    "type": "tool_end", "name": getattr(chunk.tool, 'tool_name', None),
                    "agent_name": owner_name, "team_name": owner_name, "id": message_id
                }, room=sid)

        task_socketio.emit("response", {"content": "", "done": True, "id": message_id}, room=sid)

        # Persist the updated history back to Redis
        session_data["history"].append({"role": "user", "content": message})
        session_data["history"].append({"role": "assistant", "content": final_assistant_response})
        redis_client.set(f"session:{conversation_id}", json.dumps(session_data), ex=86400)
        logger.info(f"Worker finished and UPDATED session state in Redis for conversation: {conversation_id}")

        # Log metrics to Supabase
        if hasattr(agent, 'session_metrics') and agent.session_metrics:
            metrics = agent.session_metrics
            if metrics.input_tokens > 0 or metrics.output_tokens > 0:
                supabase_client.from_('request_logs').insert({
                    'user_id': user_id, 'input_tokens': metrics.input_tokens, 'output_tokens': metrics.output_tokens
                }).execute()

    except Exception as e:
        error_msg = f"Celery task failed for conversation {conversation_id}: {str(e)}\n{traceback.format_exc()}"
        logger.error(error_msg)
        task_socketio.emit("error", {"message": "An error occurred in the AI service. Please start a new chat.", "reset": True}, room=sid)