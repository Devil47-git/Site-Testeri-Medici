import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAppConfig } from '../api/config.js';

test('APP_CONFIG_JSON overrides legacy values and serializes nested credentials', () => {
  const environment = {
    APP_CONFIG_JSON: JSON.stringify({
      DISCORD_CLIENT_ID: 'json-client',
      GOOGLE_SERVICE_ACCOUNT_JSON: { client_email: 'service@example.com' },
      DISCORD_TESTERS_WEBHOOK: ''
    }),
    DISCORD_CLIENT_ID: 'legacy-client',
    GOOGLE_SERVICE_ACCOUNT_JSON: 'legacy-credentials',
    DISCORD_TESTERS_WEBHOOK: 'legacy-webhook',
    UPSTASH_REDIS_REST_URL: 'legacy-url'
  };

  assert.equal(loadAppConfig(environment), environment);
  assert.equal(environment.DISCORD_CLIENT_ID, 'json-client');
  assert.equal(environment.GOOGLE_SERVICE_ACCOUNT_JSON, '{"client_email":"service@example.com"}');
  assert.equal(environment.DISCORD_TESTERS_WEBHOOK, 'legacy-webhook');
  assert.equal(environment.UPSTASH_REDIS_REST_URL, 'legacy-url');
});

test('APP_CONFIG_JSON rejects malformed and non-object values', () => {
  assert.throws(() => loadAppConfig({ APP_CONFIG_JSON: '{invalid' }), /valid JSON object/);
  assert.throws(() => loadAppConfig({ APP_CONFIG_JSON: '[]' }), /valid JSON object/);
});