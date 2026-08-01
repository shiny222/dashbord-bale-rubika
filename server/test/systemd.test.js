import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSystemctlShow,
  parseTimestamp,
  mapStatus,
  createSystemdService,
  STATUS_NOT_FOUND,
} from '../src/services/systemd.js';
import { CommandError } from '../src/services/executor.js';

test('parseSystemctlShow parses key=value lines', () => {
  const out = 'Id=my-first-bot.service\nActiveState=active\nSubState=running\nNRestarts=2\n';
  const props = parseSystemctlShow(out);
  assert.equal(props.Id, 'my-first-bot.service');
  assert.equal(props.ActiveState, 'active');
  assert.equal(props.NRestarts, '2');
});

test('parseSystemctlShow handles multi-line values', () => {
  const props = parseSystemctlShow('Description=Multi\nline text\nOther=x');
  assert.equal(props.Description, 'Multi\nline text');
});

test('parseSystemctlShow returns {} for non-strings', () => {
  assert.deepEqual(parseSystemctlShow(null), {});
  assert.deepEqual(parseSystemctlShow(undefined), {});
});

test('parseTimestamp handles systemd format, ISO and epoch', () => {
  assert.equal(parseTimestamp('Fri 2026-07-31 21:33:37 UTC'), '2026-07-31T21:33:37.000Z');
  assert.equal(parseTimestamp('2026-07-31T21:33:37Z'), '2026-07-31T21:33:37.000Z');
  assert.equal(parseTimestamp('1785501217'), new Date(1785501217 * 1000).toISOString());
  assert.equal(parseTimestamp(''), null);
  assert.equal(parseTimestamp('not a date'), null);
  assert.equal(parseTimestamp(null), null);
});

test('mapStatus maps systemd states', () => {
  assert.equal(mapStatus('active', 'running', 'loaded'), 'running');
  assert.equal(mapStatus('failed', 'failed', 'loaded'), 'failed');
  assert.equal(mapStatus('inactive', 'dead', 'loaded'), 'stopped');
  assert.equal(mapStatus('activating', 'start-pre', 'loaded'), 'starting');
  assert.equal(mapStatus('deactivating', 'stop', 'loaded'), 'stopping');
  assert.equal(mapStatus('active', 'running', 'not-found'), STATUS_NOT_FOUND);
  assert.equal(mapStatus('', '', 'loaded'), 'unknown');
});

test('getServiceStatus parses a running unit', async () => {
  const { executor } = createFake();
  const systemd = createSystemdService({ executor, useSudo: true });
  const status = await systemd.getServiceStatus('my-first-bot.service');
  assert.equal(status.status, 'running');
  assert.equal(status.mainPid, 1234);
  assert.equal(status.restartCount, 2);
  assert.equal(status.memoryBytes, 73400320);
  assert.equal(status.cpuUsageNSec, 123456789);
  assert.equal(status.result, 'success');
  assert.equal(status.found, true);
  assert.ok(status.uptimeSeconds >= 0);
  assert.ok(status.lastStartedAt);
});

test('getServiceStatus reports not-found units', async () => {
  const { executor } = createFake({ show: 'Id=ghost.service\nLoadState=not-found\nActiveState=inactive\nSubState=dead\n' });
  const systemd = createSystemdService({ executor });
  const status = await systemd.getServiceStatus('ghost.service');
  assert.equal(status.status, 'not-found');
  assert.equal(status.found, false);
});

test('controlService runs through sudo -n with exact args', async () => {
  const { executor, calls } = createFake();
  const systemd = createSystemdService({ executor, useSudo: true });
  const result = await systemd.controlService('my-first-bot.service', 'restart');
  assert.equal(result.success, true);
  assert.deepEqual(calls[0], {
    cmd: 'sudo',
    args: ['-n', 'systemctl', 'restart', 'my-first-bot.service'],
  });
});

test('controlService without sudo calls systemctl directly', async () => {
  const { executor, calls } = createFake();
  const systemd = createSystemdService({ executor, useSudo: false });
  await systemd.controlService('my-first-bot.service', 'start');
  assert.deepEqual(calls[0], { cmd: 'systemctl', args: ['start', 'my-first-bot.service'] });
});

test('controlService rejects invalid actions', async () => {
  const { executor } = createFake();
  const systemd = createSystemdService({ executor });
  await assert.rejects(
    () => systemd.controlService('my-first-bot.service', 'delete'),
    (err) => err.code === 'INVALID_ACTION',
  );
});

