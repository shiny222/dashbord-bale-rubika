// systemd integration: status, control and journal logs.
// All commands go through the injected executor (execFile-based) with
// explicit argument arrays — no shell interpolation of service names.

import {
  classifyResult,
  commandErrorFromClassified,
  CommandError,
} from './executor.js';

export const STATUS_RUNNING = 'running';
export const STATUS_STOPPED = 'stopped';
export const STATUS_FAILED = 'failed';
export const STATUS_STARTING = 'starting';
export const STATUS_STOPPING = 'stopping';
export const STATUS_NOT_FOUND = 'not-found';
export const STATUS_UNKNOWN = 'unknown';

export const SHOW_PROPERTIES = [
  'Id',
  'Description',
  'LoadState',
  'ActiveState',
  'SubState',
  'MainPID',
  'ExecMainStatus',
  'ExecMainCode',
  'ExecMainStartTimestamp',
  'ActiveEnterTimestamp',
  'NRestarts',
  'MemoryCurrent',
  'CPUUsageNSec',
  'Result',
].join(',');

// Parses `systemctl show` output ("Key=value" lines, possibly with
// multi-line values) into an object.
export function parseSystemctlShow(output) {
  const props = {};
  if (typeof output !== 'string') return props;
  let currentKey = null;
  for (const rawLine of output.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '') continue;
    const eq = line.indexOf('=');
    if (eq === -1) {
      // Continuation of a multi-line property value.
      if (currentKey && typeof props[currentKey] === 'string') {
        props[currentKey] += `\n${line}`;
      }
      continue;
    }
    currentKey = line.slice(0, eq);
    props[currentKey] = line.slice(eq + 1);
  }
  return props;
}

// Tolerant timestamp parser for the formats systemd emits:
//   "Fri 2026-07-31 21:33:37 UTC", "2026-07-31 21:33:37 UTC",
//   ISO 8601, or an integer epoch. Returns an ISO string or null.
const SYSTEMD_TS_RE = /^(?:[A-Z][a-z]{2}\s+)?(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})(?:\s+(UTC|GMT|[+-]\d{4}))?/;

