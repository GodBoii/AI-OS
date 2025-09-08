# python-backend/vercel_tools.py

import logging
import requests
from typing import Optional, List
from datetime import datetime

from agno.tools import Toolkit
from supabase_client import supabase_client

logger = logging.getLogger(__name__)

class VercelTools(Toolkit):
    """
    A toolkit for interacting with the Vercel API on behalf of the user,
    allowing the agent to list projects, view deployments, and check project details.
    """

    def __init__(self, user_id: str):
        """Initializes the VercelTools toolkit."""
        super().__init__(
            name="vercel_tools",
            tools=[
                self.list_projects,
                self.list_deployments,
                self.get_project_details,
            ],
        )
        self.user_id = user_id
        self._access_token: Optional[str] = None
        self._token_fetched = False
        self.api_base_url = "https://api.vercel.com"

    def _get_access_token(self) -> Optional[str]:
        """
        Retrieves the user's Vercel access token from the database.
        The token is cached in memory for the duration of the agent's run.
        """
        if self._token_fetched:
            return self._access_token
        try:
            response = (
                supabase_client.from_("user_integrations")
                .select("access_token")
                .eq("user_id", self.user_id)
                .eq("service", "vercel")  # Query for the 'vercel' service
                .single()
                .execute()
            )
            if response.data and response.data.get("access_token"):
                self._access_token = response.data["access_token"]
            else:
                self._access_token = None
        except Exception as e:
            logger.error(f"Error fetching Vercel token for user {self.user_id}: {e}")
            self._access_token = None
        
        self._token_fetched = True
        return self._access_token

    def _make_request(self, method: str, endpoint: str, params: Optional[dict] = None) -> requests.Response:
        """
        A helper function to make authenticated requests to the Vercel API.
        It automatically includes the authorization header.

        Args:
            method: The HTTP method (e.g., 'GET', 'POST').
            endpoint: The API endpoint path (e.g., 'v9/projects').
            params: Optional dictionary of query parameters.

        Returns:
            The requests.Response object.
        
        Raises:
            Exception: If the Vercel account is not connected or the token is invalid.
            requests.HTTPError: If the API returns a 4xx or 5xx status code.
        """
        token = self._get_access_token()
        if not token:
            raise Exception("Vercel account not connected or token is invalid.")
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        
        url = f"{self.api_base_url}/{endpoint}"
        response = requests.request(method, url, headers=headers, params=params or {})
        response.raise_for_status()  # This will raise an HTTPError for bad responses
        return response

    def list_projects(self) -> str:
        """
        Lists all projects for the connected Vercel account, including their name and framework.
        This is a great first step to understand what the user has on Vercel.
        """
        try:
            response = self._make_request("GET", "v9/projects")
            projects = response.json().get("projects", [])
            
            if not projects:
                return "No Vercel projects were found for your account."
            
            project_summaries = [
                f"- **{p['name']}** (Framework: {p.get('framework', 'N/A')})" for p in projects
            ]
            return "Here are your Vercel projects:\n" + "\n".join(project_summaries)
        except Exception as e:
            logger.error(f"Error listing Vercel projects: {e}", exc_info=True)
            return f"An error occurred while trying to list your Vercel projects: {e}"

    def list_deployments(self, project_name: str, limit: int = 5) -> str:
        """
        Lists the most recent deployments for a specific Vercel project by its name.
        Provides details like deployment status, commit message, and creation date.

        Args:
            project_name: The name of the Vercel project (e.g., 'my-portfolio').
            limit: The number of recent deployments to return. Defaults to 5.
        """
        try:
            response = self._make_request("GET", "v6/deployments", params={"appName": project_name, "limit": limit})
            deployments = response.json().get("deployments", [])

            if not deployments:
                return f"No deployments found for the project named '{project_name}'. Please check the name."

            deployment_details = []
            for d in deployments:
                # Vercel API returns timestamp in milliseconds, so divide by 1000
                created_date = datetime.fromtimestamp(d['createdAt'] / 1000).strftime('%Y-%m-%d %H:%M:%S UTC')
                commit_msg = d.get('meta', {}).get('githubCommitMessage', 'N/A')
                state = d.get('state', 'UNKNOWN').upper()
                deployment_details.append(
                    f"- **{state}**: {commit_msg} (Deployed on {created_date})"
                )
            
            return f"Recent deployments for '{project_name}':\n" + "\n".join(deployment_details)
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                return f"Error: Could not find a Vercel project named '{project_name}'. Please use 'list_projects' to see available projects."
            return f"An API error occurred while fetching deployments: {e}"
        except Exception as e:
            logger.error(f"Error listing Vercel deployments for {project_name}: {e}", exc_info=True)
            return f"An unexpected error occurred while listing deployments: {e}"

    def get_project_details(self, project_name: str) -> str:
        """
        Gets detailed information about a single Vercel project, including its domains and root directory.

        Args:
            project_name: The name of the Vercel project to inspect.
        """
        try:
            response = self._make_request("GET", f"v9/projects/{project_name}")
            project = response.json()

            domains = [alias['domain'] for alias in project.get('alias', [])]
            
            details = [
                f"**Name**: {project.get('name')}",
                f"**Framework**: {project.get('framework', 'N/A')}",
                f"**Root Directory**: {project.get('rootDirectory', './') or './'}",
                f"**Domains**: " + (", ".join(domains) if domains else "No custom domains assigned."),
            ]
            
            return f"Details for project '{project_name}':\n" + "\n".join(details)
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                return f"Error: Could not find a Vercel project named '{project_name}'. Please use 'list_projects' to see available projects."
            return f"An API error occurred while fetching project details: {e}"
        except Exception as e:
            logger.error(f"Error getting details for Vercel project {project_name}: {e}", exc_info=True)
            return f"An unexpected error occurred while getting project details: {e}"