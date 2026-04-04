#!/bin/bash
# cursor-bridge model switcher for openclaw
# Usage:
#   ./switch-model.sh cursor    — switch to Cursor Bridge (port 18800)
#   ./switch-model.sh claude    — switch to Claude Code CLI bridge (port 18801)
#   ./switch-model.sh anthropic — switch back to Anthropic OAuth (direct)
#   ./switch-model.sh status    — show current config
#
# Strategy: Use models.providers to register bridge servers as custom
# OpenAI-completions providers with their own baseUrl.

set -euo pipefail
CONFIG="$HOME/.openclaw/openclaw.json"
BACKUP_DIR="$HOME/.openclaw/cursor-bridge-backup"

case "${1:-status}" in
  cursor)
    mkdir -p "$BACKUP_DIR"
    cp "$CONFIG" "$BACKUP_DIR/openclaw.json.pre-switch"
    echo "Backup saved to $BACKUP_DIR/openclaw.json.pre-switch"

    python3 -c "
import json

with open('$CONFIG') as f:
    d = json.load(f)

# Add cursor-bridge to models.providers
models_section = d.setdefault('models', {})
providers = models_section.setdefault('providers', {})
providers['cursor-bridge'] = {
    'baseUrl': 'http://127.0.0.1:18800/v1',
    'apiKey': 'not-needed',
    'api': 'openai-completions',
    'models': [
        {
            'id': 'cursor-composer-2-fast',
            'name': 'Cursor Composer 2 Fast',
            'input': ['text'],
            'contextWindow': 200000,
            'maxTokens': 16384,
            'compat': {
                'supportsTools': True,
                'supportsUsageInStreaming': True,
                'maxTokensField': 'max_tokens'
            }
        },
        {
            'id': 'cursor-sonnet-4',
            'name': 'Cursor Sonnet 4',
            'input': ['text'],
            'contextWindow': 200000,
            'maxTokens': 16384,
            'compat': {
                'supportsTools': True,
                'supportsUsageInStreaming': True,
                'maxTokensField': 'max_tokens'
            }
        }
    ]
}

# Switch default model
defaults = d['agents']['defaults']
defaults['model'] = {
    'primary': 'cursor-bridge/cursor-composer-2-fast',
    'fallbacks': ['anthropic/claude-haiku-4-5']
}

# Add to agent models
agent_models = defaults.setdefault('models', {})
agent_models['cursor-bridge/cursor-composer-2-fast'] = {
    'alias': 'cursor',
    'params': {}
}

# Update mini-bal
for agent in d['agents']['list']:
    if agent['id'] == 'mini-bal':
        agent['model'] = {'primary': 'cursor-bridge/cursor-composer-2-fast'}

with open('$CONFIG', 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)

print('Switched to cursor-bridge/cursor-composer-2-fast')
print('Fallback: anthropic/claude-haiku-4-5')
print()
print('Make sure cursor-bridge is running: node ~/cli-bridge/server.js')
print('Then restart gateway: openclaw gateway start')
"
    ;;

  claude)
    mkdir -p "$BACKUP_DIR"
    cp "$CONFIG" "$BACKUP_DIR/openclaw.json.pre-switch"
    echo "Backup saved to $BACKUP_DIR/openclaw.json.pre-switch"

    python3 -c "
import json

with open('$CONFIG') as f:
    d = json.load(f)

# Add claude-bridge to models.providers
models_section = d.setdefault('models', {})
providers = models_section.setdefault('providers', {})
providers['claude-bridge'] = {
    'baseUrl': 'http://127.0.0.1:18801/v1',
    'apiKey': 'not-needed',
    'api': 'openai-completions',
    'models': [
        {
            'id': 'claude-sonnet',
            'name': 'Claude Sonnet (via CLI)',
            'input': ['text'],
            'contextWindow': 200000,
            'maxTokens': 16384,
            'compat': {
                'supportsTools': True,
                'supportsUsageInStreaming': True,
                'maxTokensField': 'max_tokens'
            }
        },
        {
            'id': 'claude-opus',
            'name': 'Claude Opus (via CLI)',
            'input': ['text'],
            'contextWindow': 200000,
            'maxTokens': 16384,
            'compat': {
                'supportsTools': True,
                'supportsUsageInStreaming': True,
                'maxTokensField': 'max_tokens'
            }
        },
        {
            'id': 'claude-haiku',
            'name': 'Claude Haiku (via CLI)',
            'input': ['text'],
            'contextWindow': 200000,
            'maxTokens': 16384,
            'compat': {
                'supportsTools': True,
                'supportsUsageInStreaming': True,
                'maxTokensField': 'max_tokens'
            }
        }
    ]
}

