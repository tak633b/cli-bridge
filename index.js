'use strict';

const { spawn } = require('child_process');
const path = require('path');

let serverProcess = null;

module.exports = {
  id: 'cursor-bridge',
  name: 'Cursor Bridge',
  description: 'OpenAI-compatible proxy for Cursor Agent CLI',
  kind: 'integration',

  register(api) {
    const config = api.pluginConfig || {};
    const port = config.port || 18800;
    const defaultModel = config.defaultModel || '';
    const cursorBin = config.cursorBin || 'cursor';
    const timeoutMs = config.timeoutMs || 120000;

    api.on('gateway_start', () => {
      if (serverProcess) return;

      const serverPath = path.join(__dirname, 'server.js');
      api.logger.info(`starting cursor-bridge proxy on port ${port}`);

      serverProcess = spawn(process.execPath, [serverPath], {
        env: {
          ...process.env,
          CURSOR_BRIDGE_PORT: String(port),
          CURSOR_BRIDGE_MODEL: defaultModel,
          CURSOR_BRIDGE_BIN: cursorBin,
          CURSOR_BRIDGE_TIMEOUT: String(timeoutMs),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      serverProcess.stdout.on('data', (chunk) => {
        for (const line of chunk.toString().split('\n').filter(Boolean)) {
          api.logger.info(line);
        }
      });

      serverProcess.stderr.on('data', (chunk) => {
        for (const line of chunk.toString().split('\n').filter(Boolean)) {
          api.logger.info(line);
        }
      });

      serverProcess.on('exit', (code) => {
        api.logger.info(`cursor-bridge proxy exited (code=${code})`);
        serverProcess = null;
      });

      serverProcess.on('error', (err) => {
        api.logger.error(`cursor-bridge spawn error: ${err.message}`);
        serverProcess = null;
      });
    });

    api.on('gateway_stop', () => {
      if (serverProcess) {
        api.logger.info('stopping cursor-bridge proxy');
        serverProcess.kill('SIGTERM');
        serverProcess = null;
      }
    });
  },
};