export function parseTimestamp(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (trimmed === '') return null;
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) {
      const d = new Date(n * 1000);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    return null;
  }
  const m = SYSTEMD_TS_RE.exec(trimmed);
  if (m) {
    const datePart = m[1].replace(' ', 'T');
    const tz = m[2];
    const iso = tz === 'UTC' || tz === 'GMT' ? `${datePart}Z` : tz ? `${datePart}${tz}` : `${datePart}Z`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

// Maps systemd states to a compact dashboard status.
export function mapStatus(activeState, subState, loadState) {
  if (loadState === 'not-found') return STATUS_NOT_FOUND;
  const a = String(activeState || '').toLowerCase();
  const s = String(subState || '').toLowerCase();
  if (a === 'active' && (s === 'running' || s === 'listening' || s === 'exited')) return STATUS_RUNNING;
  if (a === 'failed') return STATUS_FAILED;
  if (a === 'inactive' || a === 'dead') return STATUS_STOPPED;
  if (a === 'activating' || s.startsWith('start')) return STATUS_STARTING;
  if (a === 'deactivating' || s.startsWith('stop')) return STATUS_STOPPING;
  if (a === '') return STATUS_UNKNOWN;
  return STATUS_UNKNOWN;
}

function toInt(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

const CONTROL_ACTIONS = ['start', 'stop', 'restart'];

export function createSystemdService(options = {}) {
  const {
    executor,
    redact = (s) => s,
    useSudo = true,
    commandTimeoutMs = 15000,
    controlTimeoutMs = 60000,
    logTimeoutMs = 20000,
    logLineOptions = [50, 100, 250, 500],
    maxLogLines = 500,
  } = options;

  if (typeof executor !== 'function') {
    throw new Error('createSystemdService requires an executor function');
  }

  const controlCmd = useSudo ? 'sudo' : 'systemctl';
  const controlBaseArgs = useSudo ? ['-n', 'systemctl'] : [];

  async function getServiceStatus(serviceName) {
    const baseArgs = ['show', serviceName, '--no-pager', `--property=${SHOW_PROPERTIES}`];
    // --timestamp=utc (systemd >= 246) normalizes timestamps so parsing
    // is independent of the host timezone. Fall back gracefully on older
    // systemd versions that reject the flag.
    let result = await executor('systemctl', [...baseArgs, '--timestamp=utc'], {
      timeoutMs: commandTimeoutMs,
    });
    if (result.code !== 0 && /unknown option|unrecognized option|invalid option/i.test(result.stderr || '')) {
      result = await executor('systemctl', baseArgs, { timeoutMs: commandTimeoutMs });
    }
    const classified = classifyResult(result, 'systemctl');
    if (classified.error) {
      throw commandErrorFromClassified(classified, 'Unable to query service status');
    }
    const props = parseSystemctlShow(result.stdout);

    const base = {
      id: serviceName,
      serviceName,
      found: props.LoadState !== 'not-found',
      activeState: props.ActiveState || '',
      subState: props.SubState || '',
      loadState: props.LoadState || '',
      description: redact(props.Description || ''),
      mainPid: toInt(props.MainPID),
      execMainStatus: toInt(props.ExecMainStatus),
      restartCount: toInt(props.NRestarts),
      memoryBytes: toInt(props.MemoryCurrent),
      cpuUsageNSec: toInt(props.CPUUsageNSec),
      result: props.Result || '',
    };

    if (!base.found) {
      return { ...base, status: STATUS_NOT_FOUND, uptimeSeconds: 0, lastStartedAt: null };
    }

    const status = mapStatus(props.ActiveState, props.SubState, props.LoadState);
    const activeEnter = parseTimestamp(props.ActiveEnterTimestamp);
    const lastStarted = parseTimestamp(props.ExecMainStartTimestamp || props.ActiveEnterTimestamp);
    const uptimeSeconds =
      status === STATUS_RUNNING && activeEnter
        ? Math.max(0, Math.floor((Date.now() - Date.parse(activeEnter)) / 1000))
        : 0;

    return { ...base, status, uptimeSeconds, lastStartedAt: lastStarted };
  }

  async function controlService(serviceName, action) {
    if (!CONTROL_ACTIONS.includes(action)) {
      throw new CommandError('INVALID_ACTION', `Unsupported control action: ${action}`, 400);
    }
    const result = await executor(controlCmd, [...controlBaseArgs, action, serviceName], {
      timeoutMs: controlTimeoutMs,
    });
    const classified = classifyResult(result, controlCmd);
    if (classified.error) {
      throw commandErrorFromClassified(classified, `Failed to ${action} ${serviceName}`);
    }
    return { serviceName, action, success: true };
  }

  // Accepts both the raw query string ('100') and an already-validated
  // number, so callers can safely pass values through twice.
  function parseLinesParam(raw) {
    if (raw === undefined || raw === null || raw === '') return 100;
    const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
    if (!Number.isInteger(n) || !logLineOptions.includes(n)) {
      throw new CommandError('INVALID_LINES', `lines must be one of: ${logLineOptions.join(', ')}`, 400);
    }
    return n;
  }

  const JOURNAL_LINE_RE = /^(\S+)\s+(\S+)\s+([^\s:]+(?:\[\d+\])?):\s?(.*)$/;

  function parseJournalLine(raw) {
    const m = JOURNAL_LINE_RE.exec(raw);
    if (!m) return { time: null, host: null, process: null, message: redact(raw), level: 'info', raw: redact(raw) };
    const [, time, host, process, message] = m;
    const lower = message.toLowerCase();
    let level = 'info';
    if (/(error|exception|traceback|fatal|panic|failed|core dumped)/.test(lower)) level = 'error';
    else if (/(warn|warning|deprecat)/.test(lower)) level = 'warning';
    return { time, host, process, message: redact(message), level, raw: redact(raw) };
  }

  async function getServiceLogs(serviceName, { lines, search = '' } = {}) {
    const count = parseLinesParam(lines);
    const result = await executor(
      'journalctl',
      ['-u', serviceName, '-n', String(count), '--no-pager', '--output=short-iso'],
      { timeoutMs: logTimeoutMs },
    );
    if (result.code !== 0) {
      if (result.timedOut) {
        throw new CommandError('COMMAND_TIMEOUT', 'journalctl timed out while reading logs.', 504);
      }
      const stderr = (result.stderr || '').toLowerCase();
      if (/permission denied|not authorized|access denied/i.test(stderr)) {
        throw new CommandError(
          'PERMISSION_DENIED',
          'Unable to read journal logs: permission denied. Add the dashboard user to the systemd-journal group.',
          403,
        );
      }
      if (/no such file|not found|unknown unit/i.test(stderr)) {
        throw new CommandError('SERVICE_NOT_FOUND', `No journal entries found for ${serviceName}.`, 404);
      }
      throw new CommandError('JOURNAL_UNAVAILABLE', 'Unable to read journal logs. Is journald available?', 502);
    }
    const rawLines = (result.stdout || '')
      .split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .filter((l) => l.trim() !== '');
    const query = typeof search === 'string' ? search.trim().slice(0, 200).toLowerCase() : '';
    let parsed = rawLines.map(parseJournalLine);
    if (query) {
      parsed = parsed.filter(
        (l) => l.message.toLowerCase().includes(query) || l.raw.toLowerCase().includes(query),
      );
    }
    return {
      serviceName,
      requested: count,
      total: rawLines.length,
      filtered: parsed.length,
      search: query ? search.trim().slice(0, 200) : null,
      lines: parsed.slice(0, maxLogLines),
    };
  }

  return { getServiceStatus, controlService, getServiceLogs, parseLinesParam };
}
