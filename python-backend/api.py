# python-backend/api.py

import logging
import uuid
import requests
from typing import Any, Optional
from urllib.parse import urlparse
from flask import Blueprint, request, jsonify

# Import the utility function from the factory (or a future utils module)
from utils import get_user_from_token
from supabase_client import supabase_client
import config
from composio_client import ComposioApiError, ComposioClient
from deploy_platform import (
    activate_deployment,
    assign_subdomain,
    create_or_get_site,
    ensure_deploy_tables,
    get_site_runtime_db_credentials,
    get_site_db_credentials,
    list_deployed_projects,
    list_user_databases,
    preflight_check,
    provision_turso_database,
    resolve_public_site_hostname,
    resolve_site_ref,
    upload_site_files,
    upsert_site_manifest,
)

logger = logging.getLogger(__name__)

# Create a Blueprint for API routes, with a URL prefix of /api
api_bp = Blueprint('api_bp', __name__, url_prefix='/api')


def _resolve_auth_config_id(toolkit_slug: str, request_auth_config_id: str | None) -> str | None:
    if request_auth_config_id:
        return request_auth_config_id

    normalized = (toolkit_slug or "").upper()
    if normalized == "GOOGLESHEETS":
        return config.COMPOSIO_GOOGLESHEETS_AUTH_CONFIG_ID
    if normalized == "WHATSAPP":
        return config.COMPOSIO_WHATSAPP_AUTH_CONFIG_ID
    return None


def _extract_host_from_header(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        parsed = urlparse(value)
    except Exception:
        return None
    host = (parsed.netloc or "").strip().lower()
    if not host:
        return None
    if ":" in host:
        host = host.split(":", 1)[0]
    return host or None


def _to_hrana_value(value: Any) -> dict[str, Any]:
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "integer", "value": "1" if value else "0"}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    if isinstance(value, float):
        return {"type": "float", "value": value}
    if isinstance(value, (dict, list)):
        import json
        return {"type": "text", "value": json.dumps(value, ensure_ascii=True)}
    return {"type": "text", "value": str(value)}


def _execute_hrana_query(hostname: str, token: str, sql: str, params: Optional[list[Any]] = None) -> dict[str, Any]:
    args = [_to_hrana_value(v) for v in (params or [])]
    payload = {
        "requests": [
            {
                "type": "execute",
                "stmt": {
                    "sql": sql,
                    "args": args,
                    "want_rows": True,
                },
            }
        ]
    }
    response = requests.post(
        f"https://{hostname}/v2/pipeline",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    if response.status_code not in (200, 201):
        raise RuntimeError(f"Query failed: HTTP {response.status_code} {response.text}")

    data = response.json() or {}
    results = data.get("results") or []
    if not results:
        return {"raw": data}
    result = results[0] or {}
    if "error" in result:
        raise RuntimeError(f"Query failed: {result['error']}")
    return result.get("response", result)


def _normalize_single_statement(sql: str) -> str:
    cleaned = (sql or "").strip()
    if not cleaned:
        raise ValueError("sql is required")
    cleaned = cleaned.rstrip(";").strip()
    if ";" in cleaned:
        raise ValueError("Only a single SQL statement is allowed per request")
    return cleaned


@api_bp.route('/integrations', methods=['GET'])
def get_integrations_status():
    """
    Fetches the list of connected third-party services for the authenticated user.
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]
    
    response = supabase_client.from_('user_integrations').select('service').eq('user_id', str(user.id)).execute()
    
    return jsonify({"integrations": [item['service'] for item in response.data]})


@api_bp.route('/integrations/disconnect', methods=['POST'])
def disconnect_integration():
    """
    Removes an integration record for the authenticated user and a given service.
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]
    
    service = request.json.get('service')
    if not service:
        return jsonify({"error": "Service not provided"}), 400
        
    supabase_client.from_('user_integrations').delete().match({'user_id': str(user.id), 'service': service}).execute()
    
    return jsonify({"message": "Disconnected"}), 200


