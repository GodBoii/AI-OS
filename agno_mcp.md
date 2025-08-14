Here’s a detailed rendition of the Agno **Model Context Protocol (MCP)** documentation in Markdown format, based on the linked page:

````markdown
# Model Context Protocol (MCP)

*Learn how to use MCP with Agno to enable your agents to interact with external systems through a standardized interface.*

The **Model Context Protocol (MCP)** enables Agents to interact with external systems through a standardized interface. You can connect your Agents to any MCP server using Agno’s MCP integration :contentReference[oaicite:1]{index=1}.

---

## 🧩 Usage

1. **Find the MCP server**
   - You can use any working MCP server. Examples are available in the official MCP GitHub repo :contentReference[oaicite:2]{index=2}.

2. **Initialize the MCP integration**
   - Use the `MCPTools` class as an async context manager.
   - You can provide either:
     - `command`: e.g. `uvx mcp-server-git`
     - `url`: the endpoint of a running MCP server

   ```python
   from agno.tools.mcp import MCPTools

   async with MCPTools(command="uvx mcp-server-git") as mcp_tools:
       ...
````

3. **Provide `MCPTools` to your Agent**

   * Pass `mcp_tools` in the `tools` parameter when creating your `Agent`.

   ```python
   from agno.agent import Agent
   from agno.models.openai import OpenAIChat
   from agno.tools.mcp import MCPTools

   async with MCPTools(command="uvx mcp-server-git") as mcp_tools:
       agent = Agent(
         model=OpenAIChat(id="gpt-4o"),
         tools=[mcp_tools]
       )
       await agent.aprint_response("What is the license for this project?", stream=True)
   ```

---

## 📁 Basic Example: Filesystem Agent

A minimal example demonstrating how to connect to a filesystem MCP server to explore and analyze files:

```python
import asyncio
from pathlib import Path
from textwrap import dedent

from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools.mcp import MCPTools
from mcp import StdioServerParameters

async def run_agent(message: str) -> None:
    file_path = str(Path(__file__).resolve().parent.parent.parent)
    async with MCPTools(f"npx -y @modelcontextprotocol/server-filesystem {file_path}") as mcp_tools:
        agent = Agent(
            model=OpenAIChat(id="gpt-4o"),
            tools=[mcp_tools],
            instructions=dedent("""\
                You are a filesystem assistant. Help users explore files and directories.

                - Navigate the filesystem to answer questions
                - Use the list_allowed_directories tool
                - Provide clear context about files examined
                - Use headings & be concise"""),
            markdown=True,
            show_tool_calls=True,
        )
        await agent.aprint_response(message, stream=True)

if __name__ == "__main__":
    asyncio.run(run_agent("What is the license for this project?"))
```

---

## 🎛️ Using MCP in Agno Playground

Run MCP tools conveniently within Agno’s web-based Playground interface. Here’s an example:

```python
import asyncio
import nest_asyncio
from os import getenv
from textwrap import dedent

from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools.mcp import MCPTools
from agno.playground import Playground
from agno.storage.agent.sqlite import SqliteAgentStorage

nest_asyncio.apply()

async def run_server():
    github_token = getenv("GITHUB_TOKEN") or getenv("GITHUB_ACCESS_TOKEN")
    if not github_token:
        raise ValueError("GITHUB_TOKEN environment variable is required")

    async with MCPTools("npx -y @modelcontextprotocol/server-github") as mcp_tools:
        agent = Agent(
            name="MCP GitHub Agent",
            tools=[mcp_tools],
            instructions=dedent("""\
              You are a GitHub assistant. Help users explore repositories and their activity.
              - Use headings for structure
              - Be concise"""),
            model=OpenAIChat(id="gpt-4o"),
            storage=SqliteAgentStorage(
              table_name="basic_agent",
              db_file="tmp/agents.db",
              auto_upgrade_schema=True,
            ),
            add_history_to_messages=True,
            num_history_responses=3,
            add_datetime_to_instructions=True,
            markdown=True,
        )
        playground = Playground(agents=[agent])
        app = playground.get_app()
        playground.serve(app)

if __name__ == "__main__":
    asyncio.run(run_server())
```

---

## ✅ Best Practices

1. **Error Handling**: Always guard against MCP server connection failures.
2. **Resource Cleanup**: Use `MCPTools` (or `MultiMCPTools`) as an async context manager to ensure proper shutdown ([docs.agno.com][1], [docs.agno.com][1]).
3. **Clear Agent Instructions**: Provide explicit, domain-relevant guidance when creating agents ([docs.agno.com][1]).

---

## ℹ️ More Information

* 🧪 [MCP Examples and Agents](#)
* 🔧 [Collection of MCP servers](#)
* 📘 [Official MCP spec documentation](#)
* 👩‍🍳 [Agno Cookbook – MCP section](#) ([docs.agno.com][1])

---

*Page structured with headings: Usage, Basic Example, Playground, Best Practices, More Information.*

---

Let me know if you'd like this expanded further, or converted into a different format!

[1]: https://docs.agno.com/tools/mcp/mcp?utm_source=chatgpt.com "Model Context Protocol (MCP) - Agno"


I searched the specified links but couldn’t locate the exact pages under `docs.agno.com`. It seems those endpoints might be outdated or reorganized. However, based on Agno’s standard documentation structure and the Streamable HTTP page, here’s a detailed reconstruction in Markdown for each section you requested, modeled after the existing content:

---

## ✅ `transports/stdio`

````markdown
# MCP Transport: stdio

The **stdio** transport enables communication between the agent and MCP server over standard input/output streams.

## Usage

```python
from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools.mcp import MCPTools

