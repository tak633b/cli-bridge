#!/bin/bash
# cursor-bridge model switcher for openclaw
# Usage:
#   ./switch-model.sh cursor    — switch to Cursor Bridge
#   ./switch-model.sh anthropic — switch back to Anthropic OAuth
#   ./switch-model.sh status    — show current config
#
# Strategy: Use the built-in openai provider with OPENAI_BASE_URL override
# pointing to cursor-bridge proxy. Auth profile with dummy key.

set -euo pipefail
CONFIG="$HOME/.openclaw/openclaw.json"
AUTH_PROFILES="$HOME/.openclaw/agents/mini-bal/agent/auth-profiles.json"
BACKUP_DIR="$HOME/.openclaw/cursor-bridge-backup"

case "${1:-status}" in
  cursor)
    # 1. Backup current config
    mkdir -p "$BACKUP_DIR"
    cp "$CONFIG" "$BACKUP_DIR/openclaw.json.bak"
    cp "$AUTH_PROFILES" "$BACKUP_DIR/auth-profiles.json.bak"
    echo "Backup saved to $BACKUP_DIR/"

    # 2. Add openai auth profile with dummy key
    python3 -c "
import json

with open('$AUTH_PROFILES') as f:
    d = json.load(f)

d['profiles']['openai:cursor-bridge'] = {
    'type': 'api_key',
    'provider': 'openai',
    'key': 'not-needed-cursor-bridge'
}

with open('$AUTH_PROFILES', 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
print('Auth profile added: openai:cursor-bridge')
"

    # 3. Update openclaw.json: model + env
    python3 -c "
import json

with open('$CONFIG') as f:
    d = json.load(f)

defaults = d['agents']['defaults']

# Switch primary model to openai/gpt-4o (routed through cursor-bridge)
defaults['model'] = {
    'primary': 'openai/gpt-4o',
    'fallbacks': ['anthropic/claude-haiku-4-5']
}

# Add openai/gpt-4o to models if not present
models = defaults.setdefault('models', {})
models['openai/gpt-4o'] = {
    'alias': 'cursor',
    'params': {}
}

# Set OPENAI_BASE_URL to cursor-bridge in env
env = d.setdefault('env', {})
# Backup original OPENAI env vars
backup = {}
for key in ['OPENAI_BASE_URL', 'OPENAI_API_KEY']:
    if key in env:
        backup[key] = env[key]
if backup:
    env['_CURSOR_BRIDGE_ORIGINAL_ENV'] = json.dumps(backup)

env['OPENAI_BASE_URL'] = 'http://127.0.0.1:18800/v1'
env['OPENAI_API_KEY'] = 'not-needed-cursor-bridge'

# Update mini-bal agent
for agent in d['agents']['list']:
    if agent['id'] == 'mini-bal':
        agent['model'] = {'primary': 'openai/gpt-4o'}

with open('$CONFIG', 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)

print('Model: openai/gpt-4o → cursor-bridge (http://127.0.0.1:18800/v1)')
print('Fallback: anthropic/claude-haiku-4-5')
"
    echo ""
    echo "Run: openclaw gateway start"
    echo "Make sure cursor-bridge is running: node ~/cursor-bridge/server.js"
    ;;

  anthropic)
    if [ ! -f "$BACKUP_DIR/openclaw.json.bak" ]; then
      echo "No backup found. Restoring to default Anthropic config."
    fi

    # Restore from backup or set defaults
    if [ -f "$BACKUP_DIR/openclaw.json.bak" ]; then
      cp "$BACKUP_DIR/openclaw.json.bak" "$CONFIG"
      echo "Restored openclaw.json from backup"
    else
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
models.pop('openai/gpt-4o', None)

env = d.get('env', {})
env.pop('OPENAI_BASE_URL', None)
env.pop('_CURSOR_BRIDGE_ORIGINAL_ENV', None)
if env.get('OPENAI_API_KEY') == 'not-needed-cursor-bridge':
    env.pop('OPENAI_API_KEY', None)

for agent in d['agents']['list']:
    if agent['id'] == 'mini-bal':
        agent['model'] = {'primary': 'anthropic/claude-sonnet-4-6'}

with open('$CONFIG', 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
print('Restored to Anthropic defaults')
"
    fi

    if [ -f "$BACKUP_DIR/auth-profiles.json.bak" ]; then
      cp "$BACKUP_DIR/auth-profiles.json.bak" "$AUTH_PROFILES"
      echo "Restored auth-profiles from backup"
    else
      python3 -c "
import json
with open('$AUTH_PROFILES') as f:
    d = json.load(f)
d['profiles'].pop('openai:cursor-bridge', None)
with open('$AUTH_PROFILES', 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
print('Removed cursor-bridge auth profile')
"
    fi

    echo ""
    echo "Switched back to Anthropic OAuth (claude-sonnet-4-6)"
    echo "Run: openclaw gateway start"
    ;;

  status)
    python3 -c "
import json

with open('$CONFIG') as f:
    d = json.load(f)

defaults = d.get('agents', {}).get('defaults', {})
model = defaults.get('model', {})
env = d.get('env', {})

print('=== Model Config ===')
print(f'Primary: {model.get(\"primary\", \"(not set)\")}')
print(f'Fallbacks: {model.get(\"fallbacks\", [])}')

cursor_active = env.get('OPENAI_BASE_URL') == 'http://127.0.0.1:18800/v1'
print(f'')
print(f'=== Routing ===')
print(f'Mode: {\"CURSOR BRIDGE\" if cursor_active else \"ANTHROPIC (direct)\"}')
if cursor_active:
    print(f'OPENAI_BASE_URL: {env.get(\"OPENAI_BASE_URL\")}')

print(f'')
print(f'=== Agents ===')
for agent in d.get('agents', {}).get('list', []):
    print(f'{agent[\"id\"]}: {agent.get(\"model\", {}).get(\"primary\", \"(default)\")}')

import os
backup_exists = os.path.exists('$BACKUP_DIR/openclaw.json.bak')
print(f'')
print(f'Backup: {\"available\" if backup_exists else \"none\"}')
"
    ;;

  *)
    echo "Usage: $0 {cursor|anthropic|status}"
    exit 1
    ;;
esac