@api_bp.route('/composio/status', methods=['GET'])
def composio_status():
    """
    Returns Composio connection status for the authenticated user and toolkit.
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    toolkit = request.args.get('toolkit', 'GOOGLESHEETS').upper()
    try:
        client = ComposioClient()
        accounts = client.list_connected_accounts(user_id=str(user.id), toolkit_slug=toolkit)
        connected = any(str(a.get("status", "")).upper() == "ACTIVE" for a in accounts)
        active_account = next((a for a in accounts if str(a.get("status", "")).upper() == "ACTIVE"), None)
        return jsonify({
            "toolkit": toolkit,
            "connected": connected,
            "active_connected_account_id": active_account.get("id") if active_account else None,
            "accounts": [
                {
                    "id": a.get("id"),
                    "status": a.get("status"),
                    "toolkit_slug": ((a.get("toolkit") or {}).get("slug") if isinstance(a.get("toolkit"), dict) else None),
                }
                for a in accounts
            ],
        }), 200
    except ComposioApiError as exc:
        return jsonify({"error": str(exc)}), 502
    except Exception as exc:
        logger.error("Unexpected Composio status error: %s", exc, exc_info=True)
        return jsonify({"error": "Failed to get Composio status"}), 500


@api_bp.route('/composio/disconnect', methods=['POST'])
def composio_disconnect():
    """
    Disconnects Composio connected account(s) for a toolkit.
    If connected_account_id is provided, disconnects only that account.
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    body = request.json or {}
    toolkit = (body.get('toolkit') or 'GOOGLESHEETS').upper()
    connected_account_id = body.get('connected_account_id')

    try:
        client = ComposioClient()
        deleted_ids = []

        if connected_account_id:
            client.delete_connected_account(connected_account_id)
            deleted_ids.append(connected_account_id)
        else:
            accounts = client.list_connected_accounts(user_id=str(user.id), toolkit_slug=toolkit)
            for account in accounts:
                account_id = account.get("id")
                if account_id:
                    client.delete_connected_account(account_id)
                    deleted_ids.append(account_id)

        return jsonify({
            "toolkit": toolkit,
            "disconnected_count": len(deleted_ids),
            "disconnected_connected_account_ids": deleted_ids,
        }), 200
    except ComposioApiError as exc:
        return jsonify({"error": str(exc)}), 502
    except Exception as exc:
        logger.error("Unexpected Composio disconnect error: %s", exc, exc_info=True)
        return jsonify({"error": "Failed to disconnect Composio account"}), 500


@api_bp.route('/composio/connect-url', methods=['GET', 'POST'])
def composio_connect_url():
    """
    Generates a Composio connected-account link for the authenticated user.
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    body = request.json if request.method == 'POST' and request.is_json else {}
    toolkit = (request.args.get('toolkit') or (body or {}).get('toolkit') or 'GOOGLESHEETS').upper()
    callback_url = request.args.get('callback_url') or (body or {}).get('callback_url') or config.FRONTEND_URL
    request_auth_config_id = request.args.get('auth_config_id') or (body or {}).get('auth_config_id')
    auth_config_id = _resolve_auth_config_id(toolkit, request_auth_config_id)
    if not auth_config_id:
        return jsonify({
            "error": (
                f"Auth config id is required for toolkit '{toolkit}'. "
                f"Set COMPOSIO_{toolkit}_AUTH_CONFIG_ID in backend env or provide auth_config_id."
            )
        }), 400

    try:
        client = ComposioClient()
        result = client.create_connected_account_link(
            user_id=str(user.id),
            auth_config_id=auth_config_id,
            callback_url=callback_url,
        )
        redirect_url = (
            result.get("redirect_url")
            or result.get("redirectUrl")
            or result.get("url")
            or result.get("link")
        )
        return jsonify({
            "toolkit": toolkit,
            "auth_config_id": auth_config_id,
            "callback_url": callback_url,
            "redirect_url": redirect_url,
            "raw": result,
        }), 200
    except ComposioApiError as exc:
        return jsonify({"error": str(exc)}), 502
    except Exception as exc:
        logger.error("Unexpected Composio connect-url error: %s", exc, exc_info=True)
        return jsonify({"error": "Failed to generate Composio connect url"}), 500


@api_bp.route('/composio/tools', methods=['GET'])
def composio_tools():
    """
    Lists available Composio tools for a toolkit.
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    _ = user  # authenticated endpoint; user is currently not needed for listing
    toolkit = request.args.get('toolkit', 'GOOGLESHEETS').upper()
    important_only = request.args.get('important', 'true').lower() == 'true'

    try:
        client = ComposioClient()
        tools = client.list_tools(toolkit_slug=toolkit, important_only=important_only)
        return jsonify({"toolkit": toolkit, "count": len(tools), "tools": tools}), 200
    except ComposioApiError as exc:
        return jsonify({"error": str(exc)}), 502
    except Exception as exc:
        logger.error("Unexpected Composio tools error: %s", exc, exc_info=True)
        return jsonify({"error": "Failed to list Composio tools"}), 500


