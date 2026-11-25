import { deriveCustomerKey } from './welcome-history-keys.js';

const pepperPattern = /^[a-f0-9]{64}$/;
const MAX_VERSIONS = 32;
export const ROTATION_LOCK_ID = 'f4827cdb3cd847b86e754293faab1dd3446d3e1705396144728d6b945a05ba3b';
export const ROTATION_LOCK_CUSTOMER_KEY = '09717512e2ec006bac8d85efae639ecb163042536170e53aee51106798dc5aa1';

export function parseKeyring(legacy, encoded) {
  if (typeof legacy !== 'string' || !pepperPattern.test(legacy)) throw new TypeError('Invalid history key');
  if (encoded === undefined || encoded === null || encoded === '') return [legacy];
  if (typeof encoded !== 'string' || encoded.length > 2200) throw new TypeError('Invalid keyring');
  let versions;
  try { versions = JSON.parse(encoded); } catch { throw new TypeError('Invalid keyring'); }
  if (!Array.isArray(versions) || versions.length < 1 || versions.length > MAX_VERSIONS ||
      versions[0] !== legacy || versions.some((key) => typeof key !== 'string' || !pepperPattern.test(key)) ||
      new Set(versions).size !== versions.length) throw new TypeError('Invalid keyring');
  return versions;
}

export function nextKeyring(versions, newPepper) {
  if (!Array.isArray(versions) || versions.length >= MAX_VERSIONS ||
      typeof newPepper !== 'string' || !pepperPattern.test(newPepper) || versions.includes(newPepper)) throw new TypeError('Invalid rotation');
  return JSON.stringify([...versions, newPepper]);
}

export function lookupKeys(customerId, versions) {
  return versions.map((pepper) => deriveCustomerKey(customerId, pepper));
}
