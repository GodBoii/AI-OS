# python-backend/sockets.py
#
# Manages all Socket.IO event handlers.
#
# KEY ARCHITECTURE CHANGE (Queued-Run System):
#   - Every send_message NOW joins the socket into a conversation room
#     named "conv:{conversation_id}".
#   - agent_runner emits to that room (not the ephemeral SID).
#   - On reconnect, the client sends "join_conversation" to rejoin the room
#     and receive the current run state / catch-up result.
#   - RunStateManager tracks: running | completed | failed in Redis.

import logging
import json
import uuid
import traceback
from typing import Dict, Any
from redis import Redis

import eventlet
from flask import request
from flask_socketio import join_room
from gotrue.errors import AuthApiError

from extensions import socketio
from supabase_client import supabase_client
from session_service import ConnectionManager
from agent_runner import run_agent_and_stream
from title_generator import generate_and_save_title
from run_state_manager import RunStateManager
from subscription_service import UsageLimitExceeded, enforce_usage_limit

logger = logging.getLogger(__name__)

# --- Dependency Injection Placeholders ---
connection_manager_service: ConnectionManager = None
redis_client_instance: Redis = None
run_state_manager_instance: RunStateManager = None

# SID × conversation dedup — prevents sending run_catchup twice to the same
# socket if the client calls join_conversation more than once per session.
# Key: (sid, conversation_id)   Value: True
_catchup_sent: dict = {}


def _normalize_agent_mode(raw_value: Any) -> str:
    value = str(raw_value or "").strip().lower()
    if value == "coder":
        return "coder"
    if value == "computer":
        return "computer"
    return "default"


def set_dependencies(manager: ConnectionManager, redis_client: Redis, run_state_mgr: RunStateManager):
    """A setter function to inject dependencies from the factory."""
    global connection_manager_service, redis_client_instance, run_state_manager_instance
    connection_manager_service = manager
    redis_client_instance = redis_client
    run_state_manager_instance = run_state_mgr
    logger.info("Dependencies (ConnectionManager, RedisClient, RunStateManager) injected into sockets module.")

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
                    # Emit to conversation room so any reconnected client picks it up
                    socketio.emit('browser_screenshot', data, room=f"conv:{session_id}")
                    logger.info(f"[Browser Screenshot] Emitted to room conv:{session_id}: {data.get('action')}")
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
    sid = request.sid
    logger.info(f"Client disconnected: {sid}")
    # Clear all dedup entries for this SID so next reconnect works cleanly
    to_remove = [k for k in _catchup_sent if k[0] == sid]
    for k in to_remove:
        del _catchup_sent[k]


@socketio.on("join_conversation")
def on_join_conversation(data: Dict[str, Any]):
    """
    Called by the client on connect/reconnect to re-subscribe to a conversation room.
    If a run was completed while the client was away, the catch-up result is sent
    directly to this SID so the client can render the finished response.
    """
    sid = request.sid
    conversation_id = data.get("conversationId") if isinstance(data, dict) else None
    if not conversation_id:
        return

    room_name = f"conv:{conversation_id}"
    join_room(room_name)
    logger.info(f"[Join] SID {sid} joined room {room_name}")

    if not run_state_manager_instance:
        return

    # Check current run state and send catch-up data to this specific socket
    state = run_state_manager_instance.get_state(conversation_id)
    if not state:
        # No active or recent run — just confirm join
        socketio.emit("run_status", {"status": "idle", "conversationId": conversation_id}, room=sid)
        return

    status = state.get("status")
    message_id = state.get("message_id")

    if status == "running":
        # Agent is still working — tell the client it's in-progress
        socketio.emit("run_status", {
            "status": "running",
            "conversationId": conversation_id,
            "messageId": message_id,
        }, room=sid)
        logger.info(f"[Join] Conv {conversation_id} is still running, told client to wait")

    elif status == "completed":
        # Guard: never send run_catchup twice to the same SID for the same conversation
        dedup_key = (sid, conversation_id)
        if dedup_key in _catchup_sent:
            logger.info(f"[Join] Catchup already sent for conv {conversation_id} to SID {sid}, skipping")
            return
        _catchup_sent[dedup_key] = True

        # Agent finished while client was away — send the stored result for catch-up
        result = run_state_manager_instance.get_result(conversation_id)
        if result:
            socketio.emit("run_catchup", {
                "conversationId": conversation_id,
                "messageId": message_id,
                "content": result.get("content", ""),
                "events": result.get("events", []),
                "title": result.get("title"),
                "status": "completed",
            }, room=sid)
            logger.info(f"[Join] Sent catchup result for conv {conversation_id} to SID {sid}")
        else:
            socketio.emit("run_status", {"status": "completed", "conversationId": conversation_id, "messageId": message_id}, room=sid)

    elif status == "failed":
        result = run_state_manager_instance.get_result(conversation_id)
        socketio.emit("run_status", {
            "status": "failed",
            "conversationId": conversation_id,
            "messageId": message_id,
            "error": (result or {}).get("error", "An error occurred."),
        }, room=sid)
        logger.info(f"[Join] Conv {conversation_id} had failed run, notified SID {sid}")


