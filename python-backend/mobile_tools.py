import json
import logging
import uuid
from typing import Any, Dict, Optional
import time

from redis import Redis
from agno.tools import Toolkit


logger = logging.getLogger(__name__)


class MobileTools(Toolkit):
    """
    Realtime mobile-device control toolkit.
    Commands are executed on the connected Android assistant client over Socket.IO.
    """

    COMMAND_TIMEOUT_SECONDS = 45

    def __init__(self, sid: str, socketio, redis_client: Redis, **kwargs):
        self.sid = sid
        self.socketio = socketio
        self.redis_client = redis_client
        self.message_id = kwargs.pop("message_id", None)
        self.conversation_id = kwargs.pop("conversation_id", None)

        super().__init__(
            name="mobile_tools",
            tools=[
                self.get_active_app,
                self.get_visible_ui_tree,
                self.get_device_state,
                self.list_installed_apps,
                self.launch_app,
                self.navigate,
                self.open_setting,
                self.set_volume,
                self.set_brightness,
                self.set_flashlight,
            ],
        )

    def _send_command_and_wait(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self.redis_client:
            return {"status": "error", "error": "Redis client is not available for mobile tools."}
        if not self.socketio or not self.sid:
            return {"status": "error", "error": "Realtime mobile client is not connected."}

        request_id = str(uuid.uuid4())
        payload["request_id"] = request_id
        if self.message_id:
            payload["message_id"] = self.message_id
        if self.conversation_id:
            payload["conversation_id"] = self.conversation_id

        response_channel = f"mobile-response:{request_id}"
        pubsub = self.redis_client.pubsub()
        try:
            pubsub.subscribe(response_channel)
            self.socketio.emit("mobile-command", payload, room=self.sid)
            logger.info(
                "[MobileTools] Sent command action=%s sid=%s request_id=%s",
                payload.get("action"),
                self.sid,
                request_id,
            )

            deadline = time.time() + self.COMMAND_TIMEOUT_SECONDS
            while time.time() < deadline:
                message = pubsub.get_message(timeout=1.0)
                if not message or message.get("type") != "message":
                    continue

                raw = message.get("data")
                if raw is None:
                    continue
                try:
                    return json.loads(raw)
                except Exception:
                    return {"status": "error", "error": "Invalid mobile tool response payload.", "raw": str(raw)}

            return {
                "status": "error",
                "error": f"Mobile command timeout after {self.COMMAND_TIMEOUT_SECONDS}s.",
                "action": payload.get("action"),
            }
        except Exception as exc:
            logger.error("[MobileTools] Command failed: %s", exc, exc_info=True)
            return {"status": "error", "error": f"Mobile command failed: {exc}"}
        finally:
            try:
                pubsub.unsubscribe(response_channel)
                pubsub.close()
            except Exception:
                pass

    @staticmethod
    def _confirmation(action: str, description: str) -> Dict[str, Any]:
        return {
            "requires_confirmation": True,
            "tool_name": action,
            "confirmation_description": description,
        }

    # --------------------- Read-only tools (no confirmation) ---------------------

    def get_active_app(self) -> Dict[str, Any]:
        """Get the foreground app/package currently visible on device."""
        return self._send_command_and_wait({"action": "get_active_app"})

    def get_visible_ui_tree(self, limit: int = 40) -> Dict[str, Any]:
        """Get a compact snapshot of visible UI text/elements from accessibility tree."""
        return self._send_command_and_wait({
            "action": "get_visible_ui_tree",
            "limit": max(1, min(int(limit or 40), 200)),
        })

    def get_device_state(self) -> Dict[str, Any]:
        """Get battery, volume, brightness, and connectivity basics."""
        return self._send_command_and_wait({"action": "get_device_state"})

    def list_installed_apps(self, query: Optional[str] = None, limit: int = 30) -> Dict[str, Any]:
        """List installed launchable apps. Optionally filter by query."""
        return self._send_command_and_wait({
            "action": "list_installed_apps",
            "query": (query or "").strip(),
            "limit": max(1, min(int(limit or 30), 200)),
        })

    # --------------------- Mutating tools (confirmation required) ---------------------

    def launch_app(self, app: str) -> Dict[str, Any]:
        """Launch app by package name or app label (requires user confirmation)."""
        payload = {
            "action": "launch_app",
            "app": (app or "").strip(),
            **self._confirmation("launch_app", f"Open app: {app}"),
        }
        return self._send_command_and_wait(payload)

    def navigate(self, action: str) -> Dict[str, Any]:
        """
        Perform system navigation action (back/home/recents).
        Requires user confirmation.
        """
        normalized = (action or "").strip().lower()
        payload = {
            "action": "navigate",
            "navigation_action": normalized,
            **self._confirmation("navigate", f"Perform navigation action: {normalized}"),
        }
        return self._send_command_and_wait(payload)

    def open_setting(self, setting: str) -> Dict[str, Any]:
        """Open a settings page (wifi/bluetooth/display/sound/general). Requires confirmation."""
        normalized = (setting or "").strip().lower()
        payload = {
            "action": "open_setting",
            "setting": normalized,
            **self._confirmation("open_setting", f"Open settings page: {normalized}"),
        }
        return self._send_command_and_wait(payload)

    def set_volume(self, level: int) -> Dict[str, Any]:
        """Set media volume 0-100 (requires confirmation)."""
        bounded = max(0, min(int(level), 100))
        payload = {
            "action": "set_volume",
            "level": bounded,
            **self._confirmation("set_volume", f"Change media volume to {bounded}%"),
        }
        return self._send_command_and_wait(payload)

    def set_brightness(self, level: int) -> Dict[str, Any]:
        """Set screen brightness 0-100 (requires confirmation)."""
        bounded = max(0, min(int(level), 100))
        payload = {
            "action": "set_brightness",
            "level": bounded,
            **self._confirmation("set_brightness", f"Change screen brightness to {bounded}%"),
        }
        return self._send_command_and_wait(payload)

    def set_flashlight(self, enabled: bool) -> Dict[str, Any]:
        """Turn flashlight on/off (requires confirmation)."""
        desired = bool(enabled)
        payload = {
            "action": "set_flashlight",
            "enabled": desired,
            **self._confirmation("set_flashlight", f"Turn flashlight {'on' if desired else 'off'}"),
        }
        return self._send_command_and_wait(payload)
