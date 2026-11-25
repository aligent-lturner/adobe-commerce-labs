import test from 'node:test';
import assert from 'node:assert/strict';
import { createRotationHandler } from '../index.js';
import { ROTATION_LOCK_ID, ROTATION_LOCK_CUSTOMER_KEY } from '../../../../commerce-extensibility-1/actions/handle-customer-created/history-keyring.js';

const legacy = 'a'.repeat(64);
const fresh = 'b'.repeat(64);
const request = { __ow_method: 'post', __ow_body: '', AIO_COMMERCE_CONFIG_ENCRYPTION_KEY: 'test-key' };
function fixture(overrides = {}) {
  const calls = { inserted: [], deleted: [], writes: [], closed: 0, permission: 0, logs: [] };
  let versions = null;
  const collection = {
    insertOne: async (doc) => { calls.inserted.push(doc); },
    deleteOne: async (filter) => { calls.deleted.push(filter); },
  };
  const main = createRotationHandler({
    checkPermission: async () => { calls.permission++; return true; },
    connect: async () => ({ collection: () => collection, close: async () => { calls.closed++; } }),
    initializeConfig: async () => {},
    readConfig: async (name, scope, opts) => {
      assert.equal(opts.encryptionKey, 'test-key');
      assert.equal(opts.cacheTimeout, 0);
      return { config: name === 'customer_key_pepper' ? { value: legacy } : versions };
    },
    writeConfig: async (data, scope, opts) => {
      assert.equal(opts.encryptionKey, 'test-key');
      calls.writes.push(data);
      versions = { value: data.config[0].value };
    },
    randomPepper: () => fresh,
    ownerId: () => '00000000-0000-4000-8000-000000000000',
    logger: { error: (e) => calls.logs.push(e) },
    ...overrides,
  });
  return { main, calls, collection };
}

test('authenticated ACL-granted empty POST archives legacy and activates new key without returning secrets', async () => {
  const f = fixture();
  const result = await f.main(request);
  assert.deepEqual(result, { statusCode: 200, body: { rotated: true, version: 2 } });
  assert.equal(f.calls.inserted[0].attempt_id, ROTATION_LOCK_ID);
  assert.equal(f.calls.inserted[0].customer_key, ROTATION_LOCK_CUSTOMER_KEY);
  assert.ok(f.calls.inserted[0].expires_at instanceof Date);
  assert.deepEqual(JSON.parse(f.calls.writes[0].config[0].value), [legacy, fresh]);
  assert.deepEqual(f.calls.deleted, [{ attempt_id: ROTATION_LOCK_ID, owner: '00000000-0000-4000-8000-000000000000' }]);
  assert.equal(f.calls.closed, 1);
  assert.ok(!JSON.stringify(result).includes(legacy));
});

test('bad methods, nonempty body and missing permission cannot touch config or DB', async () => {
  const f = fixture({ checkPermission: async () => false });
  assert.equal((await f.main({ ...request, __ow_method: 'get' })).statusCode, 405);
  assert.equal((await f.main({ ...request, __ow_body: '{}' })).statusCode, 400);
  assert.equal((await f.main(request)).statusCode, 403);
  assert.equal(f.calls.inserted.length, 0);
  assert.equal(f.calls.writes.length, 0);
});

test('concurrent rotation receives 409 and does not write a key', async () => {
  const f = fixture({ connect: async () => ({ collection: () => ({ insertOne: async () => { throw Object.assign(new Error('duplicate key'), { name: 'DbError', code: 11000 }); }, deleteOne: async () => { throw new Error('unexpected release'); } }), close: async () => { f.calls.closed++; } }) });
  assert.deepEqual(await f.main(request), { statusCode: 409, body: { message: 'rotation_in_progress' } });
  assert.equal(f.calls.writes.length, 0);
  assert.equal(f.calls.closed, 1);
});

test('config write failure releases lock without leaking details', async () => {
  const f = fixture({ writeConfig: async () => { throw new Error('secret private response'); } });
  const result = await f.main(request);
  assert.deepEqual(result, { statusCode: 500, body: { message: 'rotation_unavailable' } });
  assert.equal(f.calls.deleted.length, 1);
  assert.equal(f.calls.closed, 1);
  assert.ok(!JSON.stringify(f.calls.logs).includes('secret private response'));
});

test('unavailable authorization fails closed before acquiring lock', async () => {
  const f = fixture({ checkPermission: async () => { throw new Error('private token'); } });
  assert.deepEqual(await f.main(request), { statusCode: 502, body: { message: 'authorization_unavailable' } });
  assert.equal(f.calls.inserted.length, 0);
  assert.ok(!JSON.stringify(f.calls.logs).includes('private token'));
});
