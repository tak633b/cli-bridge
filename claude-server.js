#!/usr/bin/env node
'use strict';

const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');

// --- Configuration -----------------------------------------------------------

const PORT = parseInt(process.env.CLAUDE_BRIDGE_PORT || '18801', 10);
const DEFAULT_MODEL = process.env.CLAUDE_BRIDGE_MODEL || 'sonnet';
const CLAUDE_BIN = process.env.CLAUDE_BRIDGE_BIN || 'claude';
const REQUEST_TIMEOUT_MS = parseInt(process.env.CLAUDE_BRIDGE_TIMEOUT || '120000', 10);

const MODEL_MAP = {
  'claude-sonnet': 'sonnet',
  'claude-opus': 'opus',
  'claude-haiku': 'haiku',
};

// --- Helpers -----------------------------------------------------------------

function log(msg) {
  const ts = new Date().toISOString();
  process.stderr.write(`[${ts}] [claude-bridge] ${msg}\n`);
}

function messagesToPrompt(messages) {
  if (!Array.isArray(messages)) return String(messages);
  return messages.map(m => {
    const role = m.role || 'user';
    const content = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map(c => c.text || '').join('\n')
        : '';
    return `[${role}]\n${content}`;
  }).join('\n\n');
}

function resolveModel(requested) {
  if (!requested) return DEFAULT_MODEL;
  if (MODEL_MAP[requested] !== undefined) return MODEL_MAP[requested];
  return requested;
}

function makeOpenAIResponse(id, model, content, usage) {
  return {
    id: `chatcmpl-${id}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || 'claude-sonnet',
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: usage?.input_tokens || usage?.inputTokens || 0,
      completion_tokens: usage?.output_tokens || usage?.outputTokens || 0,
      total_tokens: (usage?.input_tokens || usage?.inputTokens || 0)
        + (usage?.output_tokens || usage?.outputTokens || 0),
    },
  };
}

function makeStreamChunk(id, model, delta, finishReason) {
  return {
    id: `chatcmpl-${id}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: model || 'claude-sonnet',
    choices: [{
      index: 0,
      delta: delta || {},
      finish_reason: finishReason || null,
    }],
  };
}

// --- Core: Call claude -p ----------------------------------------------------

function callClaude(prompt, model, stream, res) {
  const id = crypto.randomUUID().slice(0, 12);
  const resolvedModel = resolveModel(model);

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--model', resolvedModel,
    prompt,
  ];

  log(`request ${id}: model=${resolvedModel} stream=${stream} prompt_len=${prompt.length}`);

  const child = spawn(CLAUDE_BIN, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
  });

  let stdout = '';
  let stderr = '';
  let assistantContent = '';
  let usage = null;
  let responded = false;

  const timer = setTimeout(() => {
    if (!responded) {
      responded = true;
      child.kill('SIGTERM');
      log(`request ${id}: timeout after ${REQUEST_TIMEOUT_MS}ms`);
      if (stream) {
        res.write(`data: ${JSON.stringify(makeStreamChunk(id, model, { content: '\n[timeout]' }, 'stop'))}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        sendJSON(res, 504, { error: { message: 'Claude CLI timed out', type: 'timeout' } });
      }
    }
  }, REQUEST_TIMEOUT_MS);

  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(makeStreamChunk(id, model, { role: 'assistant' }))}\n\n`);
  }

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
    const lines = stdout.split('\n');
    stdout = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);

        // Claude CLI stream-json: assistant message with content array
        if (event.type === 'assistant' && event.message?.content) {
          const parts = event.message.content;
          for (const part of parts) {
            if (part.type === 'text' && part.text) {
              assistantContent += part.text;
              if (stream && !responded) {
                res.write(`data: ${JSON.stringify(makeStreamChunk(id, model, { content: part.text }))}\n\n`);
              }
            }
          }
          // Extract usage from assistant message
          if (event.message.usage) {
            usage = event.message.usage;
          }
        }

        // Result event with final usage
        if (event.type === 'result') {
          if (event.usage) usage = event.usage;
          if (event.result && !assistantContent) {
            assistantContent = event.result;
          }
        }
      } catch {
        // Skip non-JSON lines
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  child.on('close', (code) => {
    clearTimeout(timer);
    if (responded) return;
    responded = true;

    // Process remaining stdout
    if (stdout.trim()) {
      try {
        const event = JSON.parse(stdout);
        if (event.type === 'assistant' && event.message?.content) {
          for (const part of event.message.content) {
            if (part.type === 'text' && part.text) {
              assistantContent += part.text;
              if (stream) {
                res.write(`data: ${JSON.stringify(makeStreamChunk(id, model, { content: part.text }))}\n\n`);
              }
            }
          }
        }
        if (event.type === 'result') {
          if (event.usage) usage = event.usage;
          if (event.result && !assistantContent) assistantContent = event.result;
        }
      } catch { /* ignore */ }
    }

    log(`request ${id}: done code=${code} content_len=${assistantContent.length}`);

    if (stream) {
      res.write(`data: ${JSON.stringify(makeStreamChunk(id, model, {}, 'stop'))}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      if (!assistantContent && code !== 0) {
        sendJSON(res, 502, {
          error: { message: `Claude CLI exited with code ${code}: ${stderr.trim().slice(0, 500)}`, type: 'upstream_error' },
        });
      } else {
        sendJSON(res, 200, makeOpenAIResponse(id, model, assistantContent, usage));
      }
    }
  });

  child.on('error', (err) => {
    clearTimeout(timer);
    if (responded) return;
    responded = true;
    log(`request ${id}: spawn error: ${err.message}`);
    sendJSON(res, 500, { error: { message: `Failed to spawn claude: ${err.message}`, type: 'spawn_error' } });
  });
}

// --- HTTP Server -------------------------------------------------------------

function sendJSON(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/health') {
    return sendJSON(res, 200, { status: 'ok', version: '0.1.0', backend: 'claude-code-cli' });
  }

  if (req.method === 'GET' && req.url === '/v1/models') {
    const models = Object.keys(MODEL_MAP).map(id => ({
      id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'anthropic-cli',
    }));
    return sendJSON(res, 200, { object: 'list', data: models });
  }

  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    try {
      const body = JSON.parse(await readBody(req));
      const prompt = messagesToPrompt(body.messages);
      const model = body.model || '';
      const stream = body.stream === true;

      if (!prompt.trim()) {
        return sendJSON(res, 400, { error: { message: 'messages is required', type: 'invalid_request' } });
      }

      return callClaude(prompt, model, stream, res);
    } catch (err) {
      return sendJSON(res, 400, { error: { message: `Invalid request: ${err.message}`, type: 'invalid_request' } });
    }
  }

  sendJSON(res, 404, { error: { message: 'Not found', type: 'not_found' } });
});

server.listen(PORT, '127.0.0.1', () => {
  log(`listening on http://127.0.0.1:${PORT}`);
  log(`models: ${Object.keys(MODEL_MAP).join(', ')}`);
  log(`default model: ${DEFAULT_MODEL}`);
  log(`backend: claude -p (Claude Code CLI)`);
});

process.on('SIGTERM', () => {
  log('shutting down');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  log('shutting down');
  server.close(() => process.exit(0));
});
