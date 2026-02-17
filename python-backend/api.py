# python-backend/api.py

import logging
import uuid
import requests
from flask import Blueprint, request, jsonify

# Import the utility function from the factory (or a future utils module)
from utils import get_user_from_token
from supabase_client import supabase_client

logger = logging.getLogger(__name__)

# Create a Blueprint for API routes, with a URL prefix of /api
api_bp = Blueprint('api_bp', __name__, url_prefix='/api')


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
