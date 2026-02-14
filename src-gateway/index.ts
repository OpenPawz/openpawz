// Gateway launcher - this will be compiled to a standalone binary
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Start the gateway
const gateway = spawn('node', [
  join(__dirname, '..', 'node_modules', 'openclaw', 'openclaw.mjs'),
  'gateway',
  'start'
], {
  stdio: 'inherit',
  env: process.env
});

gateway.on('exit', (code) => {
  process.exit(code || 0);
});
