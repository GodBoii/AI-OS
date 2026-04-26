# API Reference

Complete reference for Aetheria AI's REST API and WebSocket events.

---

## Base URL

```
Development: http://localhost:8765
Production: https://your-domain.com
```

---

## Authentication

All API requests require authentication using Supabase JWT tokens.

### Headers

```http
Authorization: Bearer <supabase_jwt_token>
Content-Type: application/json
```

### Getting a Token

```javascript
// Frontend (Supabase client)
const { data: { session } } = await supabase.auth.getSession();
const token = session.access_token;

// Use in requests
fetch('/api/endpoint', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

---

## REST API Endpoints

### Health Check

**GET** `/health`

Check if the backend is running.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-04-18T12:00:00Z"
}
```

---

### Session Management

#### List Sessions

**GET** `/api/sessions`

Get all sessions for the authenticated user.

**Query Parameters:**
- `limit` (optional): Number of sessions to return (default: 50)
- `offset` (optional): Pagination offset (default: 0)

**Response:**
```json
{
  "sessions": [
    {
      "id": "session_123",
      "title": "Building a React App",
      "created_at": "2026-04-18T10:00:00Z",
      "updated_at": "2026-04-18T12:00:00Z",
      "message_count": 15
    }
  ],
  "total": 42
}
```

#### Get Session Details

**GET** `/api/sessions/<session_id>`

Get details of a specific session.

**Response:**
```json
{
  "id": "session_123",
  "title": "Building a React App",
  "created_at": "2026-04-18T10:00:00Z",
  "updated_at": "2026-04-18T12:00:00Z",
  "messages": [
    {
      "id": "msg_1",
      "role": "user",
      "content": "Create a React app",
      "timestamp": "2026-04-18T10:00:00Z"
    },
    {
      "id": "msg_2",
      "role": "assistant",
      "content": "I'll create a React app for you...",
      "timestamp": "2026-04-18T10:00:15Z"
    }
  ]
}
```

#### Delete Session

**DELETE** `/api/sessions/<session_id>`

Delete a session and all its messages.

**Response:**
```json
{
  "success": true,
  "message": "Session deleted successfully"
}
```

---

### File Operations

#### List Sandbox Files

**POST** `/api/project/workspace/tree`

List files in the sandbox workspace.

**Request Body:**
```json
{
  "session_id": "session_123",
  "path": "/home/sandboxuser/workspace"
}
```

**Response:**
```json
{
  "files": [
    {
      "name": "app.py",
      "type": "file",
      "size": 1024,
      "modified": "2026-04-18T12:00:00Z"
    },
    {
      "name": "src",
      "type": "directory",
      "children": []
    }
  ]
}
```

#### Read Sandbox File

**POST** `/api/project/workspace/file-content`

Read content of a file in the sandbox.

**Request Body:**
```json
{
  "session_id": "session_123",
  "file_path": "/home/sandboxuser/workspace/app.py"
}
```

**Response:**
```json
{
  "content": "from flask import Flask\n\napp = Flask(__name__)\n...",
  "mime_type": "text/x-python",
  "size": 1024
}
```

#### List Deployed Files

**GET** `/api/deploy/files`

List files in a deployed project.

**Query Parameters:**
- `site_id`: Deployment site ID

**Response:**
```json
{
  "files": [
    {
      "path": "index.html",
      "size": 2048,
      "modified": "2026-04-18T12:00:00Z"
    },
    {
      "path": "css/style.css",
      "size": 1024,
      "modified": "2026-04-18T12:00:00Z"
    }
  ]
}
```

#### Read Deployed File

**GET** `/api/deploy/file-content`

Read content of a deployed file.

**Query Parameters:**
- `site_id`: Deployment site ID
- `file_path`: Path to file

**Response:**
```json
{
  "content": "<!DOCTYPE html>\n<html>...",
  "mime_type": "text/html",
  "size": 2048
}
```

---

### Deployment Management

#### List Deployments

**GET** `/api/deployments`

Get all deployments for the authenticated user.

**Response:**
```json
{
  "deployments": [
    {
      "id": "deploy_123",
      "site_id": "site_abc",
      "name": "My React App",
      "url": "https://my-app.vercel.app",
      "platform": "vercel",
      "status": "active",
      "created_at": "2026-04-18T10:00:00Z"
    }
  ]
}
```

#### Get Deployment Details

**GET** `/api/deployments/<deployment_id>`

Get details of a specific deployment.