@api_bp.route('/generate-upload-url', methods=['POST'])
def generate_upload_url():
    """
    Generates a pre-signed URL for securely uploading a file to Supabase storage.
    The file is placed in a user-specific folder.
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]
        
    file_name = request.json.get('fileName')
    if not file_name:
        return jsonify({"error": "fileName is required"}), 400
        
    # Create a unique path for the file to prevent collisions
    file_path = f"{user.id}/{uuid.uuid4()}/{file_name}"
    
    upload_details = supabase_client.storage.from_('media-uploads').create_signed_upload_url(file_path)
    
    return jsonify({"signedURL": upload_details['signed_url'], "path": upload_details['path']}), 200


@api_bp.route('/assistant/upload-link', methods=['POST'])
def assistant_upload_link():
    """
    Generate a signed upload URL for Circle to Search images.
    Stateless - no authentication required for assistant features.
    """
    try:
        data = request.json or {}
        file_extension = data.get('extension', 'jpg')
        
        # Generate unique filename in temporary assistant folder
        file_name = f"{uuid.uuid4()}.{file_extension}"
        file_path = f"assistant-temp/{file_name}"
        
        logger.info(f"📤 Generating upload link for: {file_path}")
        
        # Create signed upload URL (valid for 5 minutes)
        upload_details = supabase_client.storage.from_('media-uploads').create_signed_upload_url(file_path)
        
        # Generate public URL for viewing
        public_url = supabase_client.storage.from_('media-uploads').get_public_url(file_path)
        
        return jsonify({
            "uploadUrl": upload_details['signed_url'],
            "publicUrl": public_url,
            "path": file_path
        }), 200
        
    except Exception as e:
        logger.error(f"Error generating upload link: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route('/assistant/chat', methods=['POST'])
def assistant_chat():
    """
    Stateless voice assistant endpoint for Android.
    Supports text and multimodal (image) inputs.
    Simple, fast, no authentication or session tracking required.
    """
    import traceback
    from system_assistant import get_system_assistant
    from agno.media import Image

    try:
        logger.info("🎙️  Assistant Query")
        
        data = request.json or {}
        user_message = data.get('message', '')
        image_urls = data.get('images', [])  # Array of image URLs
        
        if not user_message:
            return jsonify({"error": "Message is required", "response": "I didn't catch that. Please try again."}), 400
        
        msg_preview = (user_message[:75] + '...') if len(user_message) > 75 else user_message
        
        if image_urls:
            logger.info(f"🖼️  Query with {len(image_urls)} image(s): {msg_preview}")
        else:
            logger.info(f"Query: {msg_preview}")

        # Get agent (stateless, no session)
        agent = get_system_assistant()
        
        # Execute with optional images
        try:
            # Prepare images with content (to avoid URL accessibility issues with Gemini)
            images = []
            if image_urls:
                for url in image_urls:
                    try:
                        # Check if this is a Supabase URL we generated (contains assistant-temp)
                        if "assistant-temp" in url:
                            # Extract path: find 'assistant-temp' and everything after
                            path_parts = url.split("assistant-temp")
                            if len(path_parts) > 1:
                                # Clean up path (remove queries etc if any, though usually clean)
                                relative_path = "assistant-temp" + path_parts[1].split('?')[0]
                                logger.info(f"Downloading internal image from Supabase: {relative_path}")
                                
                                # Download directly from Supabase storage
                                image_bytes = supabase_client.storage.from_('media-uploads').download(relative_path)
                                images.append(Image(content=image_bytes))
                                continue
                        
                        # Fallback: Download via HTTP (works for external URLs or public Supabase URLs)
                        logger.info(f"Downloading image from URL: {url}")
                        resp = requests.get(url, timeout=10)
                        if resp.status_code == 200:
                            images.append(Image(content=resp.content))
                        else:
                            logger.error(f"Failed to fetch image: {resp.status_code}")
                    except Exception as img_err:
                        logger.error(f"Error processing image {url}: {img_err}")
                
                logger.info(f"Prepared {len(images)} images for agent")
            
            # Run agent with image content
            result = agent.run(input=user_message, images=images, stream=False)
            
            # Extract response
            response_text = ""
            if hasattr(result, 'content') and result.content:
                response_text = result.content
            elif hasattr(result, 'messages') and result.messages:
                for msg in reversed(result.messages):
                    if hasattr(msg, 'role') and msg.role == 'assistant' and hasattr(msg, 'content'):
                        response_text = msg.content
                        break
            
            if not response_text:
                response_text = "I processed your request but couldn't generate a response. Please try again."
            
            logger.info(f"Response: {response_text[:75]}...")
            return jsonify({"response": response_text}), 200
                    
        except Exception as agent_error:
            logger.error(f"Agent error: {agent_error}")
            traceback.print_exc()
            return jsonify({"response": generate_fallback_response(user_message)}), 200
        
    except Exception as e:
        logger.error(f"Critical error: {e}")
        traceback.print_exc()
        return jsonify({
            "error": str(e),
            "response": "I'm having trouble connecting. Please try again in a moment."
        }), 500


def generate_fallback_response(query: str) -> str:
    """Generate smart fallback responses when AI is unavailable."""
    import datetime
    lower = query.lower()
    
    if any(word in lower for word in ['time', 'what time']):
        now = datetime.datetime.now()
        return f"It's {now.strftime('%I:%M %p')}"
    
    if any(word in lower for word in ['date', 'today', 'what day']):
        now = datetime.datetime.now()
        return f"Today is {now.strftime('%A, %B %d, %Y')}"
    
    if any(word in lower for word in ['hello', 'hi', 'hey']):
        return "Hello! I'm Aetheria, your AI assistant. How can I help you today?"
    
    if any(word in lower for word in ['who are you', 'what are you']):
        return "I'm Aetheria, an AI assistant designed to help you with various tasks and questions."
    
    if any(word in lower for word in ['thank']):
        return "You're welcome! Is there anything else I can help with?"
    
    if any(word in lower for word in ['bye', 'goodbye']):
        return "Goodbye! Have a great day!"
    
    return f"I heard: \"{query}\". The AI service is currently connecting. Please try again in a moment."


@api_bp.route('/healthz')
def health_check():
    """A simple health check endpoint for monitoring."""
    return "OK", 200


@api_bp.route('/health')
def health():
    """Detailed health check endpoint with memory stats."""
    try:
        import psutil
        import os
        
        process = psutil.Process(os.getpid())
        memory_info = process.memory_info()
        
        return jsonify({
            "status": "ok",
            "message": "Backend is running",
            "service": "aios-web",
            "memory": {
                "rss_mb": round(memory_info.rss / 1024 / 1024, 2),
                "vms_mb": round(memory_info.vms / 1024 / 1024, 2),
                "percent": round(process.memory_percent(), 2)
            },
            "cpu_percent": round(process.cpu_percent(interval=0.1), 2)
        }), 200
    except ImportError:
        # psutil not available, return basic health
        return jsonify({
            "status": "ok",
            "message": "Backend is running",
            "service": "aios-web"
        }), 200


@api_bp.route('/deploy/preflight', methods=['GET'])
def deploy_preflight():
    """
    Validate deploy platform prerequisites and initialize deploy tables.
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]
    _ = user

    try:
        ensure_deploy_tables()
        result = preflight_check()
        return jsonify(result), 200 if result.get("ok") else 503
    except Exception as e:
        logger.error(f"Deploy preflight error: {e}", exc_info=True)
        return jsonify({"ok": False, "error": str(e)}), 500


