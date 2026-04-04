# cursor-bridge

OpenAI-compatible proxy that routes requests through Cursor Agent CLI.
Use Cursor's subscription plan as a model provider in openclaw.

## How it works

```
openclaw / any client → http://127.0.0.1:18800/v1/chat/completions → cursor agent -p → Cursor subscription
```

## Quick Start

```bash
# Start the proxy
node server.js

# Test it
curl http://127.0.0.1:18800/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"cursor-composer-2","messages":[{"role":"user","content":"hello"}]}'
```

## Available Models

| Model ID | Maps to |
|----------|---------|
| `cursor-composer-2` | Composer 2 (default) |
| `cursor-composer-2-fast` | Composer 2 Fast |
| `cursor-sonnet-4` | Sonnet 4 |
| `cursor-sonnet-4-thinking` | Sonnet 4 Thinking |
| `cursor-gpt-4o` | GPT-4o |
| `cursor-gpt-5` | GPT-5 |
| `cursor-o3` | o3 |
| `cursor-gemini-2.5-pro` | Gemini 2.5 Pro |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CURSOR_BRIDGE_PORT` | `18800` | Proxy listen port |
| `CURSOR_BRIDGE_MODEL` | _(empty = Composer 2)_ | Default model |
| `CURSOR_BRIDGE_BIN` | `cursor` | Path to cursor CLI |
| `CURSOR_BRIDGE_TIMEOUT` | `120000` | Request timeout (ms) |

## OpenClaw Plugin

### Install

```bash
# From the repo directory
openclaw plugins install --source path --source-path /path/to/cursor-bridge
```

### Configure (`openclaw.json`)

```json
{
  "plugins": {
    "entries": {
      "cursor-bridge": {
        "enabled": true,
        "config": {
          "port": 18800
        }
      }
    }
  }
}
```

### Use as model provider

Set the OpenAI-compatible base URL in your agent config:

```json
{
  "agents": {
    "model": "cursor-composer-2",
    "providers": {
      "cursor": {
        "baseUrl": "http://127.0.0.1:18800/v1",
        "apiKey": "not-needed"
      }
    }
  }
}
```

## Prerequisites

- Node.js >= 18
- Cursor CLI installed and authenticated (`cursor agent login`)

## License

MIT
