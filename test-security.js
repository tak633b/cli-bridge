#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { hostIsLoopback, tokensEqual } = require('./security');

test('hostIsLoopback accepts loopback names with and without port', () => {
  for (const h of ['127.0.0.1', '127.0.0.1:18800', 'localhost', 'localhost:18801', '[::1]:18800']) {
    assert.strictEqual(hostIsLoopback(h), true, h);
  }
});

test('hostIsLoopback rejects DNS-rebinding and public hostnames', () => {
  for (const h of ['127.0.0.1.evil.com', 'evil.127.0.0.1.nip.io', 'evil.com', 'attacker.com:18800', '169.254.169.254']) {
    assert.strictEqual(hostIsLoopback(h), false, h);
  }
});

test('hostIsLoopback rejects empty / missing Host header', () => {
  assert.strictEqual(hostIsLoopback(''), false);
  assert.strictEqual(hostIsLoopback(undefined), false);
  assert.strictEqual(hostIsLoopback(null), false);
});

test('tokensEqual returns true only for byte-identical tokens', () => {
  assert.strictEqual(tokensEqual('abc', 'abc'), true);
  assert.strictEqual(tokensEqual('abc', 'abd'), false);
  assert.strictEqual(tokensEqual('abc', 'abcd'), false); // length mismatch — must not throw
  assert.strictEqual(tokensEqual('', ''), true);
  assert.strictEqual(tokensEqual('abc', ''), false);
});

test('tokensEqual guards against non-string inputs', () => {
  assert.strictEqual(tokensEqual(undefined, 'abc'), false);
  assert.strictEqual(tokensEqual('abc', null), false);
  assert.strictEqual(tokensEqual(123, 123), false);
});
