import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKeyring, nextKeyring, lookupKeys } from '../history-keyring.js';
import { deriveCustomerKey } from '../welcome-history-keys.js';

const legacy = 'a'.repeat(64);
const rotated = 'b'.repeat(64);

test('legacy and successive versions yield only distinct one-way keys', () => {
  const versions = parseKeyring(legacy, nextKeyring([legacy], rotated));
  assert.deepEqual(lookupKeys('123', versions), [deriveCustomerKey('123', legacy), deriveCustomerKey('123', rotated)]);
  assert.deepEqual(parseKeyring(legacy, null), [legacy]);
});

test('corrupt, changed and duplicated secrets fail closed', () => {
  assert.throws(() => parseKeyring(legacy, JSON.stringify([rotated])));
  assert.throws(() => parseKeyring(legacy, JSON.stringify([legacy, legacy])));
  assert.throws(() => parseKeyring(legacy, '{'));
  assert.throws(() => nextKeyring([legacy], legacy));
});
