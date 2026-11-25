import { createHash, createHmac } from 'node:crypto';

export function validateCustomerId(id) {
  const value = typeof id === 'number' && Number.isSafeInteger(id) ? String(id) : id;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value)) throw new TypeError('Invalid customer entity ID');
  return value;
}

export function deriveAttemptId(customerId, createdAt) {
  const id = validateCustomerId(customerId);
  if (typeof createdAt !== 'string' || !createdAt || !Number.isFinite(Date.parse(createdAt))) throw new TypeError('Invalid event timestamp');
  return createHash('sha256').update(`${id}|${createdAt}`).digest('hex');
}

export function deriveCustomerKey(customerId, pepper) {
  const id = validateCustomerId(customerId);
  if (typeof pepper !== 'string' || !/^[0-9a-f]{64}$/.test(pepper)) throw new TypeError('Invalid history key');
  return createHmac('sha256', pepper).update(id).digest('hex');
}

export function toErrorCategory(error) {
  if (error?.category && ['network_error', 'timeout', 'upstream_4xx', 'upstream_5xx', 'invalid_response', 'unknown'].includes(error.category)) return error.category;
  if (error?.name === 'TimeoutError' || error?.code === 'ETIMEDOUT') return 'timeout';
  if (typeof error?.status === 'number') return error.status >= 500 ? 'upstream_5xx' : error.status >= 400 ? 'upstream_4xx' : 'unknown';
  if (error?.name === 'TypeError' || error?.code === 'ECONNRESET') return 'network_error';
  return 'unknown';
}

export function isDuplicateKey(error) {
  return error?.name === 'DbError' && (error?.code === 11000 || /duplicate key|E11000/i.test(error?.message ?? ''));
}

export function isDocumentNotFound(error) {
  return error?.name === 'DbError' && error?.message?.includes('Document not found');
}