**Response:**
```json
{
  "id": "deploy_123",
  "site_id": "site_abc",
  "name": "My React App",
  "url": "https://my-app.vercel.app",
  "platform": "vercel",
  "status": "active",
  "created_at": "2026-04-18T10:00:00Z",
  "config": {
    "framework": "nextjs",
    "build_command": "npm run build",
    "output_directory": ".next"
  }
}
```

---

### Usage & Subscription

#### Get Current Usage

**GET** `/api/usage/current`

Get current usage statistics for the authenticated user.

**Response:**
```json
{
  "user_id": "user_123",
  "plan": "pro",
  "current_period": {
    "start": "2026-04-01T00:00:00Z",
    "end": "2026-05-01T00:00:00Z"
  },
  "usage": {
    "input_tokens": 50000,
    "output_tokens": 30000,
    "total_tokens": 80000
  },
  "limits": {
    "input_tokens": 1000000,
    "output_tokens": 500000,
    "total_tokens": 1500000
  },
  "percentage_used": 5.33
}
```

#### Get Subscription Status

**GET** `/api/subscription/status`

Get subscription status for the authenticated user.

**Response:**
```json
{
  "user_id": "user_123",
  "plan_type": "pro",
  "status": "active",
  "current_period_start": "2026-04-01T00:00:00Z",
  "current_period_end": "2026-05-01T00:00:00Z",
  "cancel_at_period_end": false,
  "razorpay_subscription_id": "sub_abc123"
}
```

---

## WebSocket Events

### Connection

**Endpoint:** `/socket.io/`

**Connection:**
```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:8765', {
  auth: {
    token: supabaseToken
  }
});
```

---

### Client → Server Events

#### send_message

Send a message to the agent.

**Payload:**
```javascript
socket.emit('send_message', {
  message: "Create a React app",
  session_id: "session_123",
  agent_mode: "coder",  // or "computer", "default"
  attachments: [
    {
      file_id: "file_123",
      mime_type: "image/png",
      file_path: "path/to/file.png"
    }
  ],
  config: {
    internet_search: true,
    coding_assistant: true,
    enable_browser: true,
    enable_computer_control: false
  }
});
```

#### stop_agent

Stop the currently running agent.

**Payload:**
```javascript
socket.emit('stop_agent', {
  session_id: "session_123"
});
```

#### browser-response

Send browser command response (from client-side browser).

**Payload:**
```javascript
socket.emit('browser-response', {
  request_id: "req_123",
  status: "success",
  result: {
    // Command-specific result
  }
});
```

#### computer-response

Send computer control response (from desktop client).

**Payload:**
```javascript
socket.emit('computer-response', {
  request_id: "req_123",
  status: "success",
  result: {
    // Command-specific result
  }
});
```

#### local-coder-response

Send local coder response (from desktop client).

**Payload:**
```javascript
socket.emit('local-coder-response', {
  request_id: "req_123",
  status: "success",
  result: {
    // Command-specific result
  }
});
```

---

### Server → Client Events

#### agent-thinking

Agent is processing the request.

**Payload:**
```javascript
{
  session_id: "session_123",
  message_id: "msg_123",
  thought: "I'll create a React app using create-react-app..."
}
```

#### tool-execution

Agent is executing a tool.

**Payload:**
```javascript
{
  session_id: "session_123",
  message_id: "msg_123",
  tool_name: "execute_in_sandbox",
  tool_args: {
    command: "npx create-react-app my-app"
  },
  status: "running"
}
```

#### tool-result

Tool execution completed.

**Payload:**
```javascript
{
  session_id: "session_123",
  message_id: "msg_123",
  tool_name: "execute_in_sandbox",
  result: {
    stdout: "Creating a new React app...",
    stderr: "",
    exit_code: 0
  },
  status: "success"
}
```

#### agent-response

Agent's final response.

**Payload:**
```javascript
{
  session_id: "session_123",
  message_id: "msg_123",
  content: "I've created a React app for you...",
  artifacts: [
    {
      type: "code",
      language: "javascript",
      content: "import React from 'react'..."
    }
  ]
}
```

#### agent-error

An error occurred during agent execution.

**Payload:**
```javascript
{
  session_id: "session_123",
  message_id: "msg_123",
  error: "Failed to execute command",
  details: "Command not found: npx"
}
```

#### agent-stream

Streaming response chunk.

**Payload:**
```javascript
{
  session_id: "session_123",
  message_id: "msg_123",
  chunk: "I've created",
  is_final: false
}
```

