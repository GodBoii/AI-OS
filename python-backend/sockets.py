# python-backend/sockets.py (Corrected Version)

import logging
import json
import uuid
import traceback
from typing import Dict, Any

import eventlet
from flask import request
from gotrue.errors import AuthApiError

# Import the shared socketio instance from extensions
from extensions import socketio, browser_waiting_events
from supabase_client import supabase_client

# We need to import the services that our handlers will use
# This creates a dependency, which we will manage in the factory
from session_service import ConnectionManager
from agent_runner import run_agent_and_stream

logger = logging.getLogger(__name__)

# This is a placeholder. The real instance will be injected by the factory.
# This is a common pattern to solve circular dependencies while allowing type hinting.
connection_manager_service: ConnectionManager = None

def set_connection_manager(manager: ConnectionManager):
    """A setter function to inject the connection manager dependency from the factory."""
    global connection_manager_service
    connection_manager_service = manager
    logger.info("ConnectionManager service injected into sockets module.")


# ==============================================================================
# SOCKET.IO EVENT HANDLERS (using decorators)
# ==============================================================================

@socketio.on("connect")
def on_connect():
    """Handles a new client connection. Logs the connection."""
    logger.info(f"Client connected: {request.sid}")
    socketio.emit("status", {"message": "Connected to server"}, room=request.sid)


@socketio.on("disconnect")
def on_disconnect():
    """Handles a client disconnection. Logs the event."""
    logger.info(f"Client disconnected: {request.sid}")


@socketio.on('browser-command-result')
def handle_browser_command_result(data: Dict[str, Any]):
    """Receives the result of a browser command from the client."""
    request_id = data.get('request_id')
    if request_id in browser_waiting_events:
        browser_waiting_events.get(request_id).send(data.get('result', {}))


@socketio.on("send_message")
def on_send_message(data: str):
    """The main message handler. It now uses the globally injected connection_manager_service."""
    sid = request.sid
    if not connection_manager_service:
        logger.error("ConnectionManager service not initialized. Cannot handle message.")
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
            connection_manager_service.create_session(conversation_id, str(user.id), data.get("config", {}))

        turn_data = {"user_message": data.get("message", ""), "files": data.get("files", [])}
        context_session_ids = data.get("context_session_ids", [])
        message_id = data.get("id") or str(uuid.uuid4())
        
        browser_tools_config = {'sid': sid, 'socketio': socketio, 'waiting_events': browser_waiting_events}
        custom_tool_config = {'sid': sid, 'socketio': socketio, 'message_id': message_id}

        eventlet.spawn(
            run_agent_and_stream,
            sid, conversation_id, message_id, turn_data,
            browser_tools_config, custom_tool_config,
            context_session_ids, connection_manager_service
        )
        logger.info(f"Spawned agent run for conversation: {conversation_id}")

    except AuthApiError as e:
        logger.error(f"Invalid token for SID {sid}: {e.message}")
        socketio.emit("error", {"message": "Your session has expired. Please log in again.", "reset": True}, room=sid)
    except Exception as e:
        logger.error(f"Error in message handler: {e}\n{traceback.format_exc()}")
        socketio.emit("error", {"message": "AI service error. Please start a new chat.", "reset": True}, room=sid)