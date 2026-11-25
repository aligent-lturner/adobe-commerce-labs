import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../index.js';

const stamp = '2026-01-01T12:00:00Z';
const DEFAULT_URL = 'https://aisenseapi.com/services/v1/webhook_capture';
const event = (updated_at = stamp) => ({ AIO_COMMERCE_CONFIG_ENCRYPTION_KEY: 'test-key', data: { value: { id: '123', email: 'person@example.com', created_at: stamp, updated_at } } });
const pepper = 'a'.repeat(64);
function fixture(options = {}) {
  const records = new Map();
  const calls = { sends: [], updates: [], closed: 0, logs: [] };
  const collection = {
    insertOne: async (doc) => {
      if (records.has(doc.attempt_id)) throw Object.assign(new Error('E11000 duplicate key'), { name: 'DbError', code: 11000 });
      records.set(doc.attempt_id, doc);
    },
    findOne: async ({ attempt_id }) => records.get(attempt_id),
    updateOne: async ({ attempt_id }, { $set }) => {
      calls.updates.push($set);
      records.set(attempt_id, { ...records.get(attempt_id), ...$set });
    },
  };
  const handler = createHandler({
    initializeConfig: async () => {},
    readConfig: async (name, selector, { encryptionKey }) => {
      assert.equal(encryptionKey, 'test-key');
      return { config: { value: name === 'customer_key_pepper' ? pepper : 'https://welcome.example.org/capture' } };
    },
    connect: async () => ({ collection: () => collection, close: async () => { calls.closed++; } }),
    send: async (data) => { calls.sends.push(data); return 'capture-1'; },
    now: () => new Date('2026-01-01T13:00:00Z'),
    logger: { error: (value) => calls.logs.push(value) },
    ...options,
  });
  return { handler, records, calls };
}

test('delivered attempt has hashed keys, event timestamp, and terminal completion', async () => {
  const f = fixture();
  const result = await f.handler(event());
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.capture_id, 'capture-1');
  assert.equal(f.calls.sends.length, 1);
  assert.equal(f.calls.sends[0].baseUrl, 'https://welcome.example.org/capture');
  const [stored] = [...f.records.values()];
  assert.match(stored.attempt_id, /^[a-f0-9]{64}$/);
  assert.match(stored.customer_key, /^[a-f0-9]{64}$/);
  assert.equal(stored.event_time.valueOf(), Date.parse(stamp));
  assert.equal(stored.status, 'delivered');
  assert.equal(stored.capture_id, 'capture-1');
  assert.ok(!JSON.stringify(stored).includes('person@example.com'));
  assert.equal(f.calls.closed, 1);
});

test('unset welcome service config uses supplied default URL', async () => {
  const f = fixture({ readConfig: async (name, selector, { encryptionKey }) => {
    assert.equal(encryptionKey, 'test-key');
    return { config: name === 'customer_key_pepper' ? { value: pepper } : null };
  }});
  const result = await f.handler(event());
  assert.equal(result.body.capture_id, 'capture-1');
  assert.equal(f.calls.sends.length, 1);
  assert.equal(f.calls.sends[0].baseUrl, DEFAULT_URL);
});

test('duplicate event returns the existing attempt without a second send', async () => {
  const f = fixture();
  await f.handler(event());
  const duplicate = await f.handler(event());
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.attempt.status, 'delivered');
  assert.equal(f.calls.sends.length, 1);
  assert.equal(f.records.size, 1);
});

test('failed notification persists bounded status and never returns raw error', async () => {
  const f = fixture({ send: async () => { throw Object.assign(new Error('private upstream response'), { status: 503 }); } });
  const result = await f.handler(event());
  assert.equal(result.statusCode, 502);
  const stored = [...f.records.values()][0];
  assert.equal(stored.status, 'failed');
  assert.equal(stored.error_category, 'upstream_5xx');
  assert.ok(stored.completed_at instanceof Date);
  assert.ok(!JSON.stringify(result).includes('private upstream response'));
  assert.ok(!JSON.stringify(f.calls.logs).includes('private upstream response'));
});

test('updates and malformed event timestamps are skipped without storage or a send', async () => {
  const f = fixture();
  const skipped = { statusCode: 200, body: { skipped: true } };
  assert.deepEqual(await f.handler(event('2026-01-02T00:00:00Z')), skipped);
  assert.deepEqual(await f.handler({ data: { value: { id: '123', email: 'person@example.com' } } }), skipped);
  assert.deepEqual(await f.handler({ data: { value: { id: '123', email: 'person@example.com', created_at: 'not-a-date', updated_at: 'not-a-date' } } }), skipped);
  assert.deepEqual(await f.handler({ data: { value: { id: '123', email: 'person@example.com', created_at: stamp, updated_at: 'invalid' } } }), skipped);
  assert.equal(f.calls.closed, 0);
  assert.equal(f.calls.sends.length, 0);
});

test('new account with an invalid ID is rejected before config or storage', async () => {
  const f = fixture();
  const request = event();
  request.data.value.id = 'invalid';
  assert.deepEqual(await f.handler(request), { statusCode: 400, body: { error: 'invalid_customer_event' } });
  assert.equal(f.calls.closed, 0);
});

test('missing encryption key fails closed before opening DB', async () => {
  const f = fixture();
  const request = event();
  delete request.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY;
  assert.deepEqual(await f.handler(request), { statusCode: 500, body: { error: 'configuration_error' } });
  assert.equal(f.calls.closed, 0);
});
