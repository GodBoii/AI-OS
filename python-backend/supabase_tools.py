# python-backend/supabase_tools.py

import logging
import requests
from typing import Optional

from agno.tools import Toolkit
from supabase_client import supabase_client

logger = logging.getLogger(__name__)

class SupabaseTools(Toolkit):
    """
    A toolkit for interacting with the Supabase Management API on behalf of the user,
    allowing the agent to list organizations and projects.
    """

    def __init__(self, user_id: str):
        """Initializes the SupabaseTools toolkit."""
        super().__init__(
            name="supabase_tools",
            tools=[
                self.list_organizations,
                self.list_projects,
            ],
        )
        self.user_id = user_id
        self._access_token: Optional[str] = None
        self._token_fetched = False
        self.api_base_url = "https://api.supabase.com/v1"

    def _get_access_token(self) -> Optional[str]:
        """
        Retrieves the user's Supabase Management API access token from the database.
        The token is cached in memory for the duration of the agent's run.
        """
        if self._token_fetched:
            return self._access_token
        try:
            response = (
                supabase_client.from_("user_integrations")
                .select("access_token")
                .eq("user_id", self.user_id)
                .eq("service", "supabase")  # Query for the 'supabase' service
                .single()
                .execute()
            )
            if response.data and response.data.get("access_token"):
                self._access_token = response.data["access_token"]
            else:
                self._access_token = None
        except Exception as e:
            logger.error(f"Error fetching Supabase token for user {self.user_id}: {e}")
            self._access_token = None
        
        self._token_fetched = True
        return self._access_token

    def _make_request(self, method: str, endpoint: str) -> requests.Response:
        """
        A helper function to make authenticated requests to the Supabase Management API.
        It automatically includes the authorization header.

        Args:
            method: The HTTP method (e.g., 'GET').
            endpoint: The API endpoint path (e.g., 'organizations').

        Returns:
            The requests.Response object.
        
        Raises:
            Exception: If the Supabase account is not connected or the token is invalid.
            requests.HTTPError: If the API returns a 4xx or 5xx status code.
        """
        token = self._get_access_token()
        if not token:
            raise Exception("Supabase account not connected or token is invalid.")
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        
        url = f"{self.api_base_url}/{endpoint}"
        response = requests.request(method, url, headers=headers)
        response.raise_for_status()  # This will raise an HTTPError for bad responses
        return response

    def list_organizations(self) -> str:
        """
        Lists all organizations the connected Supabase user is a member of.
        This is a good first step to understand the user's account structure.
        """
        try:
            response = self._make_request("GET", "organizations")
            organizations = response.json()
            
            if not organizations:
                return "No Supabase organizations were found for your account."
            
            org_summaries = [
                f"- **{org['name']}** (ID: `{org['id']}`)" for org in organizations
            ]
            return "Here are your Supabase organizations:\n" + "\n".join(org_summaries)
        except Exception as e:
            logger.error(f"Error listing Supabase organizations: {e}", exc_info=True)
            return f"An error occurred while trying to list your Supabase organizations: {e}"

    def list_projects(self) -> str:
        """
        Lists all Supabase projects the connected user has access to across all their organizations.
        """
        try:
            response = self._make_request("GET", "projects")
            projects = response.json()

            if not projects:
                return "No Supabase projects were found for your account."

            project_details = [
                f"- **{proj['name']}** (Region: {proj['region']}, Org ID: `{proj['organization_id']}`)"
                for proj in projects
            ]
            
            return "Here are your Supabase projects:\n" + "\n".join(project_details)
        except Exception as e:
            logger.error(f"Error listing Supabase projects: {e}", exc_info=True)
            return f"An unexpected error occurred while listing your Supabase projects: {e}"