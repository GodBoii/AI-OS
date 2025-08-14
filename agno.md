---

# Agno: A Lightweight Library for Building Multimodal Agents

Agno is a powerful, open-source toolkit designed to make it easy to build intelligent agents that can process, understand, and generate content across multiple media types. It exposes large language models (LLMs) as a unified API while empowering them with “superpowers” such as memory, knowledge, reasoning, and tool integration.

Agno’s design is:
- **Lightweight & Fast:** Instantiates agents in microseconds and uses minimal memory.
- **Model Agnostic:** Works seamlessly with any LLM provider (e.g., OpenAI, Groq, Gemini).
- **Multimodal:** Natively supports inputs and outputs for text, images, audio, and video.
- **Extensible:** Easily add custom tools for domain-specific tasks.
- **Collaborative:** Enables building teams of specialized agents to solve complex workflows.

---

## Table of Contents

1. [Installation](#installation)
2. [Getting Started](#getting-started)
3. [Multimodal Functionality](#multimodal-functionality)
   - [Multimodal Inputs to an Agent](#multimodal-inputs-to-an-agent)
     - [Image Input](#image-input)
     - [Audio Input](#audio-input)
     - [Video Input](#video-input)
   - [Multimodal Outputs from an Agent](#multimodal-outputs-from-an-agent)
     - [Image Generation](#image-generation)
     - [Audio Response](#audio-response)
   - [Combined Multimodal Workflows](#combined-multimodal-workflows)
4. [Advanced Features](#advanced-features)
   - [Memory & Knowledge Integration](#memory--knowledge-integration)
   - [Multi-Agent Teams](#multi-agent-teams)
5. [Troubleshooting & Best Practices](#troubleshooting--best-practices)
6. [Conclusion](#conclusion)

---

## Installation

Agno can be installed directly via pip. It is compatible with multiple backends and toolkits.

```bash
pip install -U agno
pip install -U duckduckgo-search
# For OpenAI-based models, ensure you also have the OpenAI package:
pip install openai
```

> **Note:** Set your required API keys (e.g., `OPENAI_API_KEY` or `GROQ_API_KEY`) in your environment.

---

## Getting Started

Here’s a simple example of creating a basic agent:

```python
from agno.agent import Agent
from agno.models.openai import OpenAIChat

agent = Agent(
    model=OpenAIChat(id="gpt-4o"),
    description="You are an enthusiastic news reporter with a flair for storytelling!",
    markdown=True
)
agent.print_response("Tell me about breaking news in New York.", stream=True)
```

This snippet initializes an agent with GPT-4 and prints its response in markdown format.

---

## Multimodal Functionality

Agno excels in handling diverse media inputs and outputs. Let’s explore how Agno handles multimodality in detail.

### Multimodal Inputs to an Agent

Agno agents can seamlessly receive and process different forms of data:

#### Image Input

You can create an agent that understands image inputs by passing image data wrapped in Agno’s `Image` class. Below is an example of an image agent that processes an image URL:

```python
from agno.agent import Agent
from agno.media import Image
from agno.models.openai import OpenAIChat
from agno.tools.duckduckgo import DuckDuckGoTools

agent = Agent(
    model=OpenAIChat(id="gpt-4o"),
    tools=[DuckDuckGoTools()],
    markdown=True
)

agent.print_response(
    "Tell me about this image and give me the latest news about it.",
    images=[
        Image(url="https://upload.wikimedia.org/wikipedia/commons/0/0c/GoldenGateBridge-001.jpg")
    ],
    stream=True,
)
```

*Explanation:*  
The agent receives an image of the Golden Gate Bridge. Using its multimodal capability, it can interpret the visual data and leverage tools (like web search) to enhance its response.

---

#### Audio Input

Agents can process audio by wrapping audio data using the `Audio` class. Here’s how you can build an audio agent:

```python
import requests
from agno.agent import Agent
from agno.media import Audio
from agno.models.openai import OpenAIChat

# Fetch an audio file (WAV format) from the internet.
url = "https://openaiassets.blob.core.windows.net/$web/API/docs/audio/alloy.wav"
response = requests.get(url)
wav_data = response.content

agent = Agent(
    model=OpenAIChat(id="gpt-4o-audio-preview", modalities=["text"]),
    markdown=True,
)

agent.print_response(
    "What is in this audio?",
    audio=[Audio(content=wav_data, format="wav")]
)
```

*Explanation:*  
The agent downloads an audio file, wraps it in an `Audio` object, and then processes the query “What is in this audio?”. It returns a textual interpretation of the audio input.

---

#### Video Input

Currently, Agno supports video inputs for models specifically built to handle video (e.g., Gemini models). An example of a video agent is shown below:

```python
from pathlib import Path
from agno.agent import Agent
from agno.media import Video
from agno.models.google import Gemini

agent = Agent(
    model=Gemini(id="gemini-2.0-flash-exp"),
    markdown=True,
)

video_path = Path("GreatRedSpot.mp4")
if video_path.exists():
    agent.print_response("Tell me about this video", videos=[Video(filepath=video_path)])
else:
    print(f"Video file not found at: {video_path}")
```

*Explanation:*  
This agent processes a video file (“GreatRedSpot.mp4”) using a Gemini-based model, allowing it to analyze and comment on video content.

---

### Multimodal Outputs from an Agent

Agno can also generate outputs in different modalities:

#### Image Generation

By integrating tools like DALL-E, Agno can generate images based on user prompts:

```python
from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools.dalle import DalleTools

image_agent = Agent(
    model=OpenAIChat(id="gpt-4o"),
    tools=[DalleTools()],
    description="You are an AI agent that can generate images using DALL-E.",
    instructions="When the user asks you to create an image, use the `create_image` tool.",
    markdown=True,
    show_tool_calls=True,
)

image_agent.print_response("Generate an image of a white siamese cat")
images = image_agent.get_images()
if images:
    for image_response in images:
        print("Generated Image URL:", image_response.url)
```

*Explanation:*  
The agent uses the DALL-E integration to generate an image of a white siamese cat. The image URL is then retrieved and printed.

---

#### Audio Response

Agents can also produce audio responses. For example, generating a short audio clip paired with text:

```python
from agno.agent import Agent, RunResponse
from agno.models.openai import OpenAIChat
from agno.utils.audio import write_audio_to_file

agent = Agent(
    model=OpenAIChat(
        id="gpt-4o-audio-preview",
        modalities=["text", "audio"],
        audio={"voice": "alloy", "format": "wav"}
    ),
    markdown=True,
)

response: RunResponse = agent.run("Tell me a 5 second scary story")
if response.response_audio:
    write_audio_to_file(
        audio=response.response_audio.content,
        filename="scary_story.wav"
    )
```

*Explanation:*  
In this example, the agent generates a 5-second scary story. In addition to text, it outputs an audio clip (using a specified voice and WAV format) that is saved to a file.

---

### Combined Multimodal Workflows

Agno allows agents to process multiple modalities simultaneously, both as inputs and outputs. For instance, you can pass both text and audio to an agent and receive outputs that include processed text and generated audio.

```python
import requests
from pathlib import Path
from agno.agent import Agent
from agno.media import Audio
from agno.models.openai import OpenAIChat
from agno.utils.audio import write_audio_to_file

url = "https://openaiassets.blob.core.windows.net/$web/API/docs/audio/alloy.wav"
response = requests.get(url)
wav_data = response.content

agent = Agent(
    model=OpenAIChat(
        id="gpt-4o-audio-preview",
        modalities=["text", "audio"],
        audio={"voice": "alloy", "format": "wav"}
    ),
    markdown=True,
)

run_response = agent.run("What's in this recording?", audio=[Audio(content=wav_data, format="wav")])
if run_response.response_audio:
    output_file = Path("result.wav")
    write_audio_to_file(
        audio=run_response.response_audio.content,
        filename=str(output_file)
    )
    print("Response audio saved to:", output_file)
if run_response.content:
    print("Text response:\n", run_response.content)
```

*Explanation:*  
This combined example processes an audio input with a text prompt and outputs both an audio response (saved to file) and a text message, demonstrating the power of Agno’s multimodal workflows.

---

## Advanced Features

### Memory & Knowledge Integration

Beyond multimodal support, Agno provides robust features like:
- **Memory Management:** Maintain session history and contextual memory to support long-running conversations.
- **Knowledge Stores:** Integrate with vector databases (e.g., PgVector, LanceDb) to retrieve relevant documents during agent operation. This is particularly useful for retrieval-augmented generation (RAG).

### Multi-Agent Teams

Agno supports building teams of specialized agents. This lets multiple agents work collaboratively—for example, one can handle web searches while another manages financial data, and a team agent fuses responses for comprehensive answers.

```python
from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools.duckduckgo import DuckDuckGoTools
from agno.tools.yfinance import YFinanceTools

web_agent = Agent(
    name="Web Agent",
    role="Search the web for information",
    model=OpenAIChat(id="gpt-4o"),
    tools=[DuckDuckGoTools()],
    instructions="Always include sources",
    markdown=True,
)

finance_agent = Agent(
    name="Finance Agent",
    role="Get financial data",
    model=OpenAIChat(id="gpt-4o"),
    tools=[YFinanceTools()],
    instructions="Use tables to display data",
    markdown=True,
)

agent_team = Agent(
    team=[web_agent, finance_agent],
    model=OpenAIChat(id="gpt-4o"),
    instructions=["Always include sources", "Use tables to display data"],
    markdown=True,
)
agent_team.print_response("What's the market outlook of AI semiconductor companies?", stream=True)
```

*Explanation:*  
This code illustrates how to compose a team of agents, each handling different tasks, to deliver a combined and enriched answer.

---

## Troubleshooting & Best Practices

- **Debugging:** Use `debug_mode=True` during development to print internal logs (system prompts, tool calls, and reasoning steps).
- **Tool Validation:** Ensure your custom tools correctly parse input queries (e.g., regex for tracking IDs or route instructions).
- **Environment Configuration:** Verify all required API keys and dependencies are installed before running agents.
- **Scaling:** For production usage, containerize your agent (e.g., using Docker) and use persistent memory storage (such as PostgreSQL with vector stores) for session management.
- **Monitoring:** Leverage Agno’s real-time dashboards to monitor agent performance and resource usage.

---

## Conclusion

Agno is a versatile and efficient framework that powers multimodal AI agents. Its native support for text, image, audio, and video inputs and outputs—combined with fast instantiation, minimal memory footprint, and robust extensibility—makes it an ideal choice for developers looking to deploy intelligent, collaborative agents across a wide range of applications.

Explore Agno’s documentation further at [docs.agno.com](https://docs.agno.com) and contribute to the growing open-source community to build next-generation multimodal AI solutions.

---
