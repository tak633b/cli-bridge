'use strict';

const crypto = require('crypto');

// Reject any non-loopback Host header. DNS-rebinding + a bare loopback bind
// is otherwise enough for a browser tab to shell out via cursor/claude.
function hostIsLoopback(hostHeader) {
  if (!hostHeader) return false;
  const raw = String(hostHeader);
  const bracket = raw.startsWith('[');
  let hostname;
  if (bracket) {
    const end = raw.indexOf(']');
    hostname = end > 0 ? raw.slice(1, end) : raw.slice(1);
  } else {
    hostname = raw.split(':', 1)[0];
  }
  hostname = hostname.toLowerCase();
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

// Constant-time bearer-token compare. `timingSafeEqual` throws on length
// mismatch, which itself leaks length — guard by returning false first.
function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

module.exports = { hostIsLoopback, tokensEqual };
