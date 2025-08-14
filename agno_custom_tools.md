Here’s a **detailed, consolidated `agno_tools.md`** based on the Agno documentation you provided, covering Tools, Tool Decorator, Custom Toolkits, Async Tools, and Result Caching:

---

# 📦 Agno Tools Guide (`agno_tools.md`)

## 1. What Are Tools?

* **Tools** are Python functions that let Agno Agents interact with external systems (APIs, databases, shell commands, web search, etc.), enabling agents to act in the world ([docs.agno.com][1]).
* Agno includes 80+ built-in toolkits (e.g., web search, finance, etc.), but you’ll often create custom ones.

**Basic usage example:**

```python
from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools import tool

@tool(show_result=True, stop_after_tool_call=True)
def get_weather(city: str) -> str:
    """Get the weather for a city."""
    return f"The weather in {city} is sunny."

agent = Agent(model=OpenAIChat(...), tools=[get_weather], markdown=True)
agent.print_response("What's the weather?", stream=True)
```

* `show_result=True`: prints tool output
* `stop_after_tool_call=True`: halts agent after calling tool ([docs.agno.com][1])

---

## 2. `@tool` Decorator: Building Custom Tools

* Any function can become a tool; wrapping it with `@tool` enables additional behavior ([docs.agno.com][2]).
* **Decorator options**:

  * `requires_confirmation=True`: ask user before executing
  * `requires_user_input=True`: solicit specific fields via `user_input_fields`
  * `external_execution=True`: run externally
  * `show_result=True`: display output directly
  * `stop_after_tool_call=True`: halt agent after run ([docs.agno.com][2])

**Example:**

```python
@tool(show_result=True)
def get_top_hn(num_stories: int = 5) -> str:
    """Fetch top Hacker News stories."""
    ...
```

---

## 3. Writing Your Own Toolkits

For grouping related tools:

1. Subclass `agno.tools.Toolkit`.
2. Define methods (tools) within the class.
3. Register them via `super().__init__(tools=[...])` ([docs.agno.com][3]).

**Example:**

```python
from agno.tools import Toolkit
from agno.agent import Agent

class ShellTools(Toolkit):
    def __init__(self, **kwargs):
        super().__init__(name="shell_tools",
                         tools=[self.run_shell_command],
                         **kwargs)

    def run_shell_command(self, args: List[str], tail: int = 100) -> str:
        """Run shell and return last N lines."""
        import subprocess
        ...
```

Use by passing `ShellTools()` to `Agent(tools=[...])`.

---

## 4. Async Tools 🧵

* Agno supports concurrent execution of async functions as tools—great for I/O-bound commands or long-running tasks ([docs.agno.com][3], [docs.agno.com][4]).
* Use `async def` for tools, and call with `Agent.aprint_response(...)` wrapped in `asyncio.run(...)`.

**Example:**

```python
async def atask1(delay: int):
    await asyncio.sleep(delay)
    return f"Done in {delay}s"

async_agent = Agent(..., tools=[atask1, atask2])
asyncio.run(async_agent.aprint_response("Run tasks", stream=True))
```

---

## 5. Tool Result Caching

* Avoids redundant tool calls by caching results on disk.
* Speeds development, reduces rate limits/costs ([docs.agno.com][5]).

**To enable:**

```python
from agno.tools.duckduckgo import DuckDuckGoTools
agent = Agent(
    tools=[DuckDuckGoTools(cache_results=True)],
    ...
)
```

Now, repeated identical queries use cached output.

---

## Common Patterns

* **Visibility**: `show_result_tools` and `stop_after_tool_call_tools` allow per-tool control via toolkits ([docs.agno.com][1]).
* **Toolkit composition**: Combine built-in or custom toolkits (e.g., search + reasoning + arxiv).
* **Multi-agent execution**: Use toolkits across team agents for modular workflows.

---

## Complete Example

```python
import asyncio
from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools.duckduckgo import DuckDuckGoTools
from agno.tools.yfinance import YFinanceTools

@tool(show_result=True)
def local_tool(x: int) -> int:
    """Double the number."""
    return x * 2

agent = Agent(
    model=OpenAIChat(...),
    tools=[
        DuckDuckGoTools(cache_results=True),
        YFinanceTools(cache_results=True),
        local_tool
    ],
    show_tool_calls=True,
    markdown=True,
)

asyncio.run(agent.aprint_response("Search web, get AAPL price, then double 7", stream=True))
```

---

## 🧭 Summary Table

| Feature           | Usage                                                 |
| ----------------- | ----------------------------------------------------- |
| Basic tools       | Define any function and pass to `Agent(tools=[…])`    |
| `@tool` decorator | Adds metadata and behaviors (`show`, `confirm`, etc.) |
| Custom Toolkits   | Group related tools via subclassing Toolkit           |
| Async Tools       | Use `async def` functions with `aprint_response`      |
| Caching           | `cache_results=True` on toolkits to avoid recompute   |

---

Let me know if you'd like inline comments, code snippets, or deeper examples!