@api_bp.route('/deploy/projects', methods=['GET'])
def deploy_projects():
    """
    List deployed projects for authenticated user.
    Query params: limit (optional, default 20)
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    try:
        ensure_deploy_tables()
        limit = request.args.get("limit", default=20, type=int)
        projects = list_deployed_projects(user_id=str(user.id), limit=limit or 20)
        return jsonify({"ok": True, "projects": projects}), 200
    except Exception as e:
        logger.error(f"deploy/projects failed: {e}", exc_info=True)
        return jsonify({"error": "failed to load deployed projects"}), 500


@api_bp.route('/deploy/databases', methods=['GET'])
def deploy_databases():
    """
    List provisioned site databases for authenticated user.
    Query params: limit (optional, default 50)
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    try:
        ensure_deploy_tables()
        limit = request.args.get("limit", default=50, type=int)
        databases = list_user_databases(user_id=str(user.id), limit=limit or 50)
        return jsonify({"ok": True, "databases": databases}), 200
    except Exception as e:
        logger.error(f"deploy/databases failed: {e}", exc_info=True)
        return jsonify({"error": "failed to load database list"}), 500


@api_bp.route('/deploy/site/init', methods=['POST'])
def deploy_site_init():
    """
    Create (or return existing) site metadata record.
    body: { site_id, project_name, slug }
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    body = request.json or {}
    site_id = body.get("site_id")
    project_name = body.get("project_name", "Untitled")
    slug = body.get("slug")
    if not site_id or not slug:
        return jsonify({"error": "site_id and slug are required"}), 400

    try:
        ensure_deploy_tables()
        site = create_or_get_site(
            site_id=str(site_id),
            user_id=str(user.id),
            project_name=str(project_name),
            slug=str(slug),
        )
        return jsonify({"ok": True, "site": site}), 200
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"deploy/site/init failed: {e}", exc_info=True)
        return jsonify({"error": "failed to init site"}), 500


@api_bp.route('/deploy/assign-subdomain', methods=['POST'])
def deploy_assign_subdomain():
    """
    Assign and persist canonical hostname for a site.
    body: { site_id }
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    body = request.json or {}
    site_id = body.get("site_id")
    if not site_id:
        return jsonify({"error": "site_id is required"}), 400

    try:
        ensure_deploy_tables()
        result = assign_subdomain(site_id=str(site_id), user_id=str(user.id))
        return jsonify({"ok": True, **result}), 200
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"deploy/assign-subdomain failed: {e}", exc_info=True)
        return jsonify({"error": "failed to assign subdomain"}), 500


