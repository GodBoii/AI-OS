# python-backend/agent_runner.py (Corrected for Dependency Injection)

import logging
import json
import traceback
import inspect
from typing import Dict, Any, List, Tuple
from redis import Redis
import requests

# --- Local Module Imports ---
from extensions import socketio
from assistant import get_llm_os
from coder_agent import get_coder_agent
from computer_agent import get_computer_agent
from convex_usage_service import get_convex_usage_service
from subscription_service import get_usage_window_descriptor
from supabase_client import supabase_client
from session_service import ConnectionManager
from run_state_manager import RunStateManager
import config

# --- Agno Framework Imports ---
from agno.media import Image, Audio, Video, File
from agno.run.agent import RunEvent
from agno.run.team import TeamRunEvent, TeamRunOutput

logger = logging.getLogger(__name__)


def _filter_kwargs_for_callable(fn: Any, kwargs: Dict[str, Any], label: str = "kwargs") -> Dict[str, Any]:
    """
    Keep only kwargs accepted by the callable (unless it supports **kwargs).
    Prevents runtime TypeError when session metadata is present in config.
    """
    try:
        signature = inspect.signature(fn)
    except (TypeError, ValueError):
        return dict(kwargs)

    if any(param.kind == inspect.Parameter.VAR_KEYWORD for param in signature.parameters.values()):
        return dict(kwargs)

    accepted = {
        name
        for name, param in signature.parameters.items()
        if param.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
    }
    filtered = {key: value for key, value in kwargs.items() if key in accepted}
    dropped = sorted(set(kwargs.keys()) - set(filtered.keys()))
    if dropped:
        logger.info(
            "Dropped unsupported %s for %s: %s",
            label,
            getattr(fn, "__name__", str(fn)),
            dropped,
        )
    return filtered


def _safe_json_like(value: Any) -> Any:
    """Best-effort conversion for tool payloads that may already be JSON strings."""
    if value is None:
        return None
    if isinstance(value, (dict, list, int, float, bool)):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return text
        if text.startswith("{") or text.startswith("["):
            try:
                return json.loads(text)
            except Exception:
                return value
        return value
    return str(value)


def _serialize_tool_event(tool_obj: Any) -> Dict[str, Any] | None:
    """Extract only the frontend-safe parts of an Agno tool event."""
    if not tool_obj:
        return None

    tool_name = getattr(tool_obj, "tool_name", None)
    tool_output = _safe_json_like(getattr(tool_obj, "tool_output", None))
    tool_args = _safe_json_like(getattr(tool_obj, "tool_args", None))

    payload: Dict[str, Any] = {}
    if tool_name:
        payload["tool_name"] = tool_name
    if tool_args is not None:
        payload["tool_args"] = tool_args
    if tool_output is not None:
        payload["tool_output"] = tool_output

    return payload or None


def build_sandbox_workspace_context(session_data: Dict[str, Any]) -> str:
    """
    Build a concise workspace file-tree context from the latest known sandbox.
    This reduces repetitive ls/find calls in coding turns.
    """
    try:
        if not config.SANDBOX_API_URL:
            return ""
        sandbox_ids = session_data.get("sandbox_ids", []) or []
        if not sandbox_ids:
            return ""

        sandbox_id = str(sandbox_ids[-1]).strip()
        if not sandbox_id:
            return ""

        workspace_root = "/home/sandboxuser/workspace"
        response = requests.get(
            f"{config.SANDBOX_API_URL}/sessions/{sandbox_id}/files",
            params={"path": workspace_root},
            timeout=12
        )
        if response.status_code != 200:
            return ""

        files = (response.json() or {}).get("files", []) or []
        if not files:
            return f"SANDBOX WORKSPACE CONTEXT\nsandbox_id: {sandbox_id}\nroot: {workspace_root}\nfiles: (empty)\n"

        files = sorted(files, key=lambda f: str(f.get("path", "")))
        max_files = 120
        shown = files[:max_files]
        lines = [
            "SANDBOX WORKSPACE CONTEXT",
            f"sandbox_id: {sandbox_id}",
            f"root: {workspace_root}",
            f"total_files: {len(files)}",
            f"showing_files: {len(shown)}",
        ]
        for item in shown:
            abs_path = str(item.get("path", ""))
            rel_path = abs_path[len(workspace_root) + 1:] if abs_path.startswith(workspace_root + "/") else abs_path
            size = int(item.get("size", 0))
            lines.append(f"- {rel_path} ({size} bytes)")

        if len(files) > max_files:
            lines.append(f"... {len(files) - max_files} more files omitted")

        return "\n".join(lines) + "\n"
    except Exception as exc:
        logger.debug("Unable to build sandbox workspace context: %s", exc)
        return ""


