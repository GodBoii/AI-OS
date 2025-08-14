Here is a detailed breakdown of the **Agent Settings** from Browser‑Use, formatted in Markdown:

---

# 🛠 Browser‑Use `Agent` Settings

Learn how to configure the `Agent` class — the core component managing browser automation.

---

## 1. Overview

The `Agent` class orchestrates browser actions using Playwright. You must specify the **task** to perform and an **LLM** instance ([source](#cite1)).

---

## 🔧 2. Required Parameters

```python
Agent(
  task="string",        # A clear instruction for the agent
  llm=ChatOpenAI(...),  # A supported chat model instance
)
```

* **task**: e.g., `"Search for latest news about AI"`
* **llm**: Chat model (see Supported Models) ([docs.browser-use.com][1])

---

## ⚙️ 3. Agent Behavior Configuration

```python
Agent(
  task="…",
  llm=llm,
  controller=custom_controller,       # Custom function registry
  use_vision=True,                    # Enable page screenshot understanding
  save_conversation_path="logs/...",  # Save chat history
  override_system_message="…",        # Fully replace system prompt
  extend_system_message="…",          # Append to default prompt
)
```

**Parameters**:

* `controller`: Controls callable tools (Default = base Controller) ([docs.browser-use.com][1])
* `use_vision`: Defaults to `True`. Costs ~~800–1000 tokens (~~\$0.002) per image with GPT‑4o ([docs.browser-use.com][1])
* `save_conversation_path`: Where to save dialogue logs
* `override_system_message` / `extend_system_message`: Customize system prompts ([docs.browser-use.com][1])

---

## ♻️ 4. Reuse Existing Browser Context

By default, Browser‑Use launches a Playwright Chromium browser. You can also attach to:

* Existing profile/session:

  * `page`, `browser_context`, `browser`, `browser_session`, or `browser_profile` ([docs.browser-use.com][1])

**Examples**:

```python
Agent(..., browser_profile=your_profile)
Agent(..., browser_session=BrowserSession(cdp_url="..."))
Agent(..., browser_session=BrowserSession(browser_pid=1234))
```

* Provides flexibility to reuse login, cookies, or remote browsers
* By default, Browser‑Use closes the browser it launched; attached sessions stay open&#x20;

---

## ▶️ 5. Running the Agent

```python
history = await agent.run(max_steps=100)
```

* `max_steps`: Defaults to 100. Limits agent iterations ([docs.browser-use.com][1])

---

## 📜 6. Agent History & Debugging

`Agent.run()` returns an `AgentHistoryList` with:

* `.urls()`, `.screenshots()`, `.action_names()`, `.extracted_content()`, `.errors()`, `.model_actions()`
* Helpers: `.final_result()`, `.is_done()`, `.has_errors()`, `.model_thoughts()`, `.action_results()` ([docs.browser-use.com][1])

---

## 🚀 7. Initial Actions Without LLM

Execute predefined browser actions before the LLM kicks in:

```python
initial_actions = [
  {"go_to_url": {"url": "...", "new_tab": True}},
  {"scroll_down": {"amount": 1000}}
]
Agent(..., initial_actions=initial_actions)
```

* Useful for logging in, navigation setup, etc. ([docs.browser-use.com][1])

---

## 💬 8. Message Context

Add context or instructions before running the main task:

````python
Agent(
  task="your task",
  message_context="Additional info…",
  llm=ChatOpenAI(...)
)
``` :contentReference[oaicite:30]{index=30}

---

## 🧠 9. Planner Model Support

Separate planning can improve performance:

```python
Agent(
  task="…",
  llm=ChatOpenAI(model='gpt-4o'),
  planner_llm=ChatOpenAI(model='o3-mini'),
  use_vision_for_planner=False,
  planner_interval=4
)
````

* `planner_llm`: A lighter model for strategizing
* `use_vision_for_planner`: Toggle visual input for planner
* `planner_interval`: Steps between planning phases ([docs.browser-use.com][1])

---

## 🔄 10. Optional Tuning Parameters

* `max_actions_per_step`: Default `10`
* `max_failures`: Default `3`
* `retry_delay`: Default `10` seconds
* `generate_gif`: `False` by default; can specify a path to save GIFs ([docs.browser-use.com][1])

---

## 🧬 11. Memory

* Memory has been refactored since v0.3.2
* The old `enable_memory` parameter is deprecated—remove it if upgrading ([docs.browser-use.com][1])

---

## 📋 Summary Table

| Feature                    | Parameter(s)                                                | Notes                                        |
| -------------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| **Task & Model**           | `task`, `llm`                                               | Required                                     |
| **Custom Tools & Vision**  | `controller`, `use_vision`                                  | Extend behavior & reduce cost                |
| **Conversation Logging**   | `save_conversation_path`                                    | Helpful for debugging                        |
| **System Message Control** | `override_system_message`, `extend_system_message`          | Prompt customization                         |
| **Browser Reuse**          | `browser_profile`, `browser_session`, etc.                  | Attach to existing session                   |
| **Execution Control**      | `max_steps`                                                 | Manage runtime length                        |
| **History & Analysis**     | `AgentHistoryList` methods                                  | Inspect run details, errors, outputs         |
| **Pre-Language Actions**   | `initial_actions`                                           | Automate setup steps                         |
| **Context Enrichment**     | `message_context`                                           | Provide clarifications before task           |
| **Task Planning**          | `planner_llm`, `use_vision_for_planner`, `planner_interval` | Use separate planning model                  |
| **Error Handling**         | `max_actions_per_step`, `max_failures`, `retry_delay`       | Failure resilience tuning                    |
| **Visual Output**          | `generate_gif`                                              | Capture workflows                            |
| **Modern Memory**          | --                                                          | New context system; old memory is deprecated |

---

Let me know if you'd like example code for any of these options!

[1]: https://docs.browser-use.com/customize/agent-settings?utm_source=chatgpt.com "Agent Settings - Browser Use"

Here’s a detailed breakdown of the **Browser Settings** from Browser‑Use, formatted in Markdown:

---

# 🧩 Browser‑Use `BrowserSession` & `BrowserProfile` Settings

These settings control how Browser‑Use launches or connects to browsers using Playwright, offering fine-grained control over behavior.

---

## ⚙️ 1. BrowserSession

`BrowserSession(...)` manages live browser interaction:

* Initializes `playwright`, `browser`, `browser_context`, and `page`.
* Tracks tabs and user focus.
* Manages sessions and optionally injects element-detection tooling. ([docs.browser-use.com][1])

```python
browser_session = BrowserSession(
  headless=True,
  viewport={'width': 964, 'height': 647},
  user_data_dir='~/.config/browseruse/profiles/default',
)
```

* Accepts both temporary settings or profiles via `browser_profile`. ([docs.browser-use.com][1])

---

## 🌐 2. Browser Connection Parameters

Use these to **attach** to existing browser instances—not persisted in `BrowserProfile`:

* `wss_url: str` — connect via WebSocket (Playwright CDP)
* `cdp_url: str` — e.g. `http://localhost:9222`
* `browser_pid: int` — attach to a running Chromium by system process ID
  ([docs.browser-use.com][1])

---

## 🔄 3. Session-Specific Parameters

Session overrides on top of profiles:

* `browser_profile: BrowserProfile` — apply template config
* `playwright`, `browser`, `browser_context`, `page`, `human_current_page`, `initialized` flags when reusing existing objects
  ([docs.browser-use.com][1])

Example using base profile with timezone overrides:

```python
base = BrowserProfile(storage_state='/tmp/auth.json', **playwright.devices['iPhone 13'], timezone_id='UTC')
BrowserSession(browser_profile=base, timezone_id='America/New_York')
```



---

## 🗂️ 4. BrowserProfile

A reusable, validated template for session configs:

* Offers IDE auto-complete and validation.
* Stores default playwright/browser-use configurations.
* Can export/load JSON or integrate into databases.
* Cannot hold connection-specific fields like `cdp_url`, etc. ([docs.browser-use.com][1])

Basic example:

```python
profile = BrowserProfile(
  stealth=True,
  storage_state='/tmp/google_cookies.json',
  allowed_domains=['docs.google.com','accounts.google.com'],
  viewport={'width': 396, 'height': 774},
)
```



---

## 🧪 5. Browser‑Use Specific Settings

These enhance stealth, debugging, and token efficiency:

| Parameter                              | Type & Default          | Description                                              |
| -------------------------------------- | ----------------------- | -------------------------------------------------------- |
| `keep_alive`                           | `bool` (None → default) | Keep browser open after run if True                      |
| `stealth`                              | `bool = False`          | Use patchright to bypass bot detection                   |
| `allowed_domains`                      | `str[]`                 | Restrict which domains agent may visit                   |
| `disable_security`                     | `bool = False`          | ✖️ Disables most browser security—use only for debugging |
| `deterministic_rendering`              | `bool = False`          | For consistent screenshot comparisons                    |
| `highlight_elements`                   | `bool = True`           | Displays bounding boxes on UI elements                   |
| `viewport_expansion`                   | `int = 500`             | Include extra pixels around viewport in LLM context      |
| `include_dynamic_attributes`           | `bool = True`           | Adds dynamic attributes to selectors                     |
| `minimum_wait_page_load_time`          | `float = 0.25s`         | Minimum wait before capturing page                       |
| `wait_for_network_idle_page_load_time` | `float = 0.5s`          | Wait for network to settle                               |
| `maximum_wait_page_load_time`          | `float = 5.0s`          | Timeout for page load                                    |
| `wait_between_actions`                 | `float = 0.5s`          | Delay between agent actions                              |
| `cookies_file` *(deprecated)*          | `str \| None`           | Use `storage_state` instead                              |
| `profile_directory`                    | `str = 'Default'`       | Specify Chrome profile folder                            |
| `window_position`                      | `dict \| None`          | Position of window (x, y)                                |
| `save_recording_path`                  | `str \| None`           | Directory for video recordings                           |
| `trace_path`                           | `str \| None`           | Directory for Playwright trace `.zip`                    |
| ([docs.browser-use.com][1])            |                         |                                                          |

---

## 🧩 6. Playwright Launch Options

Shared between `BrowserSession` & `BrowserProfile`. Includes:

* `headless: bool`
* `channel: 'chromium'/'chrome'/...`
* `executable_path`
* `user_data_dir` (profile data directory)
* `args`, `ignore_default_args`, `env`
* `chromium_sandbox`, `devtools`, `slow_mo`, `timeout`, `accept_downloads`
* `proxy`, `permissions`, `storage_state`
  ([docs.browser-use.com][1])

---

## ⏱ 7. Timing & Viewport Settings

Control delays and emulation:

* `default_timeout`, `default_navigation_timeout`
* `user_agent`, `is_mobile`, `has_touch`, `geolocation`, `locale`, `timezone_id`
* `window_size`, `viewport`, `no_viewport`, `device_scale_factor`, `screen`
* Accessibility settings: `color_scheme`, `contrast`, `reduced_motion`, `forced_colors`
  ([docs.browser-use.com][1])

---

## 🔐 8. Security & Headers

Configure HTTP interactions and privacy:

* `offline`
* `http_credentials`
* `extra_http_headers`
* `ignore_https_errors`, `bypass_csp`, `java_script_enabled`, `service_workers`
* `base_url`, `strict_selectors`, `client_certificates`
  ([docs.browser-use.com][1])

---

## 🎥 9. Recording & Tracing

Produce debugging artifacts:

* `record_video_dir` (alias `save_recording_path`)
* `record_video_size`, `record_har_path`, `record_har_content`, `record_har_mode`, `record_har_omit_content`, `record_har_url_filter`
* `downloads_path`, `traces_dir` (alias `trace_path`)
* Signal handling: `handle_sighup`, `handle_sigint`, `handle_sigterm`
  ([docs.browser-use.com][1])

---

## 🔧 10. Full Example

```python
from browser_use import BrowserSession, BrowserProfile, Agent

profile = BrowserProfile(
  headless=False,
  storage_state="path/to/state.json",
  wait_for_network_idle_page_load_time=3.0,
  viewport={"width": 1280, "height": 1100},
  locale='en-US',
  user_agent='Mozilla/5.0 …',
  highlight_elements=True,
  viewport_expansion=500,
  allowed_domains=['*.google.com','*.wikipedia.org'],
  user_data_dir=None,
)

browser_session = BrowserSession(browser_profile=profile, headless=True)

await browser_session.start()
page = await browser_session.get_current_page()

agent = Agent(
  task='Your task',
  llm=llm,
  page=page,
  browser_session=browser_session,
)
```



---

## ✅ Summary

* **`BrowserSession`** handles browser connection and live state.
* **`BrowserProfile`** stores reusable, typed configuration.
* Shared config spans Playwright launch, context, viewport, timing, security, recording, and browser-use enhancements.

Let me know if you want a quick-start example or help customized for your specific use case!

[1]: https://docs.browser-use.com/customize/browser-settings?utm_source=chatgpt.com "Browser Settings"

Here’s a detailed markdown breakdown of the **MCP Server** documentation for Browser‑Use, based on the official docs:

---

# 🧩 Browser‑Use MCP Server – Detailed Guide

The MCP (Model Context Protocol) server exposes Browser‑Use's browser automation tools—navigate, click, extract content, manage tabs—as MCP-compatible tools that can be used by AI assistants like Claude Desktop. ([docs.browser-use.com][1])

---

## ✅ 1. Overview

* **Purpose**: Acts as a bridge between MCP-compatible clients and Browser‑Use, allowing remote browser control (navigate, interact, extract).
* **Direction**: External AI assistant → MCP Server → Browser‑Use → Browser automation.&#x20;

---

## 🛠 2. Installation

```bash
pip install "browser-use[cli]"
```

(Or use via `uvx browser-use --mcp`) ([docs.browser-use.com][1])

---

## 🚀 3. Quick Start with Claude Desktop

1. **Configure MCP server** in Claude Desktop config file:

   * **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   * **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

   Include:

   ````json
   "mcpServers": {
     "browser-use": {
       "command": "uvx",
       "args": ["browser-use[cli]", "--mcp"],
       "env": {
         "OPENAI_API_KEY": "sk-..."  // Optional for content extraction
       }
     }
   }
   ``` :contentReference[oaicite:11]{index=11}

   ````

2. **Restart Claude Desktop** → Browser‑Use tools appear in Tools menu. ([docs.browser-use.com][1])

3. **Start using**:

   * `browser_navigate("https://example.com")`
   * `browser_click(3)`
   * `browser_extract_content(...)` ([docs.browser-use.com][1])

---

## 🧰 4. API Reference – Available Tools

### 🔗 Navigation Tools

* **`browser_navigate(url: string, new_tab?: boolean): string`**
* **`browser_go_back(): string`** ([docs.browser-use.com][1])

### 🖱️ Interaction Tools

* **`browser_click(index: number, new_tab?: boolean): string`**
* **`browser_type(index: number, text: string): string`**
* **`browser_scroll(direction?: "up" | "down"): string`** ([docs.browser-use.com][1])

### 📊 State & Content Tools

* **`browser_get_state(include_screenshot?: boolean): string`** → Returns JSON with URL, title, tabs, interactive elements, (optional) screenshot ([docs.browser-use.com][1])
* **`browser_extract_content(query: string, extract_links?: boolean): string`** → Requires `OPENAI_API_KEY` for AI-powered extraction ([docs.browser-use.com][1])

### 🗂 Tab Management Tools

* **`browser_list_tabs(): string`**
* **`browser_switch_tab(tab_index: number): string`**
* **`browser_close_tab(tab_index: number): string`** ([docs.browser-use.com][1])

### 🔙 Tool Response Format

* Returns plain text (success or error prefixed with `"Error:"`)&#x20;

---

## ⚙️ 5. Configuration

### 🔧 Environment Variables

* Add to MCP server config:

  * `OPENAI_API_KEY` – needed for `browser_extract_content` API
* You can launch server using CLI or Python:

```json
"command": "python",
"args": ["-m", "browser_use.mcp.server"],
```

### 🌐 Browser Profile Defaults

Default server settings:

* Downloads path: `~/Downloads/browser-use-mcp/`
* Wait between actions: 0.5 s
* Keeps browser alive by default
* All domains allowed by default ([docs.browser-use.com][1])

---

## 🧪 6. Advanced Usage

### ▶️ Run Standalone

```bash
uvx browser-use --mcp
```

* Serves JSON-RPC over stdio — test without Claude Desktop ([docs.browser-use.com][1])

---

## 🔐 7. Security Considerations

* **Full browser control** – exercise caution
* **Domain restrictions**: None by default (not configurable via env)
* File storage created at `~/.browser-use-mcp`
* Downloads saved under `~/Downloads/browser-use-mcp/` ([docs.browser-use.com][1])

---

## 🛠 8. Implementation Details

* **Lazy initialization** – session starts on first tool call
* **Persistent single session** per server
* **Errors**: All exceptions serialized as `"Error: ..."` ([docs.browser-use.com][1])

---

## 🛑 9. Troubleshooting

### 🧾 Server Not Appearing in Claude

* Ensure correct config path per OS
* Test server:

````bash
uvx browser-use --version
uvx browser-use --mcp --help
``` :contentReference[oaicite:52]{index=52}

- Check logs:  
  - macOS: `~/Library/Logs/Claude/mcp.log`  
  - Windows: `%APPDATA%\Claude\logs\mcp.log` :contentReference[oaicite:53]{index=53}

### 🚫 Browser Not Launching

```bash
playwright install chromium
python -c "from browser_use import BrowserSession; import asyncio; asyncio.run(BrowserSession().start())"
``` :contentReference[oaicite:54]{index=54}

### 🔌 Connection Errors

- Confirm server is running & Python environment correct :contentReference[oaicite:55]{index=55}

### 🔍 Content Extraction Failures

- Check `OPENAI_API_KEY` is set and valid; sufficient credits. :contentReference[oaicite:56]{index=56}

---

## ⚠️ 10. Limitations

| Limitation              | Description                                | Workaround                   |
|-------------------------|--------------------------------------------|------------------------------|
| Single browser session  | One session per server instance            | Restart server if needed     |
| Domain config           | No domain restriction via env              | Modify server code           |
| No agent tasks          | `browser_use_run_task` currently disabled  | Use direct browser_* tools   |
| JSON-only responses     | Returns text → client must parse further   | Parse JSON client-side       | :contentReference[oaicite:57]{index=57}

---

## 📊 11. Comparison with MCP Client

- **MCP Server**: Exposes browser to external AI (e.g., Claude)  
- **MCP Client**: Lets Browser‑Use connect to other MCP servers  
- Configuration: JSON vs Python  
- Toolsets: Fixed browser tools vs dynamic from server :contentReference[oaicite:58]{index=58}

---

## 💻 12. Code Examples

- Simple and advanced MCP client examples are provided in docs  
- Walkthroughs for JSON‑RPC integration and multi‑server orchestration :contentReference[oaicite:59]{index=59}

---

## 🔗 Related Docs

- MCP Client  
- Model Context Protocol spec  
- Claude Desktop integration

---

This markdown reflects a comprehensive summary of the MCP server docs. Let me know if you'd like code snippets, MCP Client comparisons, or help configuring a real project!
::contentReference[oaicite:60]{index=60}
````

[1]: https://docs.browser-use.com/customize/mcp-server?utm_source=chatgpt.com "MCP Server - Browser Use"

# Report

## Introduction
- This document provides an overview of the Browser Use tool, detailing various methods for launching and connecting to browsers.
- It highlights core functionalities, security considerations, and best practices for effective browser management.

## Section 1: Overview of Connection Methods
- Browser Use supports multiple methods for launching or connecting to a browser:
- **Method A**: Launch a new local browser using Playwright/Patchright Chromium by specifying an `executable_path`.
- **Method B**: Connect using existing Playwright objects like `Page`, `Browser`, or `BrowserContext`.
- **Method C**: Connect to a local browser already running using its process ID (`browser_pid`).
- **Method D**: Connect to a remote Playwright Node.js Browser Server via WSS URL.
- **Method E**: Connect to any remote Chromium-based browser using a CDP URL.

## Section 2: Detailed Connection Methods
- **Method A: Launch a New Local Browser (Default)**
- Launches a local browser using the built-in default or a specified executable path.
- Example code:
  ```python
  from browser_use import Agent, BrowserSession
  
  browser_session = BrowserSession(
      executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      user_data_dir='~/.config/browseruse/profiles/default',
  )
  
  agent = Agent(
      task="Your task here",
      llm=llm,
      browser_session=browser_session,
  )
  ```
- Supports various Chromium-based browsers including Brave, Edge, and others, but not Firefox or Safari.

- **Method B: Connect Using Existing Playwright Objects**
- Allows passing existing Playwright objects to `BrowserSession`.
- Example code:
  ```python
  from browser_use import Agent, BrowserSession
  from playwright.async_api import async_playwright
  
  async with async_playwright() as playwright:
      browser = await playwright.chromium.launch()
      context = await browser.new_context()
      page = await context.new_page()
      
      browser_session = BrowserSession(page=page)
      
      agent = Agent(
          task="Your task here",
          llm=llm,
          browser_session=browser_session,
      )
  ```

- **Method C: Connect to Local Browser Using Browser PID**
- Connects to an already running browser with remote debugging enabled.
- Example code:
  ```python
  from browser_use import Agent, BrowserSession
  
  browser_session = BrowserSession(browser_pid=12345)  # Replace with actual PID
  
  agent = Agent(
      task="Your task here",
      llm=llm,
      browser_session=browser_session,
  )
  ```

- **Method D: Connect to Remote Playwright Node.js Browser Server via WSS URL**
- Example code:
  ```python
  from browser_use import Agent, BrowserSession
  
  browser_session = BrowserSession(wss_url="wss://your-playwright-server.com/ws")
  
  agent = Agent(
      task="Your task here",
      llm=llm,
      browser_session=browser_session,
  )
  ```

- **Method E: Connect to Remote Browser via CDP URL**
- Example code:
  ```python
  from browser_use import Agent, BrowserSession
  
  browser_session = BrowserSession(cdp_url="http://localhost:9222")
  
  agent = Agent(
      task="Your task here",
      llm=llm,
      browser_session=browser_session,
  )
  ```

## Section 3: Security Considerations and Best Practices
- **Security Considerations**:
- Agents have access to logged-in sessions, cookies, and browser history.
- Recommended to use `Agent(sensitive_data={...})` for sensitive information.

- **Best Practices**:
1. **Use isolated profiles** to limit risk exposure.
2. **Limit domain access** to restrict the sites agents can visit.
3. **Enable `keep_alive=True`** to share a single `BrowserSession` among multiple agents.

## Section 4: Re-Using a Browser
- A `BrowserSession` can be reused across multiple agents, allowing for efficient resource management.
- Sequential agents can share the same `user_data_dir`, while parallel agents must use separate sessions.
- Example of re-using a session:
  ```python
  reused_session = BrowserSession(user_data_dir='~/.config/browseruse/profiles/default', keep_alive=True)
  await reused_session.start()
  
  agent1 = Agent(task="The first task...", browser_session=reused_session)
  await agent1.run()
  
  agent2 = Agent(task="The second task...", browser_session=reused_session)
  await agent2.run()
  
  await reused_session.close()
  ```

## Section 5: Troubleshooting
- Common issues include Chrome connection failures, profile locks, and version compatibility.
- Recommended steps:
1. Close all Chrome instances if facing connection issues.
2. Verify the executable path and profile permissions.
3. Ensure the browser version is compatible with the `user_data_dir`.

## Conclusion
- The document outlines the capabilities of Browser Use, emphasizing its flexibility in connecting to various browser environments.
- It provides essential guidelines for secure and effective browser management, ensuring users can leverage the tool's full potential.

# Report on CDP Connection in Browser Use

## Introduction
- The Chrome DevTools Protocol (CDP) allows for direct communication with a Chromium-based browser, enabling automation and debugging capabilities.
- This report details the process and considerations for establishing a CDP connection using the Browser Use tool, as outlined in the documentation and the associated GitHub repository.

## Section 1: Overview of CDP Connection
- CDP is a set of APIs that allow developers to control and inspect web browsers.
- Browser Use enables users to connect to any remote Chromium-based browser via a CDP URL, facilitating tasks such as automated testing, scraping, and debugging.

## Section 2: Setting Up CDP Connection
### Prerequisites
- Ensure that the Chromium-based browser is running with the `--remote-debugging-port` option enabled. For example, start Chrome with:
```bash
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222
```
- Verify that the browser is accessible at the specified port.

### Example Code for CDP Connection
- The following Python code demonstrates how to connect to a remote browser using CDP with Browser Use:
```python
from browser_use import Agent, BrowserSession

# Connect to the remote browser via CDP URL
browser_session = BrowserSession(cdp_url="http://localhost:9222")

agent = Agent(
    task="Your task here",
    llm=llm,
    browser_session=browser_session,
)
```
- In this example, replace `"http://localhost:9222"` with the actual URL of the remote browser instance.

## Section 3: Key Features of CDP Connection
- **Real-time Interaction**: CDP allows for real-time interaction with the browser, enabling actions like navigating to URLs, taking screenshots, and manipulating the DOM.
- **Event Listening**: Users can listen for various events emitted by the browser, such as network requests, console messages, and page loads.
- **Performance Monitoring**: CDP provides metrics related to performance, allowing users to optimize their web applications.

## Section 4: Security Considerations
- When using CDP, be cautious about exposing the remote debugging port to untrusted networks, as it can allow unauthorized access to the browser.
- Use firewall rules or VPNs to restrict access to the debugging port.

## Section 5: Troubleshooting CDP Connections
- **Connection Issues**: If unable to connect, ensure that:
- The browser is running with the correct debugging port.
- No other application is using the same port.
- Network configurations (firewalls, proxies) are not blocking the connection.

- **Profile Lock Issues**: If you encounter a "profile is already in use" error:
- Close all instances of the browser.
- Ensure that the profile is not locked by another process.

## Section 6: Practical Use Cases
- **Automated Testing**: Use CDP to run automated tests on web applications by simulating user interactions.
- **Web Scraping**: Gather data from web pages by navigating and extracting information programmatically.
- **Debugging**: Inspect and debug web applications in real time, using the console and network tools provided by CDP.

## Conclusion
- The CDP connection feature in Browser Use provides powerful capabilities for browser automation and debugging.
- By following the setup instructions and best practices outlined in this report, users can effectively leverage CDP for various web development tasks.
- For further details, users are encouraged to refer to the [Browser Use documentation](https://docs.browser-use.com/) and the [GitHub repository](https://github.com/browser-use/browser-use) for examples and updates.