test('permission-denied stderr maps to PERMISSION_DENIED', async () => {
  const executor = async () => ({ stdout: '', stderr: 'Operation not permitted', code: 1, timedOut: false, error: null });
  const systemd = createSystemdService({ executor });
  await assert.rejects(
    () => systemd.controlService('my-first-bot.service', 'stop'),
    (err) => err instanceof CommandError && err.code === 'PERMISSION_DENIED' && err.statusCode === 403,
  );
});

test('sudo requiretty-style denial maps to PERMISSION_DENIED', async () => {
  const executor = async () => ({
    stdout: '',
    stderr: 'sudo: a terminal is required to read the password; either use the -S option or set the SUDO_ASKPASS environment variable',
    code: 1,
    timedOut: false,
    error: null,
  });
  const systemd = createSystemdService({ executor, useSudo: true });
  await assert.rejects(
    () => systemd.controlService('my-first-bot.service', 'restart'),
    (err) => err instanceof CommandError && err.code === 'PERMISSION_DENIED' && err.statusCode === 403,
  );
});

test('timeout maps to COMMAND_TIMEOUT', async () => {
  const executor = async () => ({ stdout: '', stderr: '', code: -1, timedOut: true, error: { killed: true } });
  const systemd = createSystemdService({ executor });
  await assert.rejects(
    () => systemd.controlService('my-first-bot.service', 'start'),
    (err) => err instanceof CommandError && err.code === 'COMMAND_TIMEOUT' && err.statusCode === 504,
  );
});

test('getServiceLogs parses journal lines and filters by search', async () => {
  const { executor } = createFake({
    journal: [
      '2026-07-31T21:33:37+0000 host systemd[1]: Started My Bot Service.',
      '2026-07-31T21:34:01+0000 host python[1234]: ERROR: upload failed',
      '2026-07-31T21:34:02+0000 host python[1234]: INFO: all good',
    ].join('\n'),
  });
  const systemd = createSystemdService({ executor });
  const logs = await systemd.getServiceLogs('my-first-bot.service', { lines: 100 });
  assert.equal(logs.lines.length, 3);
  assert.equal(logs.lines[0].time, '2026-07-31T21:33:37+0000');
  assert.equal(logs.lines[1].level, 'error');
  assert.equal(logs.lines[2].level, 'info');

  const filtered = await systemd.getServiceLogs('my-first-bot.service', { lines: 100, search: 'error' });
  assert.equal(filtered.lines.length, 1);
  assert.ok(filtered.lines[0].message.includes('ERROR'));
});

test('getServiceLogs validates line counts', async () => {
  const { executor } = createFake();
  const systemd = createSystemdService({ executor });
  assert.equal(systemd.parseLinesParam('250'), 250);
  await assert.rejects(
    () => systemd.getServiceLogs('my-first-bot.service', { lines: 999 }),
    (err) => err.code === 'INVALID_LINES',
  );
  await assert.rejects(
    () => systemd.getServiceLogs('my-first-bot.service', { lines: 'abc' }),
    (err) => err.code === 'INVALID_LINES',
  );
});

test('journalctl permission denied maps to a friendly error', async () => {
  const executor = async () => ({ stdout: '', stderr: 'Failed to open journal: Permission denied', code: 1, timedOut: false, error: null });
  const systemd = createSystemdService({ executor });
  await assert.rejects(
    () => systemd.getServiceLogs('my-first-bot.service', { lines: 100 }),
    (err) => err.code === 'PERMISSION_DENIED' && err.message.includes('systemd-journal'),
  );
});

function createFake({ show = 'Id=my-first-bot.service\nDescription=My Bot Service\nLoadState=loaded\nActiveState=active\nSubState=running\nMainPID=1234\nExecMainStatus=0\nExecMainCode=0\nExecMainStartTimestamp=Fri 2026-07-31 21:33:37 UTC\nActiveEnterTimestamp=Fri 2026-07-31 21:33:37 UTC\nNRestarts=2\nMemoryCurrent=73400320\nCPUUsageNSec=123456789\nResult=success\n', journal = '' } = {}) {
  const calls = [];
  return {
    calls,
    executor: async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'journalctl') return { stdout: journal, stderr: '', code: 0, timedOut: false, error: null };
      return { stdout: show, stderr: '', code: 0, timedOut: false, error: null };
    },
  };
}