@api_bp.route('/deploy/upload-site', methods=['POST'])
def deploy_upload_site():
    """
    Upload built site files to R2.
    body: { site_id, files: [{path, content_base64?, content?, content_type?}] }
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    body = request.json or {}
    site_id = body.get("site_id")
    files = body.get("files", [])
    if not site_id:
        return jsonify({"error": "site_id is required"}), 400
    if not isinstance(files, list) or not files:
        return jsonify({"error": "files must be a non-empty array"}), 400

    try:
        ensure_deploy_tables()
        result = upload_site_files(site_id=str(site_id), user_id=str(user.id), files=files)
        return jsonify({
            "ok": True,
            "deployment_id": result.deployment_id,
            "version": result.version,
            "r2_prefix": result.r2_prefix,
            "files_uploaded": result.files_uploaded,
        }), 200
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"deploy/upload-site failed: {e}", exc_info=True)
        return jsonify({"error": f"failed to upload site files: {e}"}), 500


@api_bp.route('/deploy/provision-database', methods=['POST'])
def deploy_provision_database():
    """
    Create one Turso database per site and store encrypted credentials.
    body: { site_id }
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    body = request.json or {}
    site_id = body.get("site_id")
    if not site_id:
        return jsonify({"error": "site_id is required"}), 400

    try:
        ensure_deploy_tables()
        result = provision_turso_database(site_id=str(site_id), user_id=str(user.id))
        return jsonify({"ok": True, **result}), 200
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"deploy/provision-database failed: {e}", exc_info=True)
        return jsonify({"error": "failed to provision database"}), 500


