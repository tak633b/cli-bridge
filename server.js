#!/usr/bin/env node
'use strict';

const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');

// --- Configuration -----------------------------------------------------------

const PORT = parseInt(process.env.CURSOR_BRIDGE_PORT || '18800', 10);
const DEFAULT_MODEL = process.env.CURSOR_BRIDGE_MODEL || '';
const CURSOR_BIN = process.env.CURSOR_BRIDGE_BIN || 'cursor';
const REQUEST_TIMEOUT_MS = parseInt(process.env.CURSOR_BRIDGE_TIMEOUT || '120000', 10);

// Map from OpenAI-style model names to Cursor agent --model values
const MODEL_MAP = {
  'cursor-composer-2': 'composer-2',
  'cursor-composer-2-fast': 'composer-2-fast',
  'cursor-sonnet-4': 'sonnet-4',
  'cursor-sonnet-4-thinking': 'sonnet-4-thinking',
  'cursor-gpt-4o': 'gpt-4o',
  'cursor-gpt-5': 'gpt-5',
  'cursor-o3': 'o3',
  'cursor-gemini-2.5-pro': 'gemini-2.5-pro',
};

// --- Helpers -----------------------------------------------------------------

function log(msg) {
  const ts = new Date().toISOString();
  process.stderr.write(`[${ts}] [cursor-bridge] ${msg}\n`);
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
  // Pass through unknown model names directly
  return requested;
}

function makeOpenAIResponse(id, model, content, usage) {
  return {
    id: `chatcmpl-${id}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || 'cursor-composer-2',
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: usage?.inputTokens || 0,
      completion_tokens: usage?.outputTokens || 0,
      total_tokens: (usage?.inputTokens || 0) + (usage?.outputTokens || 0),
    },
  };
}

function makeStreamChunk(id, model, delta, finishReason) {
  return {
    id: `chatcmpl-${id}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: model || 'cursor-composer-2',
    choices: [{
      index: 0,
      delta: delta || {},
      finish_reason: finishReason || null,
    }],
  };
}

// --- Core: Call cursor agent -------------------------------------------------

function callCursorAgent(prompt, model, stream, res) {
  const id = crypto.randomUUID().slice(0, 12);
  const resolvedModel = resolveModel(model);

  const args = ['agent', '-p', '-f', '--output-format', 'stream-json'];
  if (resolvedModel) {
    args.push('--model', resolvedModel);
  }
  args.push(prompt);

  log(`request ${id}: model=${resolvedModel || 'default'} stream=${stream} prompt_len=${prompt.length}`);

  const child = spawn(CURSOR_BIN, args, {
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
        sendJSON(res, 504, { error: { message: 'Cursor agent timed out', type: 'timeout' } });
      }
    }
  }, REQUEST_TIMEOUT_MS);

  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    // Send initial role chunk
    res.write(`data: ${JSON.stringify(makeStreamChunk(id, model, { role: 'assistant' }))}\n\n`);
  }

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
    const lines = stdout.split('\n');
    stdout = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
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
        }
        if (event.type === 'result') {
          usage = event.usage || null;
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

    // Process any remaining stdout
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
          usage = event.usage || null;
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
          error: { message: `Cursor agent exited with code ${code}: ${stderr.trim()}`, type: 'upstream_error' },
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
    sendJSON(res, 500, { error: { message: `Failed to spawn cursor agent: ${err.message}`, type: 'spawn_error' } });
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
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    return sendJSON(res, 200, { status: 'ok', version: '0.1.0' });
  }

  // List models
  if (req.method === 'GET' && req.url === '/v1/models') {
    const models = Object.keys(MODEL_MAP).map(id => ({
      id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'cursor',
    }));
    return sendJSON(res, 200, { object: 'list', data: models });
  }

  // Chat completions
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    try {
      const body = JSON.parse(await readBody(req));
      const prompt = messagesToPrompt(body.messages);
      const model = body.model || '';
      const stream = body.stream === true;

      if (!prompt.trim()) {
        return sendJSON(res, 400, { error: { message: 'messages is required', type: 'invalid_request' } });
      }

      return callCursorAgent(prompt, model, stream, res);
    } catch (err) {
      return sendJSON(res, 400, { error: { message: `Invalid request: ${err.message}`, type: 'invalid_request' } });
    }
  }

  sendJSON(res, 404, { error: { message: 'Not found', type: 'not_found' } });
});

server.listen(PORT, '::', () => {
  log(`listening on http://127.0.0.1:${PORT}`);
  log(`models: ${Object.keys(MODEL_MAP).join(', ')}`);
  log(`default model: ${DEFAULT_MODEL || '(composer 2)'}`);
});

process.on('SIGTERM', () => {
  log('shutting down');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  log('shutting down');
  server.close(() => process.exit(0));
});