#### browser-command

Server requests browser action (to desktop client).

**Payload:**
```javascript
{
  request_id: "req_123",
  action: "navigate",
  url: "https://example.com"
}
```

#### computer-command

Server requests computer action (to desktop client).

**Payload:**
```javascript
{
  request_id: "req_123",
  action: "screenshot",
  params: {}
}
```

#### local-coder-command

Server requests local coder action (to desktop client).

**Payload:**
```javascript
{
  request_id: "req_123",
  action: "read_file",
  params: {
    path: "/path/to/file.js"
  }
}
```

---

## Error Codes

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 429 | Rate Limit Exceeded |
| 500 | Internal Server Error |
| 503 | Service Unavailable |

### Error Response Format

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Missing required field: session_id",
    "details": {
      "field": "session_id",
      "reason": "required"
    }
  }
}
```

### Common Error Codes

| Code | Description |
|------|-------------|
| `INVALID_REQUEST` | Request validation failed |
| `UNAUTHORIZED` | Authentication required |
| `FORBIDDEN` | Insufficient permissions |
| `NOT_FOUND` | Resource not found |
| `RATE_LIMIT_EXCEEDED` | Too many requests |
| `SANDBOX_ERROR` | Sandbox execution failed |
| `TOOL_ERROR` | Tool execution failed |
| `AGENT_ERROR` | Agent execution failed |

---

## Rate Limiting

### Limits

| Plan | Requests/Minute | Tokens/Day |
|------|----------------|------------|
| Free | 10 | 100,000 |
| Pro | 60 | 1,000,000 |
| Enterprise | Unlimited | Unlimited |

### Rate Limit Headers

```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1713441600
```

### Rate Limit Exceeded Response

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Try again in 30 seconds.",
    "retry_after": 30
  }
}
```

---

## Webhooks (Coming Soon)

### Event Types

- `session.created`
- `session.updated`
- `session.deleted`
- `deployment.created`
- `deployment.updated`
- `deployment.failed`
- `usage.limit_reached`

### Webhook Payload

```json
{
  "event": "deployment.created",
  "timestamp": "2026-04-18T12:00:00Z",
  "data": {
    "deployment_id": "deploy_123",
    "site_id": "site_abc",
    "url": "https://my-app.vercel.app"
  }
}
```

---

## SDK Examples

### JavaScript/TypeScript

```typescript
import { AetheriaClient } from '@aetheria/sdk';

const client = new AetheriaClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.aetheria.ai'
});

// Send a message
const response = await client.chat.send({
  message: 'Create a React app',
  sessionId: 'session_123'
});

// Listen for events
client.on('agent-response', (data) => {
  console.log('Agent:', data.content);
});
```

### Python

```python
from aetheria import AetheriaClient

client = AetheriaClient(
    api_key='your-api-key',
    base_url='https://api.aetheria.ai'
)

# Send a message
response = client.chat.send(
    message='Create a React app',
    session_id='session_123'
)

# Listen for events
@client.on('agent-response')
def handle_response(data):
    print('Agent:', data['content'])
```

---

## Best Practices

### 1. Authentication

- Always use HTTPS in production
- Store tokens securely
- Refresh tokens before expiry
- Never expose tokens in client-side code

### 2. Error Handling

```javascript
try {
  const response = await fetch('/api/sessions', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!response.ok) {
    const error = await response.json();
    console.error('API Error:', error);
    // Handle error appropriately
  }
  
  const data = await response.json();
  // Process data
} catch (error) {
  console.error('Network Error:', error);
  // Handle network error
}
```

### 3. WebSocket Reconnection

```javascript
socket.on('disconnect', () => {
  console.log('Disconnected, attempting to reconnect...');
  setTimeout(() => {
    socket.connect();
  }, 1000);
});
```

### 4. Rate Limiting

```javascript
// Implement exponential backoff
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (response.status === 429) {
        const retryAfter = response.headers.get('X-RateLimit-Reset');
        await sleep(retryAfter * 1000);
        continue;
      }
      
      return response;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(Math.pow(2, i) * 1000);
    }
  }
}
```

---

## Support

For API support:
- **Email**: aetheriaai1@gmail.com
- **GitHub Issues**: [Report API issues](https://github.com/GodBoii/AI-OS-website/issues)
- **Documentation**: [Full docs](README.md)

---

*Last Updated: April 18, 2026*
