import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveAttemptId, deriveCustomerKey, toErrorCategory } from '../welcome-history-keys.js';

test('stable one-way hashes contain no raw identity', () => {
  const id = '123';
  const a = deriveAttemptId(id, '2026-01-01T00:00:00Z');
  const k = deriveCustomerKey(id, 'a'.repeat(64));
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.match(k, /^[a-f0-9]{64}$/);
  assert.equal(a, deriveAttemptId(id, '2026-01-01T00:00:00Z'));
  assert.equal(k, deriveCustomerKey(id, 'a'.repeat(64)));
  assert.notEqual(k, deriveCustomerKey(id, 'b'.repeat(64)));
  assert.ok(!a.includes(id) && !k.includes(id));
});

test('error categories are strictly bounded', () => {
  assert.equal(toErrorCategory({ status: 503 }), 'upstream_5xx');
  assert.equal(toErrorCategory({ name: 'TimeoutError' }), 'timeout');
  assert.equal(toErrorCategory({ category: 'private upstream body' }), 'unknown');
});
