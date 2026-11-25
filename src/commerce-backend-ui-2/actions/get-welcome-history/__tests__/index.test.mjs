import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryHandler } from '../index.js';

const key = 'a'.repeat(64);
const params = { customer_id: '123', AIO_COMMERCE_CONFIG_ENCRYPTION_KEY: 'test-key' };
function handler(rows, options = {}) {
  const calls = [];
  let closed = false;
  let selected = rows;
  const cursor = {
    sort: (order) => { calls.push(order); selected = [...selected].sort((a, b) => Date.parse(b.event_time) - Date.parse(a.event_time)); return cursor; },
    project: (projection) => {
      assert.equal(projection.customer_key, undefined);
      assert.equal(projection.email, undefined);
      const included = Object.entries(projection).filter(([field, enabled]) => field !== '_id' && enabled === 1).map(([field]) => field);
      selected = selected.map((row) => Object.fromEntries(included.filter((field) => field in row).map((field) => [field, row[field]])));
      return cursor;
    },
    limit: (n) => { assert.equal(n, 100); selected = selected.slice(0, n); return cursor; },
    toArray: async () => selected,
  };
  const collection = { find: (filter) => { assert.match(filter.customer_key, /^[a-f0-9]{64}$/); calls.push(filter); return cursor; } };
  return { run: createHistoryHandler({ initializeConfig: async () => {}, readConfig: async (name, scope, options) => {
    assert.equal(name, 'customer_key_pepper');
    assert.equal(options.encryptionKey, 'test-key');
    return { config: { value: key } };
  }, connect: async () => ({ collection: () => collection, close: async () => { closed = true; } }), logger: { error() {} }, ...options }), calls, get closed() { return closed; } };
}

test('invalid id rejects before configuration access', async () => {
  const h = handler([]);
  assert.deepEqual(await h.run({ ...params, customer_id: '123;DROP' }), { statusCode: 400, body: { message: 'invalid_customer_id' } });
  assert.equal(h.closed, false);
});

test('missing encryption key fails closed with fixed configuration response', async () => {
  const h = handler([]);
  assert.deepEqual(await h.run({ customer_id: '123' }), { statusCode: 500, body: { error: 'configuration_error' } });
});

test('empty history differs from database errors without leaking messages', async () => {
  const h = handler([]);
  assert.deepEqual(await h.run(params), { statusCode: 200, body: { attempts: [] } });
  assert.deepEqual(h.calls[1], { event_time: -1 });
  assert.equal(h.closed, true);
  const broken = handler([], { connect: async () => { throw Object.assign(new Error('private raw database details'), { name: 'DbError' }); } });
  assert.deepEqual(await broken.run(params), { statusCode: 502, body: { message: 'history_unavailable' } });
});

test('projection removes PII and history is newest first', async () => {
  const row = { attempt_id: 'b'.repeat(64), customer_key: 'secret', status: 'delivered', event_time: new Date('2026-01-03'), email: 'private@example.com', name: 'private', raw_event: { private: true }, upstream_body: 'sensitive' };
  const h = handler([{ ...row, attempt_id: 'c'.repeat(64), event_time: new Date('2026-01-01') }, row]);
  const result = await h.run(params);
  assert.deepEqual(result.body.attempts, [
    { attempt_id: row.attempt_id, status: 'delivered', event_time: row.event_time },
    { attempt_id: 'c'.repeat(64), status: 'delivered', event_time: new Date('2026-01-01') },
  ]);
  assert.ok(!JSON.stringify(result).includes('private@example.com'));
  assert.ok(!JSON.stringify(result).includes('customer_key'));
});
