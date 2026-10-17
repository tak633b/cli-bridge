# cli-bridge

OpenAI-compatible proxy that routes requests through CLI tools (Cursor Agent, Claude Code), enabling openclaw to use subscription plans as model providers.

## How it works

```
openclaw → localhost:18800 → cursor agent -p                        → Cursor subscription
openclaw → localhost:18801 → claude -p --model claude-sonnet-4-6    → Claude Code (1M context)
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
openclaw plugins install --source path --source-path /path/to/cli-bridge
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

## claude-bridge Models

| Model ID | Maps to | Context |
|----------|---------|---------|
| `claude-sonnet` | claude-sonnet-4-6 | 1M tokens |
| `claude-opus` | claude-opus-4-6 | 1M tokens |
| `claude-haiku` | claude-haiku-4-5-20251001 | 200K tokens |

## claude-bridge Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_BRIDGE_PORT` | `18801` | Proxy listen port |
| `CLAUDE_BRIDGE_MODEL` | `claude-sonnet-4-6` | Default model |
| `CLAUDE_BRIDGE_BIN` | `claude` | Path to claude CLI |
| `CLAUDE_BRIDGE_TIMEOUT` | `300000` | Request timeout (ms) |
| `CLAUDE_BRIDGE_POOL_SIZE` | `2` | Warm process pool size |

## Prerequisites

- Node.js >= 18
- Cursor CLI installed and authenticated (`cursor agent login`)
- Claude Code CLI installed and authenticated (`claude login`)

## License

MIT
