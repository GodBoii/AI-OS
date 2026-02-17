# python-backend/sockets.py (Corrected to align with refactored agent_runner)

import logging
import json
import uuid
import traceback
from typing import Dict, Any
from redis import Redis

import eventlet
from flask import request
from gotrue.errors import AuthApiError

# Import the shared socketio instance from extensions
from extensions import socketio
from supabase_client import supabase_client
from session_service import ConnectionManager
from agent_runner import run_agent_and_stream
from title_generator import generate_and_save_title

logger = logging.getLogger(__name__)

# --- Dependency Injection Placeholders ---
connection_manager_service: ConnectionManager = None
redis_client_instance: Redis = None

def set_dependencies(manager: ConnectionManager, redis_client: Redis):
    """A setter function to inject dependencies from the factory."""
    global connection_manager_service, redis_client_instance
    connection_manager_service = manager
    redis_client_instance = redis_client
    logger.info("Dependencies (ConnectionManager, RedisClient) injected into sockets module.")
    
    # Start browser screenshot listener
    if redis_client_instance:
        eventlet.spawn(listen_for_browser_screenshots)


def listen_for_browser_screenshots():
    """Listen for browser screenshot events from Redis and forward to frontend."""
    if not redis_client_instance:
        logger.error("[Browser Screenshot] Redis client not available")
        return
    
    try:
        pubsub = redis_client_instance.pubsub()
        pubsub.psubscribe('browser-screenshot:*')
        logger.info("[Browser Screenshot] Listener started, subscribed to browser-screenshot:*")
        
        for message in pubsub.listen():
            if message['type'] == 'pmessage':
                try:
                    data = json.loads(message['data'])
                    session_id = message['channel'].decode('utf-8').split(':')[1]
                    
                    logger.info(f"[Browser Screenshot] Received event for session {session_id}: {data.get('action')}")
                    
                    # Find socket ID for this session
                    # We need to get the sid from the connection manager
                    # For now, we'll broadcast to all connected clients with the session_id in the payload
                    # The frontend will filter by session_id
                    
                    socketio.emit('browser_screenshot', data)
                    logger.info(f"[Browser Screenshot] Emitted to frontend: {data.get('action')}")
                    
                except Exception as e:
                    logger.error(f"[Browser Screenshot] Error processing message: {e}")
                    
    except Exception as e:
        logger.error(f"[Browser Screenshot] Listener error: {e}\n{traceback.format_exc()}")


# ==============================================================================
# SOCKET.IO EVENT HANDLERS
# ==============================================================================

@socketio.on("connect")
def on_connect():
    logger.info(f"Client connected: {request.sid}")
    socketio.emit("status", {"message": "Connected to server"}, room=request.sid)


@socketio.on("disconnect")
def on_disconnect():
    logger.info(f"Client disconnected: {request.sid}")


@socketio.on('save-user-context')
def handle_save_user_context(data: Dict[str, Any]):
    """
    Saves user context to agno_memories table via UserContextTools
    """
    sid = request.sid
    try:
        logger.info(f"Received save-user-context request: {data.keys()}")
        
        access_token = data.get("accessToken")
        if not access_token:
            logger.error("Authentication token missing")
            return socketio.emit("user-context-saved", {"success": False, "error": "Authentication token missing"}, room=sid)
        
        user = supabase_client.auth.get_user(jwt=access_token).user
        if not user:
            logger.error("User not authenticated")
            return socketio.emit("user-context-saved", {"success": False, "error": "User not authenticated"}, room=sid)
        
        context_data = data.get('context')
        if not context_data:
            logger.error("Context data missing")
            return socketio.emit("user-context-saved", {"success": False, "error": "Context data missing"}, room=sid)
        
        logger.info(f"Saving context for user {user.id}: {json.dumps(context_data, indent=2)}")
        
        # Import UserContextTools
        from user_context_tools import UserContextTools
        
        # Save context
        context_tools = UserContextTools(user_id=str(user.id))
        result = context_tools.save_user_context(context_data)
        
        logger.info(f"Save result: {result}")
        socketio.emit("user-context-saved", {"success": True, "result": result}, room=sid)
        logger.info(f"User context saved successfully for user {user.id}")
        
    except Exception as e:
        logger.error(f"Error saving user context: {e}\n{traceback.format_exc()}")
        socketio.emit("user-context-saved", {"success": False, "error": str(e)}, room=sid)