# Switch default model
defaults = d['agents']['defaults']
defaults['model'] = {
    'primary': 'claude-bridge/claude-sonnet',
    'fallbacks': ['claude-bridge/claude-haiku']
}

# Add to agent models
agent_models = defaults.setdefault('models', {})
agent_models['claude-bridge/claude-sonnet'] = {
    'alias': 'cc-sonnet',
    'params': {}
}

# Update mini-bal
for agent in d['agents']['list']:
    if agent['id'] == 'mini-bal':
        agent['model'] = {'primary': 'claude-bridge/claude-sonnet'}

with open('$CONFIG', 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)

print('Switched to claude-bridge/claude-sonnet (via Claude Code CLI)')
print('Fallback: claude-bridge/claude-haiku')
print()
print('Make sure claude-bridge is running: node ~/cli-bridge/claude-server.js')
print('Then restart gateway: openclaw gateway start')
"
    ;;

  anthropic)
    if [ -f "$BACKUP_DIR/openclaw.json.pre-switch" ]; then
      cp "$BACKUP_DIR/openclaw.json.pre-switch" "$CONFIG"
      echo "Restored from backup"
    else
      echo "No backup found. Manually restoring defaults."
      python3 -c "
import json

with open('$CONFIG') as f:
    d = json.load(f)

defaults = d['agents']['defaults']
defaults['model'] = {
    'primary': 'anthropic/claude-sonnet-4-6',
    'fallbacks': ['anthropic/claude-haiku-4-5']
}

models = defaults.get('models', {})
models.pop('cursor-bridge/cursor-composer-2-fast', None)
models.pop('claude-bridge/claude-sonnet', None)

d.get('models', {}).get('providers', {}).pop('cursor-bridge', None)
d.get('models', {}).get('providers', {}).pop('claude-bridge', None)

for agent in d['agents']['list']:
    if agent['id'] == 'mini-bal':
        agent['model'] = {'primary': 'anthropic/claude-sonnet-4-6'}

with open('$CONFIG', 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
print('Restored to Anthropic defaults')
"
    fi
    echo ""
    echo "Switched back to Anthropic OAuth (claude-sonnet-4-6)"
    echo "Run: openclaw gateway start"
    ;;

  status)
    python3 -c "
import json, os

with open('$CONFIG') as f:
    d = json.load(f)

defaults = d.get('agents', {}).get('defaults', {})
model = defaults.get('model', {})
providers = d.get('models', {}).get('providers', {})

primary = model.get('primary', '(not set)')
if 'cursor-bridge' in primary:
    mode = 'CURSOR BRIDGE'
elif 'claude-bridge' in primary:
    mode = 'CLAUDE CODE CLI'
else:
    mode = 'ANTHROPIC (direct)'

print('=== Model Config ===')
print(f'Primary: {primary}')
print(f'Fallbacks: {model.get(\"fallbacks\", [])}')
print()
print(f'=== Routing ===')
print(f'Mode: {mode}')
for name in ['cursor-bridge', 'claude-bridge']:
    if name in providers:
        p = providers[name]
        print(f'{name}: {p.get(\"baseUrl\")} ({[m[\"id\"] for m in p.get(\"models\", [])]})')
print()
print('=== Agents ===')
for agent in d.get('agents', {}).get('list', []):
    print(f'{agent[\"id\"]}: {agent.get(\"model\", {}).get(\"primary\", \"(default)\")}')
print()
backup = os.path.exists('$BACKUP_DIR/openclaw.json.pre-switch')
print(f'Backup: {\"available\" if backup else \"none\"}')
"
    ;;

  *)
    echo "Usage: $0 {cursor|claude|anthropic|status}"
    exit 1
    ;;
esac
