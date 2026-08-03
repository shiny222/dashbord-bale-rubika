// Reusable, safe asynchronous command runner.
//
// Every Linux command goes through this single chokepoint:
//   - execFile (never shell:true, never a full shell command string)
//   - explicit executable path + argument array only
//   - configurable timeout with child kill
//   - bounded stdout/stderr buffering
//   - operation name logged WITHOUT sensitive arguments
//   - typed, browser-safe error classes
//
// Example:
//   const result = await runCommand({
//     executable: '/usr/bin/systemctl',
//     args: ['show', 'my-first-bot.service', '--no-pager'],
//     timeoutMs: 5000,
//     operation: 'service-status',
//   });

import { execFile } from 'node:child_process';
import { logger } from '../logger.js';
import {
  CommandTimeoutError,
  CommandPermissionError,
  CommandNotFoundError,
  CommandExecutionError,
} from '../errors/application-errors.js';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_BUFFER_BYTES = 4 * 1024 * 1024; // 4 MiB

// Executes a command with execFile. Resolves with a normalized result;
// rejects with a typed ApplicationError on any failure (including
// timeout, permission denial and missing executable).
export function runCommand({
  executable,
  args = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
  operation = 'command',
} = {}) {
  if (typeof executable !== 'string' || executable === '') {
    return Promise.reject(new CommandExecutionError('Invalid executable path.'));
  }
  if (!Array.isArray(args)) {
    return Promise.reject(new CommandExecutionError('Command arguments must be an array.'));
  }

  return new Promise((resolve, reject) => {
    const startedAt = process.hrtime.bigint();

    execFile(
      executable,
      args,
      {
        timeout: Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS,
        maxBuffer: Number.isFinite(maxBufferBytes) ? maxBufferBytes : DEFAULT_MAX_BUFFER_BYTES,
        windowsHide: true,
        killSignal: 'SIGKILL',
      },
      (error, stdout, stderr) => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const timedOut = Boolean(error && (error.killed === true || error.code === 'ETIMEDOUT'));
        const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;

        // Log only the operation name — never the arguments (they may
        // contain service names or, hypothetically, sensitive values).
        logger.debug('command completed', {
          operation,
          code,
          timedOut,
          durationMs: Math.round(durationMs * 100) / 100,
        });

        if (error) {
          if (timedOut) {
            return reject(
              new CommandTimeoutError(
                `Command "${operation}" timed out after ${Math.round(durationMs)} ms.`,
                { durationMs },
              ),
            );
          }
          if (error.code === 'ENOENT') {
            return reject(
              new CommandNotFoundError(`Executable not found: ${executable}`, { durationMs }),
            );
          }
          if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            return reject(
              new CommandExecutionError(`Command "${operation}" produced too much output.`, {
                durationMs,
              }),
            );
          }
          // A numeric error code means the command ran but exited non-zero.
          // That is a normal result (stdout/stderr/exit code are useful to
          // callers) unless it looks like a permission denial.
          if (typeof error.code === 'number') {
            const stderrText = String(stderr || '').toLowerCase();
            if (
              code === 126 ||
              code === 127 ||
              /permission denied|not authorized|operation not permitted|not allowed to execute|is not in the sudoers|password is required|no password/i.test(stderrText)
            ) {
              return reject(
                new CommandPermissionError(
                  `Permission denied while running "${operation}".`,
                  { durationMs, code },
                ),
              );
            }
            return resolve({
              stdout: stdout || '',
              stderr: stderr || '',
              code,
              durationMs,
              signal: error.signal || null,
            });
          }
          // Spawn-level failure (e.g. EACCES, E2BIG, ...).
          return reject(
            new CommandExecutionError(`Command "${operation}" failed to start (${error.code || 'unknown error'}).`, {
              durationMs,
              code,
            }),
          );
        }

        resolve({ stdout: stdout || '', stderr: stderr || '', code: 0, durationMs, signal: null });
      },
    );
  });
}
