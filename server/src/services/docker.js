// Docker Compose control backend for the dashboard.
// All operations go through the injected executor, which runs the
// allowlisted host-side docker-control-helper script. This ensures
// the dashboard can NEVER control arbitrary containers or access
// the Docker daemon directly.
//
// Supported operations:
//   - start
//   - stop
//   - restart
//   - ps (status)
//   - logs

import {
  classifyResult,
  commandErrorFromClassified,
  CommandError,
} from './executor.js';
import { measureOperation } from '../utils/measure-operation.js';

export const STATUS_RUNNING = 'running';
export const STATUS_STOPPED = 'stopped';
export const STATUS_FAILED = 'failed';
export const STATUS_STARTING = 'starting';
export const STATUS_STOPPING = 'stopping';
export const STATUS_UNKNOWN = 'unknown';
export const STATUS_NOT_FOUND = 'not-found';

export const SHOW_PROPERTIES = [
  'Name',
  'ServiceName',
  'State',
  'Status',
  'RunningFor',
  'Health',
].join(',');

const CONTROL_ACTIONS = ['start', 'stop', 'restart'];

export function createDockerService(options = {}) {
  const {
    executor,
    redact = (s) => s,
    commandTimeoutMs = 15000,
    controlTimeoutMs = 60000,
    logTimeoutMs = 20000,
    logLineOptions = [50, 100, 250, 500],
    maxLogLines = 500,
    metrics,
  } = options;

  if (typeof executor !== 'function') {
    throw new Error('createDockerService requires an executor function');
  }

  const helperPath = '/usr/local/bin/docker-control-helper';

  async function getServiceStatus(serviceName) {
    return measureOperation(
      'docker-service-status',
      { serviceId: serviceName },
      async () => {
        const result = await executor(helperPath, [serviceName, 'ps'], {
          timeoutMs: commandTimeoutMs,
          operation: 'docker-control-helper ps',
        });
        const classified = classifyResult(result, helperPath);
        if (classified.error) {
          if (/service is not allowed/i.test(result.stderr || '')) {
            return {
              serviceName,
              found: false,
              status: STATUS_NOT_FOUND,
              activeState: 'inactive',
              subState: 'dead',
              mainPid: 0,
              uptimeSeconds: 0,
              memoryBytes: 0,
              cpuUsageNSec: 0,
              restartCount: 0,
              lastStartedAt: null,
              error: redact('Service not allowed'),
            };
          }
          throw commandErrorFromClassified(classified, 'Unable to query container status');
        }

        const stdout = result.stdout.trim();
        if (!stdout) {
          return {
            serviceName,
            found: false,
            status: STATUS_NOT_FOUND,
            activeState: 'inactive',
            subState: 'dead',
            mainPid: 0,
            uptimeSeconds: 0,
            memoryBytes: 0,
            cpuUsageNSec: 0,
            restartCount: 0,
            lastStartedAt: null,
          };
        }

        let containerInfo;
        try {
          containerInfo = JSON.parse(stdout);
        } catch {
          containerInfo = { State: 'unknown', Status: stdout };
        }

        const state = String(containerInfo.State || '').toLowerCase();
        const status = String(containerInfo.Status || '').toLowerCase();
        const health = String(containerInfo.Health || '').toLowerCase();

        let mappedStatus = STATUS_UNKNOWN;
        if (state === 'running' && (health === '' || health === 'healthy')) {
          mappedStatus = STATUS_RUNNING;
        } else if (state === 'running' && health === 'starting') {
          mappedStatus = STATUS_STARTING;
        } else if (state === 'exited' || state === 'dead') {
          mappedStatus = STATUS_STOPPED;
        } else if (state === 'restarting' || state === 'starting') {
          mappedStatus = STATUS_STARTING;
        } else if (state === 'created' || state === 'paused') {
          mappedStatus = STATUS_STOPPED;
        }

        const runningFor = String(containerInfo.RunningFor || '');
        const uptimeSeconds = extractUptimeSeconds(runningFor);

        return {
          serviceName,
          found: true,
          status: mappedStatus,
          activeState: state,
          subState: health || state,
          mainPid: containerInfo.PID || 0,
          uptimeSeconds,
          memoryBytes: 0,
          cpuUsageNSec: 0,
          restartCount: 0,
          lastStartedAt: null,
          raw: containerInfo,
        };
      },
      { metrics },
    );
  }

  async function controlService(serviceName, action) {
    if (!CONTROL_ACTIONS.includes(action)) {
      throw new CommandError('INVALID_ACTION', `Unsupported control action: ${action}`, 400);
    }
    return measureOperation(
      `docker-service-${action}`,
      { serviceId: serviceName, action },
      async () => {
        const result = await executor(helperPath, [serviceName, action], {
          timeoutMs: controlTimeoutMs,
          operation: `docker-control-helper ${action}`,
        });
        const classified = classifyResult(result, helperPath);
        if (classified.error) {
          throw commandErrorFromClassified(classified, `Failed to ${action} ${serviceName}`);
        }
        return { serviceName, action, success: true };
      },
      { metrics },
    );
  }

  function parseLinesParam(raw) {
    if (raw === undefined || raw === null || raw === '') return 100;
    const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
    if (!Number.isInteger(n) || !logLineOptions.includes(n)) {
      throw new CommandError('INVALID_LINES', `lines must be one of: ${logLineOptions.join(', ')}`, 400);
    }
    return n;
  }

  async function getServiceLogs(serviceName, { lines, search = '' } = {}) {
    const count = parseLinesParam(lines);
    return measureOperation(
      'docker-service-logs',
      { serviceId: serviceName },
      async () => {
        const result = await executor(
          helperPath,
          [serviceName, 'logs', String(count)],
          { timeoutMs: logTimeoutMs, operation: 'docker-control-helper logs' },
        );
        if (result.code !== 0) {
          if (result.timedOut) {
            throw new CommandError('COMMAND_TIMEOUT', 'Logs request timed out.', 504);
          }
          const stderr = (result.stderr || '').toLowerCase();
          if (/service is not allowed/i.test(stderr)) {
            throw new CommandError('SERVICE_NOT_ALLOWED', `Service ${serviceName} is not allowed.`, 404);
          }
          if (/no such/i.test(stderr) || /not found/i.test(stderr)) {
            throw new CommandError('SERVICE_NOT_FOUND', `No logs found for ${serviceName}.`, 404);
          }
          throw new CommandError('LOGS_UNAVAILABLE', 'Unable to read container logs.', 502);
        }

        const rawLines = (result.stdout || '')
          .split('\n')
          .map((l) => l.replace(/\r$/, ''))
          .filter((l) => l.trim() !== '');

        const query = typeof search === 'string' ? search.trim().slice(0, 200).toLowerCase() : '';
        let parsed = rawLines.map((raw) => {
          const escaped = redact(raw);
          return {
            time: null,
            host: null,
            process: serviceName,
            message: escaped,
            level: 'info',
            raw: escaped,
          };
        });

        if (query) {
          parsed = parsed.filter((l) => l.message.toLowerCase().includes(query) || l.raw.toLowerCase().includes(query));
        }

        return {
          serviceName,
          requested: count,
          total: rawLines.length,
          filtered: parsed.length,
          search: query ? search.trim().slice(0, 200) : null,
          lines: parsed.slice(0, maxLogLines),
        };
      },
      { metrics },
    );
  }

  return { getServiceStatus, controlService, getServiceLogs, parseLinesParam };
}

function extractUptimeSeconds(runningFor) {
  if (!runningFor) return 0;
  const parts = runningFor.match(/(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/);
  if (!parts) return 0;
  const hours = parseInt(parts[1] || '0', 10);
  const minutes = parseInt(parts[2] || '0', 10);
  const seconds = parseInt(parts[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}
