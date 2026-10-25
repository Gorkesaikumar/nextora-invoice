/**
 * Runs the API server and the Vite dev server together with prefixed output.
 * Ctrl+C stops both. Vite proxies /api to the API server, so the browser talks
 * to a single origin exactly as it does in production.
 */
import { spawn } from 'node:child_process';

const children = [];
let shuttingDown = false;

function start(label, args) {
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  children.push(child);
  const write = stream => chunk => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim()) stream.write(`[${label}] ${line}\n`);
    }
  };
  child.stdout.on('data', write(process.stdout));
  child.stderr.on('data', write(process.stderr));
  child.on('exit', code => {
    if (shuttingDown) return;
    console.error(`[${label}] exited with code ${code}`);
    shutdown(code ?? 1);
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 400);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start('api', ['--env-file-if-exists=.env', 'server/local.js']);
start('web', ['node_modules/vite/bin/vite.js']);
