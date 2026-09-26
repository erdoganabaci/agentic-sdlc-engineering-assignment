import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { loadLocalEnvFile, readDatabaseUrl } from '../dist/infrastructure/config.js';

test('the compiled API boots through a synchronous serverless module loader', () => {
  loadLocalEnvFile();
  const output = execFileSync(
    process.execPath,
    [
      '-e',
      `
    const assert = require('node:assert/strict');
    const { Server } = require('node:http');
    const originalListen = Server.prototype.listen;
    Server.prototype.listen = function (...args) {
      this.once('listening', async () => {
        try {
          const response = await fetch('http://127.0.0.1:' + this.address().port + '/health');
          assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), { status: 'ok' });
          process.stdout.write('Startup health check passed');
          this.close(() => process.exit(0));
        } catch (error) {
          process.stderr.write(String(error));
          process.exit(1);
        }
      });
      return originalListen.apply(this, args);
    };
    require('./dist/main.js');
  `,
    ],
    {
      encoding: 'utf8',
      timeout: 15000,
      stdio: 'pipe',
      env: {
        ...process.env,
        DATABASE_URL: readDatabaseUrl(),
        NODE_ENV: 'production',
        DEMO_AUTH: 'true',
        PUBLIC_DEMO: 'true',
        PORT: '0',
      },
    },
  );
  assert.match(output, /Startup health check passed/);
});