[1]: https://docs.agno.com/tools/introduction?utm_source=chatgpt.com "What are Tools? - Agno"
[2]: https://docs.agno.com/tools/tool-decorator?utm_source=chatgpt.com "Writing your own tools - Agno"
[3]: https://docs.agno.com/tools/custom-toolkits?utm_source=chatgpt.com "Writing your own Toolkit - Agno"
[4]: https://docs.agno.com/tools/async-tools?utm_source=chatgpt.com "Async Tools - Agno"
[5]: https://docs.agno.com/tools/caching?utm_source=chatgpt.com "Tool Result Caching - Agno"


Here’s a **comprehensive and detailed documentation** for writing your own tools in Agno using the `@tool` decorator, based on the official Agno docs ([docs.agno.com][1]):

---

# 🛠️ Writing Your Own Tools in Agno

Agno empowers you to convert any Python function into a first-class tool for agents. This section dives deep into the `@tool` decorator, illustrating how to modify execution, manage behavior, and leverage tool metadata and caching.

---

## 1. Turn Any Python Function into a Tool 📜

**Basic usage**:

```python
from agno.agent import Agent
import httpx

def get_top_hackernews_stories(num_stories: int = 10) -> str:
    # Fetch top story IDs
    resp = httpx.get('https://hacker-news.firebaseio.com/v0/topstories.json')
    ids = resp.json()
    # Fetch story details
    stories = []
    for sid in ids[:num_stories]:
        s = httpx.get(f'https://hacker-news.firebaseio.com/v0/item/{sid}.json').json()
        if "text" in s:
            s.pop("text", None)
        stories.append(s)
    return json.dumps(stories)

agent = Agent(
    tools=[get_top_hackernews_stories],
    show_tool_calls=True,
    markdown=True
)
agent.print_response("Summarize top 5 stories?", stream=True)
```

**Key Point**: Any Python function is valid—Agno automatically wraps it for tooling use ([docs.agno.com][1]).

---

## 2. Enhancing Tools with `@tool` Decorator

The `@tool` decorator enriches tools with metadata and behavioral flags:

```python
from agno.tools import tool
```

### a) Core Flags

* **`name: str`**: Override the tool's name.
* **`description: str`**: Custom tool description.
* **`show_result: bool`**: Display tool output to the user; otherwise pass it back to the model.
* **`stop_after_tool_call: bool`**: Halt agent execution after invoking the tool.

### b) User Interaction Controls

* **`requires_confirmation: bool`**: Prompt user for permission before execution.
* **`requires_user_input: bool`** and **`user_input_fields: List[str]`**: Specify which function parameters require input during execution.

### c) Execution Customization

* **`external_execution: bool`**: Run the tool outside the agent’s process.

### d) Executing Hooks

* **`tool_hooks: List[Callable]`**: Wrap the main function call with custom logic across both pre- and post-execution.
* **`pre_hook: Callable`** and **`post_hook: Callable`**: More granular hook options executed before or after.

### e) Caching for Efficiency

* **`cache_results: bool`**: Enable caching of identical calls.
* **`cache_dir: str`**: Local directory for cache storage.
* **`cache_ttl: int`**: Time-to-live (seconds); default is 3600.

---

## 3. Advanced Example

A fully featured tool using most `@tool` options:

```python
from agno.agent import Agent
from agno.tools import tool
import httpx
from typing import Any, Callable, Dict

def logger_hook(function_name: str, function_call: Callable, arguments: Dict[str, Any]):
    print(f"About to call {function_name} with arguments: {arguments}")
    result = function_call(**arguments)
    print(f"Function call completed with result: {result}")
    return result

@tool(
    name="fetch_hackernews",
    description="Retrieve top stories from Hacker News",
    show_result=True,
    stop_after_tool_call=True,
    tool_hooks=[logger_hook],
    requires_confirmation=True,
    cache_results=True,
    cache_dir="/tmp/agno_cache",
    cache_ttl=3600
)
def fetch_top_hn(num_stories: int = 5) -> str:
    """Fetch top N Hacker News stories."""
    resp = httpx.get("https://hacker-news.firebaseio.com/v0/topstories.json")
    ids = resp.json()
    stories = []
    for sid in ids[:num_stories]:
        story = httpx.get(f"https://hacker-news.firebaseio.com/v0/item/{sid}.json").json()
        stories.append(f"{story.get('title')} - {story.get('url', 'No URL')}")
    return "\n".join(stories)

agent = Agent(tools=[fetch_top_hn])
agent.print_response("Show me top news from HN", stream=True)
```

**What’s demonstrated**:

* Custom name/description override.
* Hooks logging arguments & results.
* Confirmation prompt to the user.
* Caching results for one hour.
* Automatic halt post tool execution ([docs.agno.com][1]).

---

## 4. `@tool` Parameter Reference Table

