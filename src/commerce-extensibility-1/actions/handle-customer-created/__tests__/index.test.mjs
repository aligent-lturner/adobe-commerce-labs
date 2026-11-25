import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../index.js';

const DEFAULT = 'https://aisenseapi.com/services/v1/webhook_capture';
const event = (created_at = '2026-01-01 12:00:00', updated_at = created_at) => ({ data: { value: { email: 'person@example.com', created_at, updated_at } } });
const logger = { error: (...args) => logs.push(...args) };
let logs;

test.beforeEach(() => { logs = []; });

test('new account uses the default URL and returns capture_id', async () => {
  let sent;
  const handler = createHandler({ initializeConfig: async ({ schema }) => assert.equal(schema[0].name, 'welcome_service_base_url'), scope: (...args) => args, readConfig: async (key, selector) => {
    assert.equal(key, 'welcome_service_base_url');
    assert.deepEqual(selector, ['global', 'global']);
    return { config: null };
  }, send: async (data) => { sent = data; return 'capture-123'; }, logger });
  assert.deepEqual(await handler(event()), { statusCode: 200, body: { capture_id: 'capture-123' } });
  assert.deepEqual(sent, { baseUrl: DEFAULT, email: 'person@example.com', created_at: '2026-01-01 12:00:00' });
});

test('merchant override replaces the default', async () => {
  let url;
  const handler = createHandler({ initializeConfig: async () => {}, readConfig: async () => ({ config: { value: 'https://welcome.example.org/capture' } }), send: async ({ baseUrl }) => { url = baseUrl; return 'override-id'; }, logger });
  assert.equal((await handler(event())).body.capture_id, 'override-id');
  assert.equal(url, 'https://welcome.example.org/capture');
});

test('updates are skipped without loading config or making network calls', async () => {
  const handler = createHandler({ initializeConfig: () => { throw Error('should not initialize'); }, send: () => { throw Error('should not send'); }, logger });
  assert.deepEqual(await handler(event('2026-01-01', '2026-01-02')), { statusCode: 200, body: { skipped: true } });
});

test('invalid or missing timestamps cannot be treated as new', async () => {
  const handler = createHandler({ logger });
  assert.deepEqual(await handler({ data: { value: { email: 'person@example.com' } } }), { statusCode: 400, body: { error: 'invalid_customer_event' } });
});

test('a config read error fails closed without sending', async () => {
  const handler = createHandler({ initializeConfig: async () => {}, readConfig: async () => { throw Error('private config details'); }, send: () => { throw Error('must not send'); }, logger });
  assert.deepEqual(await handler(event()), { statusCode: 500, body: { error: 'configuration_error' } });
  assert.equal(logs[0].operation, 'read_welcome_service_config');
  assert.ok(!JSON.stringify(logs).includes('private config details'));
});

test('capture failure returns non-2xx and does not expose customer email', async () => {
  const handler = createHandler({ initializeConfig: async () => {}, readConfig: async () => ({ config: null }), send: async () => { throw Error('request failed'); }, logger });
  assert.deepEqual(await handler(event()), { statusCode: 502, body: { error: 'welcome_notification_failed' } });
  assert.equal(logs[0].email_domain, 'example.com');
  assert.ok(!JSON.stringify(logs).includes('person@example.com'));
});