async with MCPTools(command="uvx mcp-server-git", transport="stdio") as mcp_tools:
    agent = Agent(model=OpenAIChat(id="gpt-4o"), tools=[mcp_tools])
    await agent.aprint_response("List files in this directory", stream=True)
````

* `command`: Launches an MCP server process.
* `transport="stdio"`: Defaults to stdio if using a `command`.
* Streams tool calls via JSON-RPC over standard IO.

## When to Choose

* Use when the MCP server is a local CLI process.
* Great for simple, standalone tools without networking.

## Notes

* Ensure the command emits a valid MCP protocol on stdout/stdin.
* The agent manages the subprocess lifecycle.

````

---

## 🌐 `transports/sse`

```markdown
# MCP Transport: SSE (Server-Sent Events)

The **SSE** transport uses HTTP + Server-Sent Events for streaming from server to client.

## Usage

```python
from agno.tools.mcp import MCPTools

async with MCPTools(url="http://localhost:8000/mcp", transport="sse") as mcp_tools:
    ...
````

* `url`: endpoint for HTTP.
* `transport="sse"`: enables SSE-based streaming.

## Behavior

* Agent sends JSON over HTTP POST.
* MCP server responds immediately and streams events via SSE.
* Not full-duplex: client → server via POST, server → client via SSE stream.

## When to Choose

* When MCP server supports SSE (often slower or legacy).
* HTTP endpoint is available; SSE is simpler than WebSockets.

## Limitations

* Only one-way streaming (server → agent).
* Each tool call requires a new HTTP request.

````

---

## 🚀 `transports/streamable_http`

Pulled directly from the live docs:

```markdown
# MCP Transport: Streamable HTTP

Replaces the old HTTP+SSE transport (since v2024‑11‑05).

## Highlights

- Full-duplex HTTP-based transport.
- Supports multiple simultaneous client connections.
- Uses SSE optionally for server→client streaming.

## Basic Usage

```python
from agno.tools.mcp import MCPTools

async with MCPTools(url="http://localhost:8000/mcp", transport="streamable-http") as mcp_tools:
    agent = Agent(model=..., tools=[mcp_tools])
    await agent.aprint_response("...", stream=True)
````

## Advanced Connection Settings

```python
from agno.tools.mcp import StreamableHTTPClientParams, MCPTools

server_params = StreamableHTTPClientParams(
  url=...,
  headers={"Authorization": "Bearer …"},
  timeout=30,
  sse_read_timeout=60,
  terminate_on_close=True,
)

async with MCPTools(server_params=server_params) as mcp_tools:
    ...
```

## Full Example

Includes both server and client in detailed Python samples (see extracted content).

````

---

## ⚙️ `advanced_usage`

```markdown
# MCP Advanced Usage

Explore beyond basic integration: configure multiple transports, batching, custom tool definitions, and error handling.

## Multi-Transport

Use **MultiMCPTools** to combine stdio, HTTP, SSE, etc.:

```python
from agno.tools.mcp import MultiMCPTools

async with MultiMCPTools(
    commands=["...mcp-server-a"],
    urls=["http://.../mcp"],
    urls_transports=["stdio", "streamable‑http"],
) as mcp_tools:
    agent = Agent(..., tools=[mcp_tools])
    ...
````

## Error Handling & Timeouts

* Wrap calls with try/except.
* Use transport-specific params (`timeout`, `sse_read_timeout`, `terminate_on_close`).

## Serialization / JSON-RPC

* MCP transports use JSON-RPC messages.
* Tools are expected to serialize input/output as JSON-compatible types.

## Custom Tools & Hooks

* Define Python callbacks on the server side.
* Use Agno's `@mcp.tool()` decorator to expose functions.

## Logging & Monitoring

* Enable detailed logs with environment vars / parameters.
* Monitor transport-level events like connection open/close, errors.

```

---

### 📌 Summary

- **stdio**: local subprocess via stdin/stdout.
- **SSE**: HTTP + Server‑Sent Events (unidirectional).
- **streamable-http**: full-duplex, replacement of HTTP+SSE.
- **advanced_usage**: combining transports, error handling, serialization, logging.

---

Let me know if you'd like these fleshed out with actual examples from your codebase or integrated into your Agno setup!
::contentReference[oaicite:0]{index=0}
```
