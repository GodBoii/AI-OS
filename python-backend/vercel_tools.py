# python-backend/vercel_tools.py

import logging
import requests
from typing import Optional, List, Dict, Any
from datetime import datetime

from agno.tools import Toolkit
from supabase_client import supabase_client

logger = logging.getLogger(__name__)

class VercelTools(Toolkit):
    """
    A toolkit for interacting with the Vercel API on behalf of the user.
    It allows the agent to manage projects, deployments, environment variables, and domains.
    """

    def __init__(self, user_id: str):
        """Initializes the VercelTools toolkit."""
        super().__init__(
            name="vercel_tools",
            tools=[
                # Existing Read-Only Tools
                self.list_projects,
                self.list_deployments,
                self.get_project_details,
                # --- START: New Expanded Tools ---
                self.list_environment_variables,
                self.add_environment_variable,
                self.remove_environment_variable,
                self.trigger_redeployment,
                self.list_project_domains,
                # --- END: New Expanded Tools ---
            ],
        )
        self.user_id = user_id
        self._access_token: Optional[str] = None
        self._token_fetched = False
        self.api_base_url = "https://api.vercel.com"

    def _get_access_token(self) -> Optional[str]:
        """Retrieves the user's Vercel access token from the database."""
        if self._token_fetched:
            return self._access_token
        try:
            response = (
                supabase_client.from_("user_integrations")
                .select("access_token").eq("user_id", self.user_id).eq("service", "vercel")
                .single().execute()
            )
            self._access_token = response.data.get("access_token") if response.data else None
        except Exception as e:
            logger.error(f"Error fetching Vercel token for user {self.user_id}: {e}")
            self._access_token = None
        self._token_fetched = True
        return self._access_token

    def _make_request(self, method: str, endpoint: str, params: Optional[Dict[str, Any]] = None, json_payload: Optional[Dict[str, Any]] = None) -> requests.Response:
        """
        A helper function to make authenticated requests to the Vercel API.
        Now supports sending a JSON payload for POST/DELETE requests.
        """
        token = self._get_access_token()
        if not token:
            raise Exception("Vercel account not connected or token is invalid.")
        
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        url = f"{self.api_base_url}/{endpoint}"
        
        response = requests.request(method, url, headers=headers, params=params, json=json_payload)
        response.raise_for_status()
        return response

    # --- Existing Tools (Unchanged) ---

    def list_projects(self) -> str:
        """Lists all projects for the connected Vercel account, including their name and framework."""
        try:
            response = self._make_request("GET", "v9/projects")
            projects = response.json().get("projects", [])
            if not projects: return "No Vercel projects were found for your account."
            summaries = [f"- **{p['name']}** (ID: `{p['id']}`, Framework: {p.get('framework', 'N/A')})" for p in projects]
            return "Here are your Vercel projects:\n" + "\n".join(summaries)
        except Exception as e:
            return f"An error occurred: {e}"

    def list_deployments(self, project_name: str, limit: int = 5) -> str:
        """Lists the most recent deployments for a specific Vercel project by its name."""
        try:
            response = self._make_request("GET", "v6/deployments", params={"appName": project_name, "limit": limit})
            deployments = response.json().get("deployments", [])
            if not deployments: return f"No deployments found for project '{project_name}'."
            details = [f"- **{d.get('state', 'N/A').upper()}**: {d.get('meta', {}).get('githubCommitMessage', 'N/A')} (Deployed on {datetime.fromtimestamp(d['createdAt'] / 1000).strftime('%Y-%m-%d %H:%M')})" for d in deployments]
            return f"Recent deployments for '{project_name}':\n" + "\n".join(details)
        except requests.HTTPError as e:
            if e.response.status_code == 404: return f"Error: Project '{project_name}' not found."
            return f"API error: {e}"
        except Exception as e:
            return f"An unexpected error occurred: {e}"

    def get_project_details(self, project_name: str) -> str:
        """Gets detailed information about a single Vercel project."""
        try:
            response = self._make_request("GET", f"v9/projects/{project_name}")
            project = response.json()
            domains = [alias['domain'] for alias in project.get('alias', [])]
            details = [
                f"**Name**: {project.get('name')}", f"**ID**: `{project.get('id')}`",
                f"**Framework**: {project.get('framework', 'N/A')}",
                f"**Root Directory**: {project.get('rootDirectory', './') or './'}",
                f"**Domains**: " + (", ".join(domains) if domains else "None assigned."),
            ]
            return f"Details for project '{project_name}':\n" + "\n".join(details)
        except requests.HTTPError as e:
            if e.response.status_code == 404: return f"Error: Project '{project_name}' not found."
            return f"API error: {e}"
        except Exception as e:
            return f"An unexpected error occurred: {e}"

    # --- START: New Expanded Tools ---

    def list_environment_variables(self, project_id_or_name: str) -> str:
        """
        Lists the environment variables for a specific Vercel project.
        This returns the ID, key, and target for each variable, but not the secret value.
        """
        try:
            response = self._make_request("GET", f"v9/projects/{project_id_or_name}/env")
            envs = response.json().get('envs', [])
            if not envs:
                return f"No environment variables found for project '{project_id_or_name}'."
            
            var_details = [f"- Key: **{env['key']}**, Target: {', '.join(env['target'])}, ID: `{env['id']}`" for env in envs]
            return f"Environment variables for '{project_id_or_name}':\n" + "\n".join(var_details)
        except requests.HTTPError as e:
            if e.response.status_code == 404: return f"Error: Project '{project_id_or_name}' not found."
            return f"API error: {e}"
        except Exception as e:
            return f"An unexpected error occurred: {e}"

    def add_environment_variable(self, project_id_or_name: str, key: str, value: str, target: str) -> str:
        """
        Adds a new environment variable to a specified Vercel project.

        Args:
            project_id_or_name: The name or ID of the Vercel project.
            key: The name of the environment variable (e.g., 'DATABASE_URL').
            value: The secret value of the variable.
            target: The environment to apply it to. Must be one of: 'production', 'preview', 'development'.
        """
        valid_targets = ['production', 'preview', 'development']
        if target not in valid_targets:
            return f"Error: Invalid target '{target}'. Must be one of {valid_targets}."
        
        try:
            payload = {'key': key, 'value': value, 'type': 'secret', 'target': [target]}
            self._make_request("POST", f"v9/projects/{project_id_or_name}/env", json_payload=payload)
            return f"Successfully added environment variable '{key}' to project '{project_id_or_name}' for the '{target}' environment."
        except requests.HTTPError as e:
            if e.response.status_code == 404: return f"Error: Project '{project_id_or_name}' not found."
            return f"API error: {e.response.json().get('error', {}).get('message', 'Failed to add variable.')}"
        except Exception as e:
            return f"An unexpected error occurred: {e}"

    def remove_environment_variable(self, project_id_or_name: str, env_id: str) -> str:
        """
        Removes an environment variable from a project using its unique ID.
        You must first call 'list_environment_variables' to get the ID for the variable you want to remove.
        """
        try:
            self._make_request("DELETE", f"v9/projects/{project_id_or_name}/env/{env_id}")
            return f"Successfully removed environment variable with ID '{env_id}' from project '{project_id_or_name}'."
        except requests.HTTPError as e:
            if e.response.status_code == 404: return f"Error: Project or environment variable with ID '{env_id}' not found."
            return f"API error: {e}"
        except Exception as e:
            return f"An unexpected error occurred: {e}"

    def trigger_redeployment(self, project_name: str) -> str:
        """
        Triggers a new deployment for a project using the latest available Git commit.
        This is useful for applying new environment variables or simply restarting the service.
        """
        try:
            payload = {'name': project_name, 'target': 'production'}
            response = self._make_request("POST", "v13/deployments", json_payload=payload)
            deployment_info = response.json()
            return f"Successfully triggered a new deployment for '{project_name}'. View status at: {deployment_info.get('url')}"
        except requests.HTTPError as e:
            if e.response.status_code == 404: return f"Error: Project '{project_name}' not found."
            return f"API error: {e.response.json().get('error', {}).get('message', 'Failed to trigger deployment.')}"
        except Exception as e:
            return f"An unexpected error occurred: {e}"

    def list_project_domains(self, project_id_or_name: str) -> str:
        """
        Lists all domains assigned to a specific Vercel project, including automatic and custom domains.
        """
        try:
            response = self._make_request("GET", f"v9/projects/{project_id_or_name}/domains")
            domains = response.json().get('domains', [])
            if not domains:
                return f"No domains are configured for project '{project_id_or_name}'."
            
            domain_details = [f"- **{d['name']}** ({'Verified' if d['verified'] else 'Not Verified'})" for d in domains]
            return f"Domains for '{project_id_or_name}':\n" + "\n".join(domain_details)
        except requests.HTTPError as e:
            if e.response.status_code == 404: return f"Error: Project '{project_id_or_name}' not found."
            return f"API error: {e}"
        except Exception as e:
            return f"An unexpected error occurred: {e}"

    # --- END: New Expanded Tools ---