@socketio.on('get-user-context')
def handle_get_user_context(data: Dict[str, Any]):
    """
    Retrieves user context from agno_memories table via UserContextTools
    """
    sid = request.sid
    try:
        access_token = data.get("accessToken")
        if not access_token:
            return socketio.emit("user-context-retrieved", {"success": False, "error": "Authentication token missing"}, room=sid)
        
        user = supabase_client.auth.get_user(jwt=access_token).user
        if not user:
            return socketio.emit("user-context-retrieved", {"success": False, "error": "User not authenticated"}, room=sid)
        
        # Import UserContextTools
        from user_context_tools import UserContextTools
        
        # Get context
        context_tools = UserContextTools(user_id=str(user.id))
        context = context_tools.get_user_context()
        
        socketio.emit("user-context-retrieved", {"success": True, "context": context}, room=sid)
        logger.info(f"User context retrieved for user {user.id}")
        
    except Exception as e:
        logger.error(f"Error retrieving user context: {e}\n{traceback.format_exc()}")
        socketio.emit("user-context-retrieved", {"success": False, "error": str(e)}, room=sid)


@socketio.on('browser-command-result')
def handle_browser_command_result(data: Dict[str, Any]):
    """
    Receives a result from the client and PUBLISHES it to the corresponding
    Redis channel, waking up the waiting agent tool.
    """
    if not redis_client_instance:
        logger.error("Redis client not initialized. Cannot handle browser command result.")
        return

    request_id = data.get('request_id')
    result_payload = data.get('result', {})

    if request_id:
        response_channel = f"browser-response:{request_id}"
        try:
            redis_client_instance.publish(response_channel, json.dumps(result_payload))
            logger.info(f"Published result for request_id {request_id} to Redis channel {response_channel}")
        except Exception as e:
            logger.error(f"Failed to publish browser result to Redis for {request_id}: {e}")
    else:
        logger.warning("Received browser command result with no request_id.")


