/**
 * Development launcher for the desktop application.
 *
 * Starts the Vite dev server for the renderer, waits until it actually answers,
 * then starts Electron against it. The renderer talks to the in-process API over
 * the preload bridge, so no separate API server is started here: the desktop
 * application owns its SQLite database inside the main process.
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = Number(process.env.VITE_PORT || 5174);
const origin = `http://localhost:${port}`;
const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 400);
}

function start(label, command, args) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  children.push(child);
  const write = stream => chunk => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim()) stream.write(`[${label}] ${line}\n`);
    }
  };
  child.stdout.on('data', write(process.stdout));
  child.stderr.on('data', write(process.stderr));
  return child;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const vite = start('web', process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort']);

async function waitForRenderer() {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (vite.exitCode !== null && vite.exitCode !== 0) {
      throw new Error('The Vite dev server stopped before it was ready.');
    }
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await delay(250);
  }
  throw new Error(`The Vite dev server did not answer on ${origin}.`);
}

try {
  await waitForRenderer();
  const electronPath = (await import('electron')).default;
  console.log(`[app] starting Electron against ${origin}`);
  const desktop = start('app', electronPath, ['.']);
  desktop.on('exit', code => shutdown(code ?? 0));
} catch (error) {
  console.error(`[dev] ${error.message}`);
  shutdown(1);
}
