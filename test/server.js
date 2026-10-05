// Starts a real server for a test file on a port the system picks, so test files running in parallel never collide.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Starts server.js on `dataDir`. Resolves to { base, log, stop } once it answers, or throws with its output. */
export async function startServer(dataDir, env = {}) {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', ALIQUOT_DATA: dataDir, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  const stop = async () => {
    proc.kill();
    await exited;
  };
  for (let i = 0; i < 100 && proc.exitCode === null; i++) {
    const port = log.match(/http:\/\/localhost:(\d+)/)?.[1];
    if (port) {
      const base = `http://127.0.0.1:${port}`;
      try {
        if ((await fetch(`${base}/api/setup`)).ok) return { base, log: () => log, stop };
      } catch { /* not up yet */ }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  await stop();
  throw new Error(`Server did not start:\n${log}`);
}
