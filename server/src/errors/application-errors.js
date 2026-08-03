// Central application error classes. Every error carries a stable machine
// code, an HTTP status, and a `safe` flag: safe errors may expose their
// crafted message to the browser; everything else is replaced by a
// generic message in the error handler. Raw command output and stack
// traces are never attached to safe messages.

export class ApplicationError extends Error {
  constructor(code, message, { statusCode = 500, safe = true } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.safe = safe;
  }
}

// Legacy alias kept for compatibility with the executor wrapper and older
// callers. `code` is the stable machine code, `statusCode` the HTTP status.
export class CommandError extends ApplicationError {
  constructor(code, message, statusCode = 500) {
    super(code, message, { statusCode });
  }
}

export class CommandTimeoutError extends ApplicationError {
  constructor(message, meta = {}) {
    super('SERVICE_COMMAND_TIMEOUT', message, { statusCode: 504 });
    this.durationMs = meta.durationMs ?? null;
    this.code = meta.code ?? 'SERVICE_COMMAND_TIMEOUT';
  }
}

export class CommandPermissionError extends ApplicationError {
  constructor(message, meta = {}) {
    super('SERVICE_PERMISSION_DENIED', message, { statusCode: 403 });
    this.durationMs = meta.durationMs ?? null;
    this.exitCode = meta.code ?? null;
  }
}

export class CommandNotFoundError extends ApplicationError {
  constructor(message, meta = {}) {
    super('COMMAND_NOT_FOUND', message, { statusCode: 500 });
    this.durationMs = meta.durationMs ?? null;
  }
}

export class CommandExecutionError extends ApplicationError {
  constructor(message, meta = {}) {
    super('SERVICE_COMMAND_FAILED', message, { statusCode: 500 });
    this.durationMs = meta.durationMs ?? null;
    this.exitCode = meta.code ?? null;
  }
}

export class ServiceNotFoundError extends ApplicationError {
  constructor(message, meta = {}) {
    super('SERVICE_NOT_FOUND', message, { statusCode: 404 });
    this.durationMs = meta.durationMs ?? null;
  }
}

export class ServiceBusyError extends ApplicationError {
  constructor(message) {
    super('SERVICE_BUSY', message, { statusCode: 409 });
  }
}

export class InvalidServiceError extends ApplicationError {
  constructor(message) {
    super('INVALID_SERVICE', message, { statusCode: 400 });
  }
}

export class InvalidActionError extends ApplicationError {
  constructor(message) {
    super('INVALID_ACTION', message, { statusCode: 400 });
  }
}

export class TelegramApiUnreachableError extends ApplicationError {
  constructor(message, meta = {}) {
    super('TELEGRAM_API_UNREACHABLE', message, { statusCode: 502 });
    this.reason = meta.reason ?? null;
  }
}

export class TelegramApiTimeoutError extends ApplicationError {
  constructor(message, meta = {}) {
    super('TELEGRAM_API_TIMEOUT', message, { statusCode: 504 });
    this.durationMs = meta.durationMs ?? null;
  }
}

export class LogsUnavailableError extends ApplicationError {
  constructor(message, { statusCode = 502 } = {}) {
    super('LOGS_UNAVAILABLE', message, { statusCode });
  }
}
