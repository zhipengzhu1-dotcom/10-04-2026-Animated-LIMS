// Harness tests: a test file's server must die with the file, even when a name pattern filters out every test in it
// and node:test then runs the file's after hook before its before hook has finished starting the server.
// Run with:  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a test file whose tests are all filtered out still exits', async () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawn(process.execPath, ['--test', '--test-name-pattern=no test is called this', 'test/modules.test.js'], { cwd: ROOT, env, stdio: 'ignore' });
  const exited = new Promise((resolve) => run.once('exit', resolve));
  const timer = setTimeout(() => run.kill(), 20000);
  const code = await exited;
  clearTimeout(timer);
  assert.equal(code, 0, 'the filtered run hung until it was killed');
});