@socketio.on('save-user-context')
def handle_save_user_context(data: Dict[str, Any]):
    """Saves user context to agno_memories table via UserContextTools"""
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

        from user_context_tools import UserContextTools
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
    """Retrieves user context from agno_memories table via UserContextTools"""
    sid = request.sid
    try:
        access_token = data.get("accessToken")
        if not access_token:
            return socketio.emit("user-context-retrieved", {"success": False, "error": "Authentication token missing"}, room=sid)

        user = supabase_client.auth.get_user(jwt=access_token).user
        if not user:
            return socketio.emit("user-context-retrieved", {"success": False, "error": "User not authenticated"}, room=sid)

        from user_context_tools import UserContextTools
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


@socketio.on('computer-command-result')
def handle_computer_command_result(data: Dict[str, Any]):
    """
    Receives a computer control result from the client and PUBLISHES it to the
    corresponding Redis channel, waking up the waiting agent tool.
    """
    if not redis_client_instance:
        logger.error("Redis client not initialized. Cannot handle computer command result.")
        return

    request_id = data.get('request_id')
    result_payload = data.get('result', {})

    if request_id:
        response_channel = f"computer-response:{request_id}"
        try:
            redis_client_instance.publish(response_channel, json.dumps(result_payload))
            logger.info(f"Published computer result for request_id {request_id} to Redis channel {response_channel}")
        except Exception as e:
            logger.error(f"Failed to publish computer result to Redis for {request_id}: {e}")
    else:
        logger.warning("Received computer command result with no request_id.")


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

        # --- ROOM JOIN: Subscribe current SID to this conversation's room ---
        room_name = f"conv:{conversation_id}"
        join_room(room_name)
        logger.info(f"[send_message] SID {sid} joined room {room_name}")

        if data.get("type") == "terminate_session":
            connection_manager_service.terminate_session(conversation_id)
            if run_state_manager_instance:
                run_state_manager_instance.clear(conversation_id)
            return socketio.emit("status", {"message": f"Session {conversation_id} terminated"}, room=sid)

        requested_agent_mode = _normalize_agent_mode(
            data.get("agent_mode") or (data.get("config", {}) or {}).get("agent_mode")
        )

        if not connection_manager_service.get_session(conversation_id):
            device_type = data.get("deviceType", "web")
            session_config = dict(data.get("config", {}))
            session_config["agent_mode"] = requested_agent_mode
            connection_manager_service.create_session(
                conversation_id,
                str(user.id),
                session_config,
                device_type=device_type
            )

            # --- Title Generation for New Sessions ---
            user_msg_content = data.get("message", "")
            if user_msg_content:
                import time
                current_ts = int(time.time())
                eventlet.spawn(generate_and_save_title, conversation_id, str(user.id), user_msg_content, current_ts)

        try:
            enforce_usage_limit(str(user.id))
        except UsageLimitExceeded as exc:
            socketio.emit("error", {
                "message": str(exc),
                "code": "subscription_limit_exceeded",
                "limit_info": exc.summary,
            }, room=sid)
            return

        turn_data = {"user_message": data.get("message", ""), "files": data.get("files", [])}
        context_session_ids = data.get("context_session_ids", [])
        message_id = data.get("id") or str(uuid.uuid4())

        # --- Register user-uploaded files in session_content for persistence ---
        files = data.get("files", [])
        if files:
            try:
                from sandbox_persistence import get_persistence_service
                persistence_service = get_persistence_service()

                for file_data in files:
                    if file_data.get('path'):
                        persistence_service.register_content(
                            session_id=conversation_id,
                            user_id=str(user.id),
                            content_type='upload',
                            reference_id=str(uuid.uuid4()),
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

        eventlet.spawn(
            run_agent_and_stream,
            sid,
            conversation_id,
            message_id,
            turn_data,
            browser_tools_config,
            context_session_ids,
            requested_agent_mode,
            connection_manager_service,
            redis_client_instance,
            run_state_manager_instance,  # NEW: pass run state manager
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
        if isinstance(data, str):
            data = json.loads(data)

        logger.info(f"[Assistant Socket] Received message: {data}")

        user_message = data.get("message", "")
        conversation_id = data.get("conversationId")

        if not conversation_id and data.get("session_id"):
            conversation_id = data.get("session_id")

        if not conversation_id:
            conversation_id = str(uuid.uuid4())
            logger.info(f"[Assistant Socket] Generated new conversation ID: {conversation_id}")

        if not user_message:
            return socketio.emit("assistant_error", {"message": "Message is required"}, room=sid)

        # Join conversation room for assistant too
        room_name = f"conv:{conversation_id}"
        join_room(room_name)

        user_id = "android_assistant"

        if not connection_manager_service.get_session(conversation_id):
            connection_manager_service.create_session(
                conversation_id,
                user_id,
                data.get("config", {
                    "internet_search": True,
                    "coding_assistant": True,
                    "Planner_Agent": True
                }),
                device_type='mobile'
            )

        turn_data = {"user_message": user_message, "files": []}
        message_id = data.get("id") or str(uuid.uuid4())

        browser_tools_config = {'sid': sid, 'socketio': socketio, 'redis_client': redis_client_instance}

        eventlet.spawn(
            run_agent_and_stream,
            sid,
            conversation_id,
            message_id,
            turn_data,
            browser_tools_config,
            [],
            "default",
            connection_manager_service,
            redis_client_instance,
            run_state_manager_instance,  # NEW: pass run state manager
        )
        logger.info(f"[Assistant Socket] Spawned agent for {conversation_id}")

    except Exception as e:
        logger.error(f"[Assistant Socket] Error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        socketio.emit("assistant_error", {"message": "I encountered an error processing your request."}, room=sid)
