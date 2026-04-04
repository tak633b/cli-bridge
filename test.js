#!/usr/bin/env node
'use strict';

const http = require('http');

const PORT = parseInt(process.env.CURSOR_BRIDGE_PORT || '18800', 10);
const BASE = `http://127.0.0.1:${PORT}`;

async function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, body: raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function testHealth() {
  console.log('--- Test: GET /health ---');
  const { status, body } = await request('GET', '/health');
  console.log(`  status: ${status}`);
  console.log(`  body: ${body}`);
  return status === 200;
}

async function testModels() {
  console.log('--- Test: GET /v1/models ---');
  const { status, body } = await request('GET', '/v1/models');
  console.log(`  status: ${status}`);
  const data = JSON.parse(body);
  console.log(`  models: ${data.data.map(m => m.id).join(', ')}`);
  return status === 200;
}

async function testChatCompletion() {
  console.log('--- Test: POST /v1/chat/completions ---');
  const { status, body } = await request('POST', '/v1/chat/completions', {
    model: 'cursor-composer-2',
    messages: [{ role: 'user', content: 'Reply with just the word PONG' }],
  });
  console.log(`  status: ${status}`);
  const data = JSON.parse(body);
  console.log(`  response: ${data.choices?.[0]?.message?.content?.trim()}`);
  console.log(`  usage: ${JSON.stringify(data.usage)}`);
  return status === 200 && data.choices?.[0]?.message?.content;
}

async function testStream() {
  console.log('--- Test: POST /v1/chat/completions (stream) ---');
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'cursor-composer-2',
      messages: [{ role: 'user', content: 'Reply with just the word STREAM' }],
      stream: true,
    });
    const opts = {
      method: 'POST',
      hostname: '127.0.0.1',
      port: PORT,
      path: '/v1/chat/completions',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = http.request(opts, (res) => {
      let content = '';
      console.log(`  status: ${res.statusCode}`);
      res.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.choices?.[0]?.delta?.content) {
                content += event.choices[0].delta.content;
              }
            } catch { /* skip */ }
          }
        }
      });
      res.on('end', () => {
        console.log(`  streamed: ${content.trim()}`);
        resolve(res.statusCode === 200);
      });
    });
    req.write(body);
    req.end();
  });
}

async function main() {
  const results = [];
  console.log(`\nCursor Bridge Tests (${BASE})\n`);

  try {
    results.push(['health', await testHealth()]);
    results.push(['models', await testModels()]);
    results.push(['chat', await testChatCompletion()]);
    results.push(['stream', await testStream()]);
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    console.error('Make sure cursor-bridge server is running: node server.js');
    process.exit(1);
  }

  console.log('\n--- Results ---');
  let allPass = true;
  for (const [name, pass] of results) {
    console.log(`  ${pass ? 'PASS' : 'FAIL'}: ${name}`);
    if (!pass) allPass = false;
  }
  process.exit(allPass ? 0 : 1);
}

main();