@api_bp.route('/deploy/get-db-credentials', methods=['POST'])
def deploy_get_db_credentials():
    """
    Retrieve per-site credentials for internal deploy inject flow.
    body: { site_id, include_admin?: bool }
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    body = request.json or {}
    site_id = body.get("site_id")
    include_admin = bool(body.get("include_admin", False))
    if not site_id:
        return jsonify({"error": "site_id is required"}), 400

    try:
        ensure_deploy_tables()
        creds = get_site_db_credentials(site_id=str(site_id), user_id=str(user.id), include_admin=include_admin)
        return jsonify({"ok": True, "credentials": creds}), 200
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"deploy/get-db-credentials failed: {e}", exc_info=True)
        return jsonify({"error": "failed to get credentials"}), 500


@api_bp.route('/deploy/runtime/query', methods=['POST'])
def deploy_runtime_query():
    """
    Runtime database query endpoint for deployed websites.

    Modes:
    - Authenticated (Authorization bearer token): resolves site_id/site_ref under user ownership.
    - Anonymous (no auth): resolves site strictly from Origin/Referer hostname.

    body: { sql, params?: [], site_id?: str, site_ref?: str }
    """
    body = request.json or {}
    sql = body.get("sql")
    params = body.get("params", [])
    if not isinstance(params, list):
        return jsonify({"ok": False, "error": "params must be an array"}), 400

    try:
        cleaned_sql = _normalize_single_statement(str(sql or ""))
        ensure_deploy_tables()

        auth_header = (request.headers.get("Authorization") or "").strip()
        site_id = None
        site_hostname = None

        if auth_header.startswith("Bearer "):
            user, error = get_user_from_token(request)
            if error:
                return jsonify({"ok": False, "error": error[0]}), error[1]
            site_ref = body.get("site_id") or body.get("site_ref") or "default"
            site = resolve_site_ref(user_id=str(user.id), site_ref=str(site_ref))
            site_id = str(site["id"])
            site_hostname = site.get("hostname")
            creds = get_site_db_credentials(site_id=site_id, user_id=str(user.id), include_admin=False)
        else:
            origin_host = _extract_host_from_header(request.headers.get("Origin"))
            referer_host = _extract_host_from_header(request.headers.get("Referer"))
            host = origin_host or referer_host
            if not host:
                return jsonify({"ok": False, "error": "Origin or Referer header is required"}), 400

            site = resolve_public_site_hostname(hostname=host)
            site_id = str(site["id"])
            site_hostname = site.get("hostname")
            creds = get_site_runtime_db_credentials(site_id=site_id)

        result = _execute_hrana_query(
            hostname=creds["hostname"],
            token=creds["rw_token"],
            sql=cleaned_sql,
            params=params,
        )
        return jsonify(
            {
                "ok": True,
                "site_id": site_id,
                "hostname": site_hostname,
                "result": result,
            }
        ), 200
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except PermissionError as e:
        return jsonify({"ok": False, "error": str(e)}), 403
    except Exception as e:
        logger.error(f"deploy/runtime/query failed: {e}", exc_info=True)
        return jsonify({"ok": False, "error": "runtime database query failed"}), 500


@api_bp.route('/deploy/activate', methods=['POST'])
def deploy_activate():
    """
    Activate a deployment and write slug manifest used by Worker routing.
    body: { site_id, deployment_id }
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]

    body = request.json or {}
    site_id = body.get("site_id")
    deployment_id = body.get("deployment_id")
    if not site_id or not deployment_id:
        return jsonify({"error": "site_id and deployment_id are required"}), 400

    try:
        ensure_deploy_tables()
        manifest = upsert_site_manifest(site_id=str(site_id), user_id=str(user.id), deployment_id=str(deployment_id))
        result = activate_deployment(site_id=str(site_id), user_id=str(user.id), deployment_id=str(deployment_id))
        return jsonify({"ok": True, "manifest": manifest, **result}), 200
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"deploy/activate failed: {e}", exc_info=True)
        return jsonify({"error": "failed to activate deployment"}), 500
    except Exception as e:
        logger.error(f"Error in health check: {e}")
        return jsonify({
            "status": "ok",
            "message": "Backend is running",
            "service": "aios-web"
        }), 200


