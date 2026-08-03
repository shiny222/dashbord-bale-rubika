import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../src/utils/run-command.js';

const ECHO = '/bin/echo';
const SH = '/bin/sh';
const TRUE = '/usr/bin/true';

test('runCommand resolves on success with stdout', async () => {
  const result = await runCommand({ executable: ECHO, args: ['hello'], operation: 'test-echo' });
  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim(), 'hello');
  assert.ok(Number.isFinite(result.durationMs));
});

test('runCommand resolves when the command exits non-zero', async () => {
  const result = await runCommand({ executable: SH, args: ['-c', 'exit 3'], operation: 'test-exit' });
  assert.equal(result.code, 3);
});

test('runCommand rejects with CommandTimeoutError on timeout', async () => {
  await assert.rejects(
    runCommand({
      executable: SH,
      args: ['-c', 'sleep 5'],
      timeoutMs: 200,
      operation: 'test-sleep',
    }),
    (err) => err.code === 'SERVICE_COMMAND_TIMEOUT' && err.statusCode === 504,
  );
});

test('runCommand rejects with CommandNotFoundError for a missing executable', async () => {
  await assert.rejects(
    runCommand({ executable: '/nonexistent/definitely-not-a-binary', args: [], operation: 'test-missing' }),
    (err) => err.code === 'COMMAND_NOT_FOUND',
  );
});

test('runCommand rejects with CommandPermissionError for permission-denied output', async () => {
  await assert.rejects(
    runCommand({
      executable: SH,
      args: ['-c', 'echo "permission denied" >&2; exit 1'],
      operation: 'test-perm',
    }),
    (err) => err.code === 'SERVICE_PERMISSION_DENIED' && err.statusCode === 403,
  );
});

test('runCommand handles large output without crashing', async () => {
  const size = 1024 * 1024; // 1 MiB, under the 4 MiB default cap
  // Generate the output via a pipe, NOT by embedding it in argv (a huge
  // argument list fails with E2BIG before the process even starts).
  const result = await runCommand({
    executable: SH,
    args: ['-c', 'head -c 1048576 /dev/zero'],
    operation: 'test-large',
  });
  assert.equal(result.stdout.length, size);
});

test('runCommand enforces the maxBuffer limit', async () => {
  await assert.rejects(
    runCommand({
      executable: SH,
      args: ['-c', 'head -c 5000000 /dev/zero'],
      maxBufferBytes: 1024 * 1024, // 1 MiB cap, output is 5 MiB
      operation: 'test-buffer',
    }),
    (err) => Boolean(err && err.code),
  );
});

test('runCommand never uses shell mode (arguments cannot be interpreted)', async () => {
  // A literal semicolon must NOT be executed as a second command.
  const result = await runCommand({ executable: ECHO, args: ['a; touch /tmp/should-not-exist'], operation: 'test-noshell' });
  assert.equal(result.stdout.includes('a; touch'), true);
});
