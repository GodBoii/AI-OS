# python-backend/user_context_tools.py
"""
User Context Management Tools for Aetheria AI
Stores user personal information and preferences in agno_memories table
"""

import logging
import json
import uuid
import time
from typing import Optional, Dict, Any
from agno.tools import Toolkit
from local_memories import MemoryRepository

logger = logging.getLogger(__name__)


class UserContextTools(Toolkit):
    """Tools for managing user context and personal information in memories"""
    
    def __init__(self, user_id: str, team_id: str = "aetheria-ai"):
        super().__init__(name="user_context_tools")
        self.user_id = user_id
        self.team_id = team_id
        self.register(self.save_user_context)
        self.register(self.get_user_context)
        self.register(self.update_user_context)
    
    def save_user_context(self, context_data: Dict[str, Any]) -> str:
        """
        Save or update user context information in agno_memories.
        
        Args:
            context_data: Dictionary containing user context with keys:
                - personal: {name, email, location, timezone, language}
                - preferences: {workingHours, communicationPreference, notificationPreference, taskPrioritization}
                - capabilities: {allowedActions, restrictedDomains, apiKeys, tools}
                - goals: {shortTerm, longTerm, constraints}
                - systemAccess: {filesystemAccess, networkAccess, apiAccess, credentials}
        
        Returns:
            Success or error message
        """
        try:
            if not isinstance(context_data, dict):
                return "Context must be a JSON object."
            repository = MemoryRepository()
            existing = self._context_entry()
            # Persist the structured context so individual fields can be edited.
            content = json.dumps(context_data, ensure_ascii=False)
            row = {"memory": content, "input": "User context", "updated_at": int(time.time()),
                "topics": ["user_context", "personal_info", "preferences"]}
            if existing:
                repository.update(existing["memory_id"], self.user_id, row)
            else:
                repository.create({**row, "memory_id": str(uuid.uuid4()), "team_id": self.team_id,
                    "user_id": self.user_id})
            return "User context saved."
        except Exception:
            logger.exception("Could not save user context for %s", self.user_id)
            return "Could not save user context."

    def _context_entry(self) -> dict | None:
        return next((row for row in MemoryRepository().list(self.user_id, team_id=self.team_id)
            if "user_context" in (row.get("topics") or [])), None)

    def get_user_context(self) -> str:
        """Return the current user's saved personal information and preferences."""
        entry = self._context_entry()
        return entry["memory"] if entry else "No saved user context."

    def update_user_context(self, field: str, value: Any) -> str:
        """Update a field such as personal.name in this user's saved context."""
        entry = self._context_entry()
        if not entry:
            return "Save user context first."
        if not field or len(field)>200:
            return "Invalid context field."
        data = json.loads(entry["memory"])
        target = data
        parts = field.split('.')
        for part in parts[:-1]:
            target = target.setdefault(part, {})
            if not isinstance(target, dict):
                return "This context field is not an object."
        target[parts[-1]] = value
        return self.save_user_context(data)

    def _format_context_as_memory(self, context_data: Dict[str, Any]) -> str:
        """Format context data as a readable memory string"""
        memory_lines = ["User Context:"]
        
        # Personal Information
        personal = context_data.get("personal", {})
        if any(personal.values()):
            memory_lines.append("\nPersonal Information:")
            if personal.get("name"):
                memory_lines.append(f"  • Name: {personal['name']}")
            if personal.get("email"):
                memory_lines.append(f"  • Email: {personal['email']}")
            if personal.get("location"):
                memory_lines.append(f"  • Location: {personal['location']}")
            if personal.get("timezone"):
                memory_lines.append(f"  • Timezone: {personal['timezone']}")
            if personal.get("language"):
                memory_lines.append(f"  • Language: {personal['language']}")
        
        # Preferences
        preferences = context_data.get("preferences", {})
        if any(preferences.values()):
            memory_lines.append("\nPreferences:")
            if preferences.get("workingHours"):
                memory_lines.append(f"  • Working Hours: {preferences['workingHours']}")
            if preferences.get("communicationPreference"):
                memory_lines.append(f"  • Communication: {preferences['communicationPreference']}")
            if preferences.get("notificationPreference"):
                memory_lines.append(f"  • Notifications: {preferences['notificationPreference']}")
            if preferences.get("taskPrioritization"):
                memory_lines.append(f"  • Task Prioritization: {preferences['taskPrioritization']}")
        
        # Goals
        goals = context_data.get("goals", {})
        if any(goals.values()):
            memory_lines.append("\nGoals:")
            if goals.get("shortTerm"):
                memory_lines.append(f"  • Short-term: {', '.join(goals['shortTerm'])}")
            if goals.get("longTerm"):
                memory_lines.append(f"  • Long-term: {', '.join(goals['longTerm'])}")
            if goals.get("constraints"):
                memory_lines.append(f"  • Constraints: {', '.join(goals['constraints'])}")
        
        # Capabilities
        capabilities = context_data.get("capabilities", {})
        if any(capabilities.values()):
            memory_lines.append("\nCapabilities:")
            if capabilities.get("allowedActions"):
                memory_lines.append(f"  • Allowed Actions: {', '.join(capabilities['allowedActions'])}")
            if capabilities.get("tools"):
                memory_lines.append(f"  • Tools: {', '.join(capabilities['tools'])}")
        
        return "\n".join(memory_lines)
    
    def _parse_memory_to_context(self, memory_content: str) -> Dict[str, Any]:
        """Parse memory string back to context dictionary (simplified)"""
        # This is a simplified parser - in production, you might want to store JSON in metadata
        context = {
            "personal": {},
            "preferences": {},
            "capabilities": {},
            "goals": {},
            "systemAccess": {}
        }
        
        # For now, return empty structure - the actual parsing would be more complex
        # In practice, you might want to store the full JSON in a metadata field
        return context