| Parameter               | Type             | Description                      |
| ----------------------- | ---------------- | -------------------------------- |
| `name`                  | `str`            | Tool name override               |
| `description`           | `str`            | Tool description override        |
| `show_result`           | `bool`           | Show output in response          |
| `stop_after_tool_call`  | `bool`           | Halt agent post-call             |
| `tool_hooks`            | `List[Callable]` | Hooks wrapping full execution    |
| `pre_hook`              | `Callable`       | Function called before execution |
| `post_hook`             | `Callable`       | Function called after execution  |
| `requires_confirmation` | `bool`           | Confirm with user first          |
| `requires_user_input`   | `bool`           | Require user input               |
| `user_input_fields`     | `List[str]`      | Names of fields needing input    |
| `external_execution`    | `bool`           | Execute externally               |
| `cache_results`         | `bool`           | Enable result caching            |
| `cache_dir`             | `str`            | Directory for cache              |
| `cache_ttl`             | `int`            | Cache expiry time (seconds)      |

---

### ✅ Best Practices

1. **Write clear docstrings** for automatic description fallback.
2. **Use caching** (`cache_results=True`) for idempotent, expensive operations.
3. **Leverage `requires_confirmation` or `requires_user_input`** for safety and clarity.
4. **Add hooks** for logging, instrumentation, or custom wraps.
5. **Stop after tool call** when tool output suffices, avoiding unnecessary model churn.

---

## ✅ Summary

Agno’s `@tool` decorator offers a powerful, flexible interface to make Python functions into full-fledged agent tools. By combining metadata, hooks, caching, and interaction controls, you gain precise control over how agents execute and manage tools—reducing cost, increasing transparency, and improving agent usefulness.

[1]: https://docs.agno.com/tools/tool-decorator?utm_source=chatgpt.com "Writing your own tools - Agno"


Here’s a detailed, well-structured guide on **Writing Your Own Toolkit** in Agno, based on analogous patterns from similar frameworks (e.g., PhiData) and confirmed Agno behaviors. While the official Agno docs may not explicitly document this exact API, the pattern is clear and widely used:

---

## 🧩 Writing Your Own Toolkit

A **Toolkit** in Agno is a structured collection of related tools, packaged together for convenient use. It follows a clear pattern:

### 1. Subclass the Toolkit Base

Start by inheriting from `agno.tools.Toolkit`, providing a logical toolset name.

```python
from agno.tools import Toolkit

class ShellTools(Toolkit):
    def __init__(self, **kwargs):
        super().__init__(name="shell_tools", **kwargs)
        self.register(self.run_shell_command)
```

### 2. Define Tool Methods

Each method in your class becomes a callable tool. Include type hints, defaults, and docstrings for clarity and schema generation.

```python
def run_shell_command(self, args: list[str], tail: int = 100) -> str:
    """Run a shell command and return the last `tail` lines."""
    import subprocess
    result = subprocess.run(args, capture_output=True, text=True)
    output = result.stdout if result.returncode == 0 else result.stderr
    return "\n".join(output.splitlines()[-tail:])
```

### 3. Register Tools

Use `self.register(...)` to let Agno know which methods are exposed as tools:

```python
self.register(self.run_shell_command)
```

You can register multiple methods:

```python
self.register(self.method_one)
self.register(self.method_two)
```

### 4. Use Toolkit in an Agent

Your custom toolkit plugs right into Agno agents:

```python
from agno.agent import Agent

agent = Agent(
    model=...,
    tools=[ShellTools()],
    show_tool_calls=True,
    markdown=True,
)
agent.print_response("Run `ls -la` on my home directory", stream=True)
```

Agno will automatically parse method signatures—from type hints, docstrings, and annotations—to determine parameter schemas and ensure the model can invoke them appropriately.

### 5. Fine‑Tune Behavior via Toolkit Options

Most built-in toolkits support similar parameters:

* **`show_result_tools`**: List of tool names whose results should be shown to users.
* **`stop_after_tool_call_tools`**: Tool names that should stop agent execution after being called.

```python
ShellTools(
    show_result_tools=["run_shell_command"],
    stop_after_tool_call_tools=["run_shell_command"],
)
```

You can mix this with global Agent options to finely tune execution flow.

---

## Summary: Toolkit Bits

| Step                 | Description                                                            |
| -------------------- | ---------------------------------------------------------------------- |
| **Subclass**         | `class MyToolkit(Toolkit)` with a unique toolkit name                  |
| **Define methods**   | Each becomes a tool; include type hints and docstrings                 |
| **Register tools**   | Call `self.register(...)` in `__init__`                                |
| **Instantiate**      | Use your toolkit in an Agent: `tools=[YourToolkit()]`                  |
| **Control Behavior** | Use `show_result_tools`, `stop_after_tool_call_tools`, etc., as needed |

---

## ✅ Why Custom Toolkits?

* **Organization**: Group related tools logically (e.g., shell commands, DB ops).
* **Maintainability**: Keep tool logic encapsulated, reusable across agents.
* **Consistency**: Leverage Agno’s auto-generated schemas, prompting, and execution flows.
* **Customization**: Easily tweak which tools are interactive, stoppable, or hidden.

---

Want to see examples of parameter schema generation, dynamic tool hiding, or combining toolkits in multimodal workflows? I can add code snippets or deeper insights—just say the word!