@api_bp.route('/sandbox/artifacts', methods=['GET'])
def get_session_artifacts():
    """
    Get all artifacts for a session.
    Query params: session_id (required)
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]
    
    session_id = request.args.get('session_id')
    if not session_id:
        return jsonify({"error": "session_id is required"}), 400
    
    try:
        from sandbox_persistence import get_persistence_service
        persistence_service = get_persistence_service()
        
        artifacts = persistence_service.list_session_artifacts(
            session_id=session_id,
            user_id=str(user.id)
        )
        
        return jsonify({"artifacts": artifacts}), 200
        
    except Exception as e:
        logger.error(f"Error fetching session artifacts: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route('/sandbox/artifacts/<artifact_id>', methods=['GET'])
def get_artifact_details(artifact_id):
    """
    Get details and download URL for a specific artifact.
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]
    
    try:
        from sandbox_persistence import get_persistence_service
        persistence_service = get_persistence_service()
        
        # Get artifact metadata
        result = supabase_client.table('sandbox_artifacts').select(
            '*'
        ).eq('artifact_id', artifact_id).eq('user_id', str(user.id)).single().execute()
        
        if not result.data:
            return jsonify({"error": "Artifact not found"}), 404
        
        artifact = result.data
        
        # Generate download URL
        download_url = persistence_service.get_artifact_download_url(
            artifact_id=artifact_id,
            user_id=str(user.id),
            expiry=3600  # 1 hour
        )
        
        if not download_url:
            return jsonify({"error": "Failed to generate download URL"}), 500
        
        artifact['download_url'] = download_url
        
        return jsonify({"artifact": artifact}), 200
        
    except Exception as e:
        logger.error(f"Error fetching artifact details: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route('/sandbox/artifacts/<artifact_id>', methods=['DELETE'])
def delete_artifact(artifact_id):
    """
    Delete an artifact.
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]
    
    try:
        from sandbox_persistence import get_persistence_service
        persistence_service = get_persistence_service()
        
        success = persistence_service.delete_artifact(
            artifact_id=artifact_id,
            user_id=str(user.id)
        )
        
        if success:
            return jsonify({"message": "Artifact deleted"}), 200
        else:
            return jsonify({"error": "Failed to delete artifact"}), 500
        
    except Exception as e:
        logger.error(f"Error deleting artifact: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route('/sandbox/executions/<execution_id>/artifacts', methods=['GET'])
def get_execution_artifacts(execution_id):
    """
    Get all artifacts created by a specific execution.
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]
    
    try:
        from sandbox_persistence import get_persistence_service
        persistence_service = get_persistence_service()
        
        artifacts = persistence_service.list_execution_artifacts(
            execution_id=execution_id,
            user_id=str(user.id)
        )
        
        return jsonify({"artifacts": artifacts}), 200
        
    except Exception as e:
        logger.error(f"Error fetching execution artifacts: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route('/sessions/<session_id>/content', methods=['GET'])
def get_session_content(session_id):
    """
    Get all content (artifacts, executions, uploads) for a conversation session.
    This enables viewing historical content when reopening old conversations.
    
    Returns content with fresh presigned URLs for downloads.
    """
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"error": error[0]}), error[1]
    
    try:
        from sandbox_persistence import get_persistence_service
        persistence_service = get_persistence_service()
        
        # Get all content for this session
        content_list = persistence_service.get_session_content(
            session_id=session_id,
            user_id=str(user.id)
        )
        
        # Enrich content with fresh presigned URLs
        enriched_content = []
        for item in content_list:
            content_type = item['content_type']
            reference_id = item['reference_id']
            
            # Add download URLs based on content type
            if content_type == 'artifact':
                # Generate fresh presigned URL for artifact
                download_url = persistence_service.get_artifact_download_url(
                    artifact_id=reference_id,
                    user_id=str(user.id),
                    expiry=3600
                )
                item['download_url'] = download_url
                
            elif content_type == 'execution':
                # Generate fresh presigned URLs for execution logs
                urls = persistence_service.get_execution_logs_urls(
                    execution_id=reference_id,
                    user_id=str(user.id),
                    expiry=3600
                )
                if urls:
                    item['stdout_url'] = urls.get('stdout_url')
                    item['stderr_url'] = urls.get('stderr_url')
            
            enriched_content.append(item)
        
        return jsonify({
            "session_id": session_id,
            "content": enriched_content,
            "count": len(enriched_content)
        }), 200
        
    except Exception as e:
        logger.error(f"Error fetching session content: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500
