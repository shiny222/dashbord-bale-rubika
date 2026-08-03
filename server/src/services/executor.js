// Thin wrapper around child_process.execFile (via runCommand).
// Commands are ALWAYS invoked with an explicit executable path and an
// argument array — never a shell string — which prevents command injection.
//
// Keeps the legacy "never rejects, returns a normalized result object"
// contract so existing callers (systemd.js) and tests stay unchanged.
// New code should prefer the typed `runCommand` from ../utils/run-command.js.

import { runCommand } from '../utils/run-command.js';
import { CommandError } from '../errors/application-errors.js';

export const E_TIMEOUT = 'TIMEOUT';
export const E_PERMISSION = 'PERMISSION_DENIED';
export const E_NOT_FOUND = 'SERVICE_NOT_FOUND';
export const E_UNAVAILABLE = 'SYSTEMD_UNAVAILABLE';

// Re-export the legacy CommandError constructor so existing imports keep
// working; it is now a thin alias over the central ApplicationError.
export { CommandError };

// Executes a command with execFile and normalizes the outcome.
// Never rejects: it always resolves with a result object so callers can
// inspect exit codes and stderr safely.
export function createExecutor({ timeoutMs = 15000, maxBuffer = 4 * 1024 * 1024, operation = 'command' } = {}) {
  return function run(cmd, args, options = {}) {
    return runCommand({
      executable: cmd,
      args,
      timeoutMs: options.timeoutMs ?? timeoutMs,
      maxBufferBytes: options.maxBuffer ?? maxBuffer,
      operation: options.operation || operation,
    }).then(
      (result) => ({ stdout: result.stdout, stderr: result.stderr, code: 0, timedOut: false, error: null }),
      (err) => {
        // Match on the stable machine code rather than the class hierarchy
        // so every timeout error (regardless of which subclass produced it)
        // is recognized.
        const timedOut = err && err.code === 'SERVICE_COMMAND_TIMEOUT';
        const code = timedOut ? -1 : err.exitCode ?? -1;
        return {
          stdout: '',
          stderr: err.message || '',
          code,
          timedOut,
          error: err,
        };
      },
    );
  };
}

// Maps a raw result to a high-level error category.
// `cmd` is optional; when the failing command is `sudo`, any sudo-flavored
// stderr (e.g. a requiretty "a terminal is required" denial) is treated as
// a permission problem, since genuine systemctl errors never mention sudo.
export function classifyResult(result, cmd) {
  if (!result || result.timedOut) {
    return { error: E_TIMEOUT, message: 'The command timed out' };
  }
  if (result.code === 0) return { error: null, message: '' };
  const stderr = (result.stderr || '').toLowerCase();
  if (
    result.code === 126 ||
    result.code === 127 ||
    /permission denied|not authorized|operation not permitted|not allowed to execute|is not in the sudoers|password is required|no password/i.test(stderr) ||
    (cmd === 'sudo' && /\bsudo\s*:/i.test(stderr))
  ) {
    return { error: E_PERMISSION, message: 'Permission denied while running the command' };
  }
  if (/failed to connect to bus|no such file or directory.*systemd|systemd.*not available/i.test(stderr)) {
    return { error: E_UNAVAILABLE, message: 'systemd is unavailable on this host' };
  }
  return { error: 'COMMAND_FAILED', message: (result.stderr || 'Command failed').trim().slice(0, 500) };
}

// Converts a classified error into a browser-safe CommandError.
export function commandErrorFromClassified(classified, fallback) {
  switch (classified.error) {
    case E_TIMEOUT:
      return new CommandError('COMMAND_TIMEOUT', 'The command timed out. Try again, or check systemd responsiveness.', 504);
    case E_PERMISSION:
      return new CommandError(
        'PERMISSION_DENIED',
        `${fallback}: permission denied. Check the sudoers configuration for the dashboard user.`,
        403,
      );
    case E_NOT_FOUND:
      return new CommandError('SERVICE_NOT_FOUND', `${fallback}: the systemd unit was not found.`, 404);
    case E_UNAVAILABLE:
      return new CommandError('SYSTEMD_UNAVAILABLE', `${fallback}: systemd is not reachable on this host.`, 502);
    default:
      return new CommandError('COMMAND_FAILED', `${fallback}: ${classified.message}.`, 500);
  }
}