@socketio.on("send_message")
def on_send_message(data: str):
    """The main message handler for incoming chat messages."""
    sid = request.sid
    if not connection_manager_service or not redis_client_instance:
        logger.error("Services not initialized. Cannot handle message.")
        return

    try:
        data = json.loads(data)
        access_token = data.get("accessToken")
        conversation_id = data.get("conversationId")

        if not conversation_id:
            return socketio.emit("error", {"message": "Critical error: conversationId is missing."}, room=sid)
        if not access_token:
            return socketio.emit("error", {"message": "Authentication token is missing.", "reset": True}, room=sid)

        user = supabase_client.auth.get_user(jwt=access_token).user
        if not user:
            raise AuthApiError("User not found for token.", 401)

        if data.get("type") == "terminate_session":
            connection_manager_service.terminate_session(conversation_id)
            return socketio.emit("status", {"message": f"Session {conversation_id} terminated"}, room=sid)

        if not connection_manager_service.get_session(conversation_id):
            # Extract device type from request
            device_type = data.get("deviceType", "web")  # Default to 'web' if not provided
            connection_manager_service.create_session(
                conversation_id, 
                str(user.id), 
                data.get("config", {}),
                device_type=device_type  # Pass device type
            )
            
            # --- Title Generation for New Sessions ---
            user_msg_content = data.get("message", "")
            if user_msg_content:
                import time
                current_ts = int(time.time())
                eventlet.spawn(generate_and_save_title, conversation_id, str(user.id), user_msg_content, current_ts)

        turn_data = {"user_message": data.get("message", ""), "files": data.get("files", [])}
        context_session_ids = data.get("context_session_ids", [])
        message_id = data.get("id") or str(uuid.uuid4())
        
        # Register user-uploaded files in session_content for persistence
        files = data.get("files", [])
        if files:
            try:
                from sandbox_persistence import get_persistence_service
                persistence_service = get_persistence_service()
                
                for file_data in files:
                    # Only register files that have a path (uploaded to Supabase)
                    if file_data.get('path'):
                        persistence_service.register_content(
                            session_id=conversation_id,
                            user_id=str(user.id),
                            content_type='upload',
                            reference_id=str(uuid.uuid4()),  # Generate unique ID for upload
                            message_id=message_id,
                            metadata={
                                'filename': file_data.get('name', 'unknown'),
                                'mime_type': file_data.get('type', 'application/octet-stream'),
                                'path': file_data.get('path'),
                                'is_text': file_data.get('isText', False)
                            }
                        )
                logger.info(f"Registered {len(files)} user uploads for session {conversation_id}")
            except Exception as e:
                logger.warning(f"Failed to register user uploads: {e}")
        
        browser_tools_config = {'sid': sid, 'socketio': socketio, 'redis_client': redis_client_instance}
        
        # --- FIX APPLIED HERE ---
        # The obsolete `custom_tool_config` variable and its corresponding argument
        # in the spawn call have been removed to match the new 8-argument signature
        # of `run_agent_and_stream`.
        eventlet.spawn(
            run_agent_and_stream,
            sid,
            conversation_id,
            message_id,
            turn_data,
            browser_tools_config,
            context_session_ids,
            connection_manager_service,
            redis_client_instance
        )
        logger.info(f"Spawned agent run for conversation: {conversation_id}")

    except AuthApiError as e:
        logger.error(f"Invalid token for SID {sid}: {e.message}")
        socketio.emit("error", {"message": "Your session has expired. Please log in again."}, room=sid)
    except Exception as e:
        import sys
        print(f"DEBUG: Error in message handler: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        logger.error(f"Error in message handler: {e}\n{traceback.format_exc()}")
        socketio.emit("error", {"message": "An error occurred. Your conversation is preserved. Please try again."}, room=sid)

@socketio.on("assistant_message")
def on_assistant_message(data: str):
    """
    Dedicated message handler for the Android Assistant.
    Does NOT require an access_token. Uses 'android_assistant' as user_id.
    """
    sid = request.sid
    if not connection_manager_service or not redis_client_instance:
        logger.error("Services not initialized. Cannot handle assistant message.")
        return

    try:
        # Data might be a JSON string or dict depending on client implementation
        if isinstance(data, str):
            data = json.loads(data)
            
        logger.info(f"[Assistant Socket] Received message: {data}")
        
        user_message = data.get("message", "")
        conversation_id = data.get("conversationId")
        
        # Helper to treat session_id as conversation_id if missing
        if not conversation_id and data.get("session_id"):
            conversation_id = data.get("session_id")

        if not conversation_id:
            # Generate one if missing, though client should provide it
            conversation_id = str(uuid.uuid4())
            logger.info(f"[Assistant Socket] Generated new conversation ID: {conversation_id}")

        if not user_message:
            return socketio.emit("assistant_error", {"message": "Message is required"}, room=sid)

        # Fixed User ID for assistant
        user_id = "android_assistant"

        # Create session if not exists
        if not connection_manager_service.get_session(conversation_id):
            connection_manager_service.create_session(
                conversation_id, 
                user_id, 
                data.get("config", {
                    "internet_search": True,
                    "coding_assistant": True, 
                    "Planner_Agent": True
                }),
                device_type='mobile'  # Assistant is always mobile
            )
            
        turn_data = {"user_message": user_message, "files": []}
        message_id = data.get("id") or str(uuid.uuid4())
        
        # Assistant doesn't support browser tools yet, but we pass empty config or basic
        browser_tools_config = {'sid': sid, 'socketio': socketio, 'redis_client': redis_client_instance}
        
        # Reuse the existing agent runner
        eventlet.spawn(
            run_agent_and_stream,
            sid,
            conversation_id,
            message_id,
            turn_data,
            browser_tools_config,
            [], # No context session ids
            connection_manager_service,
            redis_client_instance
        )
        logger.info(f"[Assistant Socket] Spawned agent for {conversation_id}")

    except Exception as e:
        logger.error(f"[Assistant Socket] Error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        socketio.emit("assistant_error", {"message": "I encountered an error processing your request."}, room=sid)