def _to_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _extract_metrics_from_run_output(run_output: TeamRunOutput | None) -> Dict[str, int]:
    if not run_output:
        logger.info("[TOKENS] Source run_output unavailable: run_output is None")
        return {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

    metrics = getattr(run_output, "metrics", None)
    if not metrics:
        logger.info("[TOKENS] Source run_output unavailable: run_output.metrics missing")
        return {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

    if isinstance(metrics, dict):
        input_tokens = _to_int(metrics.get("input_tokens"))
        output_tokens = _to_int(metrics.get("output_tokens"))
        total_tokens = _to_int(metrics.get("total_tokens"))
    else:
        input_tokens = _to_int(getattr(metrics, "input_tokens", 0))
        output_tokens = _to_int(getattr(metrics, "output_tokens", 0))
        total_tokens = _to_int(getattr(metrics, "total_tokens", 0))

    if total_tokens <= 0:
        total_tokens = input_tokens + output_tokens

    logger.info(
        "[TOKENS] Source run_output selected: input=%s output=%s total=%s",
        input_tokens,
        output_tokens,
        total_tokens,
    )
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
    }


def _extract_metrics_from_agno_session(conversation_id: str) -> Dict[str, int]:
    try:
        response = (
            supabase_client
            .from_("agno_sessions")
            .select("session_data,runs")
            .eq("session_id", conversation_id)
            .single()
            .execute()
        )
        row = response.data or {}
    except Exception as e:
        logger.warning(f"Token logging fallback query failed for session {conversation_id}: {e}")
        return {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

    # Prefer per-run metrics (delta for latest run). Session metrics can be cumulative.
    # We aggregate latest top-level run + all child member runs for this turn.
    input_tokens = 0
    output_tokens = 0
    total_tokens = 0

    runs = row.get("runs") or []
    if isinstance(runs, str):
        try:
            runs = json.loads(runs)
        except Exception:
            runs = []
    if isinstance(runs, list) and runs:
        # Choose latest top-level run for the current turn.
        top_level_runs = [r for r in runs if not (r or {}).get("parent_run_id")]
        if top_level_runs:
            root_run = max(top_level_runs, key=lambda r: _to_int((r or {}).get("created_at")))
        else:
            root_run = max(runs, key=lambda r: _to_int((r or {}).get("created_at")))

        root_run_id = (root_run or {}).get("run_id")
        if root_run_id:
            children_by_parent: Dict[str, List[Dict[str, Any]]] = {}
            for run in runs:
                parent = (run or {}).get("parent_run_id")
                if parent:
                    children_by_parent.setdefault(parent, []).append(run)

            aggregated_runs: List[Dict[str, Any]] = []
            stack = [root_run]
            seen_run_ids = set()
            while stack:
                current = stack.pop()
                current_id = (current or {}).get("run_id")
                if not current_id or current_id in seen_run_ids:
                    continue
                seen_run_ids.add(current_id)
                aggregated_runs.append(current)
                stack.extend(children_by_parent.get(current_id, []))

            for run in aggregated_runs:
                run_metrics = (run or {}).get("metrics") or {}
                input_tokens += _to_int(run_metrics.get("input_tokens"))
                output_tokens += _to_int(run_metrics.get("output_tokens"))
                total_tokens += _to_int(run_metrics.get("total_tokens"))

            logger.info(
                "[TOKENS] Fallback aggregated run tree for %s: root_run_id=%s run_count=%s input=%s output=%s total=%s",
                conversation_id,
                root_run_id,
                len(aggregated_runs),
                input_tokens,
                output_tokens,
                total_tokens,
            )
        else:
            latest_run_metrics = (runs[-1] or {}).get("metrics") or {}
            input_tokens = _to_int(latest_run_metrics.get("input_tokens"))
            output_tokens = _to_int(latest_run_metrics.get("output_tokens"))
            total_tokens = _to_int(latest_run_metrics.get("total_tokens"))
            logger.info(
                "[TOKENS] Fallback latest agno run metrics for %s: input=%s output=%s total=%s",
                conversation_id,
                input_tokens,
                output_tokens,
                total_tokens,
            )

    if input_tokens <= 0 and output_tokens <= 0:
        session_data = row.get("session_data") or {}
        if isinstance(session_data, str):
            try:
                session_data = json.loads(session_data)
            except Exception:
                session_data = {}
        session_metrics = (session_data.get("session_metrics") or {}) if isinstance(session_data, dict) else {}
        input_tokens = _to_int(session_metrics.get("input_tokens"))
        output_tokens = _to_int(session_metrics.get("output_tokens"))
        total_tokens = _to_int(session_metrics.get("total_tokens"))
        logger.info(
            "[TOKENS] Fallback session_metrics for %s (can be cumulative): input=%s output=%s total=%s",
            conversation_id,
            input_tokens,
            output_tokens,
            total_tokens,
        )

    if total_tokens <= 0:
        total_tokens = input_tokens + output_tokens

    logger.info(
        "[TOKENS] Fallback selected for %s: input=%s output=%s total=%s",
        conversation_id,
        input_tokens,
        output_tokens,
        total_tokens,
    )
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
    }


def _log_request_tokens(
    user_id: str,
    conversation_id: str,
    message_id: str,
    run_output: TeamRunOutput | None,
) -> None:
    metrics = _extract_metrics_from_run_output(run_output)
    source = "run_output"
    if metrics["input_tokens"] <= 0 and metrics["output_tokens"] <= 0:
        metrics = _extract_metrics_from_agno_session(conversation_id)
        source = "agno_session_fallback"

    if metrics["input_tokens"] <= 0 and metrics["output_tokens"] <= 0:
        logger.info(
            f"Skipping token usage logging for session {conversation_id}: no token metrics found."
        )
        return

    logger.info(
        "[TOKENS] Final metrics for logging session %s from %s: input=%s output=%s total=%s",
        conversation_id,
        source,
        metrics["input_tokens"],
        metrics["output_tokens"],
        metrics["total_tokens"],
    )
    try:
        convex_service = get_convex_usage_service()
        usage_window = get_usage_window_descriptor(user_id=str(user_id), refresh_window=False)
        convex_result = convex_service.record_token_usage(
            user_id=str(user_id),
            conversation_id=str(conversation_id),
            message_id=str(message_id),
            metrics=metrics,
            usage_window=usage_window,
            source=f"agent_runner:{source}",
        )
        logger.info(
            "[TOKENS][CONVEX] Logged token usage event for user=%s conversation=%s message=%s window=%s result=%s",
            user_id,
            conversation_id,
            message_id,
            usage_window.get("window_key"),
            bool(convex_result),
        )
    except Exception as convex_error:
        logger.warning(
            "[TOKENS][CONVEX] Failed to log token usage for user=%s conversation=%s message=%s: %s",
            user_id,
            conversation_id,
            message_id,
            convex_error,
        )


def process_files(files_data: List[Dict[str, Any]]) -> Tuple[List[Image], List[Audio], List[Video], List[File]]:
    """
    Processes a list of file data from the frontend, downloading media from
    Supabase storage or encoding text content, and converting them into
    Agno media objects.
    """
    images, audio, videos, other_files = [], [], [], []
    if not files_data:
        return images, audio, videos, other_files

    for file_data in files_data:
        file_name = file_data.get('name', 'untitled')
        file_type = file_data.get('type', 'application/octet-stream')
        is_text_file = bool(file_data.get('isText'))
        inline_content = file_data.get('content')
        storage_path = str(file_data.get('path') or '').strip()

        # Text/code files are sent inline from the frontend and should be
        # preferred over storage-path processing.
        if is_text_file and inline_content is not None:
            logger.info(f"Processing text file content for: {file_name}")
            if isinstance(inline_content, bytes):
                inline_bytes = inline_content
            else:
                inline_bytes = str(inline_content).encode('utf-8')
            other_files.append(File(content=inline_bytes, name=file_name, mime_type=file_type))
            continue

        if storage_path:
            try:
                logger.info(f"Downloading file from Supabase storage: {storage_path}")
                file_bytes = supabase_client.storage.from_('media-uploads').download(storage_path)
                
                if file_type.startswith('image/'):
                    images.append(Image(content=file_bytes, name=file_name))
                elif file_type.startswith('audio/'):
                    audio.append(Audio(content=file_bytes, format=file_type.split('/')[-1], name=file_name))
                elif file_type.startswith('video/'):
                    videos.append(Video(content=file_bytes, name=file_name))
                else:
                    other_files.append(File(content=file_bytes, name=file_name, mime_type=file_type))
            except Exception as e:
                logger.error(f"Error downloading file {storage_path} from Supabase: {e}")
            continue

        if is_text_file:
            logger.warning("Text file %s had no inline content; skipping.", file_name)
        else:
            logger.warning("Attachment %s had neither valid path nor inline content; skipping.", file_name)

    return images, audio, videos, other_files


def run_agent_and_stream(
    sid: str,
    conversation_id: str,
    message_id: str,
    turn_data: dict,
    browser_tools_config: dict,
    context_session_ids: List[str],
    agent_mode: str,
    connection_manager: ConnectionManager,
    redis_client: Redis,
    run_state_manager: RunStateManager = None,  # NEW: optional, safe for assistant path
):
    """
    Orchestrates a full agent run, ensuring all real-time tools receive the
    necessary per-request dependencies for communication.

    Emits to the conversation room (conv:{conversation_id}) so any reconnected
    client with the same conversationId will receive the stream.
    """
    # Durable room name - survives SID changes
    room_name = f"conv:{conversation_id}"
    try:
        # --- DEBUG LOG ---
        print(f"[AGENT_RUNNER] START RUN: message_id={message_id}, sid={sid}, room={room_name}")
        logger.info(f"[AGENT_RUNNER] START RUN: message_id={message_id}, sid={sid}, room={room_name}")

        # 1. Retrieve Session and User Data
        session_data = connection_manager.get_session(conversation_id)
        if not session_data:
            raise Exception(f"Session data not found for conversation {conversation_id}")
        user_id = session_data['user_id']

        # --- Mark run as STARTED (we now have user_id) ---
        if run_state_manager:
            run_state_manager.start_run(conversation_id, message_id, user_id)

        # --- MODIFICATION START: Create a dedicated config for real-time tools ---
        # This new dictionary will contain ALL dependencies needed by any tool that
        # communicates directly with the frontend or uses Redis Pub/Sub.
        realtime_tool_config = {
            'socketio': socketio,
            'sid': sid,
            'message_id': message_id,
            'conversation_id': conversation_id,
            'redis_client': redis_client
        }
        # --- DEBUG LOG ---
        print(f"[AGENT_RUNNER] Created realtime_tool_config: { {k: type(v).__name__ for k, v in realtime_tool_config.items()} }")
        logger.info(f"[AGENT_RUNNER] Created realtime_tool_config with keys: {list(realtime_tool_config.keys())}")

        # 2. Initialize the Agent
        # --- MODIFICATION START: Pass session_id and message_id for persistence ---
        session_config = dict(session_data.get("config", {}))
        session_config.setdefault(
            "enable_composio_google_sheets",
            config.COMPOSIO_ENABLE_GOOGLE_SHEETS,
        )
        session_config.setdefault(
            "enable_composio_whatsapp",
            config.COMPOSIO_ENABLE_WHATSAPP,
        )

        # Backward compatibility for legacy frontend key.
        if "computer_control" in session_config:
            session_config.setdefault(
                "enable_computer_control",
                bool(session_config.get("computer_control")),
            )
            session_config.pop("computer_control", None)

        # Internal routing metadata should not be forwarded to get_llm_os kwargs.
        session_agent_mode = str(session_config.pop("agent_mode", "default")).strip().lower()
        session_coder_target = str(session_config.pop("coder_execution_target", "cloud")).strip().lower()
        if session_coder_target not in ("local", "cloud"):
            session_coder_target = "cloud"

        requested_mode = str(agent_mode or "").strip().lower()
        if requested_mode not in ("coder", "computer", "default"):
            requested_mode = session_agent_mode
        if requested_mode not in ("coder", "computer", "default"):
            requested_mode = "default"

        requested_coder_target = str(
            turn_data.get("coder_execution_target")
            or session_data.get("config", {}).get("coder_execution_target")
            or session_coder_target
            or "cloud"
        ).strip().lower()
        if requested_coder_target not in ("local", "cloud"):
            requested_coder_target = "cloud"

        if requested_mode == "coder":
            agent = get_coder_agent(
                user_id=user_id,
                session_info=session_data,
                browser_tools_config=realtime_tool_config,
                custom_tool_config=realtime_tool_config,
                session_id=conversation_id,
                message_id=message_id,
                use_memory=session_config.get("use_memory", False),
                debug_mode=True,
                enable_github=session_config.get("enable_github", True),
                coder_execution_target=requested_coder_target,
            )
        elif requested_mode == "computer":
            agent = get_computer_agent(
                user_id=user_id,
                session_info=session_data,
                browser_tools_config=realtime_tool_config,
                computer_tools_config=realtime_tool_config,
                session_id=conversation_id,
                message_id=message_id,
                use_memory=session_config.get("use_memory", False),
                debug_mode=True,
            )
        else:
            llm_os_config = _filter_kwargs_for_callable(
                get_llm_os,
                session_config,
                label="session_config keys",
            )
            agent = get_llm_os(
                user_id=user_id,
                session_info=session_data,
                browser_tools_config=realtime_tool_config,
                custom_tool_config=realtime_tool_config,
                session_id=conversation_id,  # NEW: For persistence
                message_id=message_id,  # NEW: For persistence
                **llm_os_config
            )
        # --- MODIFICATION END ---

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
                    # Fetch conversation runs
                    response = supabase_client.from_('agno_sessions').select('runs').eq('session_id', session_id).single().execute()
                    if response.data and response.data.get('runs'):
                        runs = response.data['runs']
                        top_level_runs = [run for run in runs if not run.get('parent_run_id')]
                        for run in top_level_runs:
                            user_input = run.get('input', {}).get('input_content', '')
                            assistant_output = run.get('content', '')
                            if user_input:
                                historical_context_str += f"User: {user_input}\nAssistant: {assistant_output}\n---\n"
                    
                    # Fetch file metadata from session_content
                    content_response = supabase_client.from_('session_content').select(
                        'content_type, reference_id, metadata'
                    ).eq('session_id', session_id).eq('user_id', user_id).execute()
                    
                    if content_response.data and len(content_response.data) > 0:
                        files_context = []
                        for item in content_response.data:
                            content_type = item.get('content_type', '')
                            metadata = item.get('metadata', {}) or {}
                            
                            if content_type == 'artifact':
                                filename = metadata.get('filename', 'Unknown file')
                                files_context.append(f"[Generated file: {filename}]")
                            elif content_type == 'upload':
                                filename = metadata.get('filename', 'Unknown file')
                                mime_type = metadata.get('mime_type', '')
                                files_context.append(f"[Attached file: {filename} ({mime_type})]")
                        
                        if files_context:
                            historical_context_str += f"Files in this conversation:\n{chr(10).join(files_context)}\n---\n"
                            
                except Exception as e:
                    logger.error(f"Failed to fetch or process context for session_id {session_id}: {e}")
            historical_context_str += "\n"
        
        sandbox_workspace_context = ""
        if session_data.get("config", {}).get("coding_assistant", False):
            sandbox_workspace_context = build_sandbox_workspace_context(session_data)

        contextual_prefix = ""
        if historical_context_str:
            contextual_prefix += historical_context_str
        if sandbox_workspace_context:
            contextual_prefix += f"{sandbox_workspace_context}\n"

        final_user_message = (
            f"{contextual_prefix}CURRENT QUESTION:\n{user_message}"
            if contextual_prefix else user_message
        )

        # 5. Run the Agent and Stream Results
        # --- DEBUG LOG ---
        print(f"[AGENT_RUNNER] Starting agent.run() for message_id={message_id}")
        logger.info(f"[AGENT_RUNNER] Starting agent.run() for message_id={message_id}")
        run_output: TeamRunOutput | None = None
        accumulated_content: list[str] = []
        accumulated_events: list[dict] = []
        accumulated_log_content: Dict[str, List[str]] = {}
        log_owner_order: List[str] = []
        final_owner_name = None
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
            if isinstance(chunk, TeamRunOutput):
                run_output = chunk
                metrics_preview = _extract_metrics_from_run_output(run_output)
                logger.info(
                    "[TOKENS] Captured TeamRunOutput for session %s: input=%s output=%s total=%s",
                    conversation_id,
                    metrics_preview["input_tokens"],
                    metrics_preview["output_tokens"],
                    metrics_preview["total_tokens"],
                )

            if not chunk or not hasattr(chunk, 'event'):
                continue

            owner_name = getattr(chunk, 'agent_name', None) or getattr(chunk, 'team_name', None)

            if chunk.event in (RunEvent.run_content.value, TeamRunEvent.run_content.value):
                is_final = (
                    owner_name in ("Aetheria_AI", "Aetheria_Coder", "Aetheria_Computer")
                    and not getattr(chunk, 'member_responses', [])
                )
                # Include reasoning_content if present
                reasoning_content = getattr(chunk, 'reasoning_content', None)
                # Accumulate main content for catch-up buffer
                if is_final and chunk.content:
                    accumulated_content.append(str(chunk.content))
                    final_owner_name = owner_name
                elif (not is_final) and chunk.content and owner_name:
                    if owner_name not in accumulated_log_content:
                        accumulated_log_content[owner_name] = []
                        log_owner_order.append(owner_name)
                    accumulated_log_content[owner_name].append(str(chunk.content))
                socketio.emit("response", {
                    "content": chunk.content,
                    "streaming": True,
                    "id": message_id,
                    "agent_name": owner_name,
                    "is_log": not is_final,
                    "reasoning_content": reasoning_content
                }, room=room_name)  # <-- ROOM, not SID
            elif chunk.event in (RunEvent.tool_call_started.value, TeamRunEvent.tool_call_started.value):
                tool_name = getattr(chunk.tool, 'tool_name', None)
                tool_payload = _serialize_tool_event(getattr(chunk, "tool", None))
                socketio.emit("agent_step", {
                    "type": "tool_start",
                    "name": tool_name,
                    "agent_name": owner_name,
                    "id": message_id,
                    "tool": tool_payload,
                }, room=room_name)
                accumulated_events.append({
                    "type": "agent_step",
                    "step_type": "tool_start",
                    "name": tool_name,
                    "agent_name": owner_name,
                    "tool": tool_payload,
                })
            elif chunk.event in (RunEvent.tool_call_completed.value, TeamRunEvent.tool_call_completed.value):
                tool_name = getattr(chunk.tool, 'tool_name', None)
                tool_payload = _serialize_tool_event(getattr(chunk, "tool", None))
                tool_output = tool_payload.get("tool_output") if isinstance(tool_payload, dict) else None
                tool_metadata = tool_output.get("metadata") if isinstance(tool_output, dict) else None
                logger.info(
                    "[ToolEvent] tool_end name=%s owner=%s has_tool_payload=%s has_tool_output=%s has_metadata=%s preview_type=%s",
                    tool_name,
                    owner_name,
                    bool(tool_payload),
                    bool(tool_output),
                    bool(tool_metadata),
                    (tool_metadata or {}).get("preview_type") if isinstance(tool_metadata, dict) else None,
                )
                socketio.emit("agent_step", {
                    "type": "tool_end",
                    "name": tool_name,
                    "agent_name": owner_name,
                    "id": message_id,
                    "tool": tool_payload,
                }, room=room_name)
                accumulated_events.append({
                    "type": "agent_step",
                    "step_type": "tool_end",
                    "name": tool_name,
                    "agent_name": owner_name,
                    "tool": tool_payload,
                })
            # Handle reasoning events
            elif chunk.event == TeamRunEvent.reasoning_step.value:
                reasoning_step = getattr(chunk, 'reasoning_step', None)
                if reasoning_step:
                    reasoning_text = str(reasoning_step)
                    socketio.emit("reasoning_step", {
                        "id": message_id,
                        "agent_name": owner_name,
                        "step": reasoning_text
                    }, room=room_name)
                    accumulated_events.append({
                        "type": "reasoning_step",
                        "agent_name": owner_name,
                        "step": reasoning_text,
                    })

        # 6. Finalize the Stream and Log Metrics
        socketio.emit("response", {"done": True, "id": message_id}, room=room_name)

        # --- Mark run as COMPLETED and store result for catch-up ---
        final_content = "".join(accumulated_content) if accumulated_content else None
        for owner_name in log_owner_order:
            log_content = "".join(accumulated_log_content.get(owner_name, []))
            if log_content:
                accumulated_events.append({
                    "type": "response",
                    "content": log_content,
                    "agent_name": owner_name,
                    "is_log": True,
                })
        if final_content:
            accumulated_events.append({
                "type": "response",
                "content": final_content,
                "agent_name": final_owner_name or "Aetheria_AI",
                "is_log": False,
            })
        if run_state_manager:
            # Fetch session title for notification
            conversation_title = None
            try:
                title_resp = supabase_client.from_("session_titles").select("tittle").eq("session_id", conversation_id).maybe_single().execute()
                if title_resp and title_resp.data:
                    conversation_title = title_resp.data.get("tittle")
            except Exception:
                pass
            run_state_manager.complete_run(
                conversation_id,
                message_id,
                final_content=final_content,
                events=accumulated_events,
                conversation_title=conversation_title,
            )
            # Broadcast completion notification to the conversation room
            # so the client can show a local notification if in background
            socketio.emit("run_completed", {
                "conversationId": conversation_id,
                "messageId": message_id,
                "title": conversation_title,
            }, room=room_name)

        try:
            _log_request_tokens(
                user_id=user_id,
                conversation_id=conversation_id,
                message_id=message_id,
                run_output=run_output,
            )
        except Exception as e:
            logger.error(f"Failed to write token usage logs for session {conversation_id}: {e}")

    except Exception as e:
        logger.error(f"Agent run failed for conversation {conversation_id}: {e}\n{traceback.format_exc()}")
        if run_state_manager:
            run_state_manager.fail_run(conversation_id, message_id, str(e))
        socketio.emit("error", {"message": f"An error occurred: {str(e)}. Your conversation is preserved."}, room=room_name)
