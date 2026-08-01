import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, validateSecrets } from '../src/config/index.js';

test('loads bots and allowlist from environment', () => {
  const config = loadConfig({
    BOT_1_NAME: 'Telegram Bot 1',
    BOT_1_SERVICE: 'my-first-bot.service',
    BOT_2_NAME: 'Telegram Bot 2',
    BOT_2_SERVICE: 'my-second-bot.service',
    PORT: '4000',
  });
  assert.equal(config.bots.length, 2);
  assert.deepEqual(
    config.bots.map((b) => b.serviceName),
    ['my-first-bot.service', 'my-second-bot.service'],
  );
  assert.equal(config.port, 4000);
  assert.equal(config.telegramApi.serviceName, 'telegram-bot-api.service');
  assert.equal(config.telegramApi.url, 'http://127.0.0.1:8081');
});

test('throws when a bot pair is incomplete', () => {
  assert.throws(
    () => loadConfig({ BOT_1_NAME: 'Only Name' }),
    /BOT_1_NAME and BOT_1_SERVICE must both be set/,
  );
});

test('throws when service name does not end with .service', () => {
  assert.throws(
    () => loadConfig({ BOT_1_NAME: 'X', BOT_1_SERVICE: 'evil' }),
    /must end with "\.service"/,
  );
});

test('throws when no bots are configured', () => {
  assert.throws(() => loadConfig({}), /At least one BOT_N_NAME/);
});

test('rejects service names with dangerous characters', () => {
  assert.throws(
    () => loadConfig({ BOT_1_NAME: 'X', BOT_1_SERVICE: 'a; rm -rf /;.service' }),
    /contains invalid characters/,
  );
});

test('validateSecrets flags missing session secret and password hash', () => {
  const problems = validateSecrets({ auth: { sessionSecret: 'short', passwordHash: '' } });
  assert.ok(problems.some((p) => p.includes('SESSION_SECRET')));
  assert.ok(problems.some((p) => p.includes('ADMIN_PASSWORD_HASH')));
});

test('validateSecrets passes with strong secret and hash', () => {
  const problems = validateSecrets({ auth: { sessionSecret: 's'.repeat(40), passwordHash: '$2b$12$abc' } });
  assert.deepEqual(problems, []);
});
