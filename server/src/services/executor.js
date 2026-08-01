// Thin wrapper around child_process.execFile.
// Commands are ALWAYS invoked with an explicit executable path and an
// argument array — never a shell string — which prevents command injection.

import { execFile } from 'node:child_process';

export const E_TIMEOUT = 'TIMEOUT';
export const E_PERMISSION = 'PERMISSION_DENIED';
export const E_NOT_FOUND = 'SERVICE_NOT_FOUND';
export const E_UNAVAILABLE = 'SYSTEMD_UNAVAILABLE';

export class CommandError extends Error {
  constructor(code, message, statusCode = 500) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
    this.statusCode = statusCode;
    // Messages created by this class are safe to expose to the browser.
    this.safe = true;
  }
}

// Executes a command with execFile and normalizes the outcome.
// Never rejects: it always resolves with a result object so callers can
// inspect exit codes and stderr safely.
export function createExecutor({ timeoutMs = 15000, maxBuffer = 4 * 1024 * 1024 } = {}) {
  return function run(cmd, args, options = {}) {
    return new Promise((resolve) => {
      execFile(
        cmd,
        args,
        {
          timeout: options.timeoutMs ?? timeoutMs,
          maxBuffer,
          windowsHide: true,
          killSignal: 'SIGKILL',
        },
        (error, stdout, stderr) => {
          // error.killed is set by Node exactly when the process was
          // terminated because of our timeout (killSignal is SIGKILL).
          // A genuine external kill also sets signal but not killed, so
          // we rely on `killed` / ETIMEDOUT only.
          const timedOut = Boolean(error && (error.killed === true || error.code === 'ETIMEDOUT'));
          resolve({
            stdout: stdout || '',
            stderr: stderr || '',
            code: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
            timedOut,
            error,
          });
        },
      );
    });
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
  // Covers both OS-level denials and sudo's own messages (a missing or
  // wrong sudoers entry, a password prompt that cannot be answered
  // non-interactively, or a requiretty denial). Sudo's own errors are
  // always line-prefixed with "sudo:", so anchoring on that prefix avoids
  // misclassifying genuine failures whose stderr merely mentions sudo.
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
