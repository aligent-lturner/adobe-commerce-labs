import { initialize, getConfigurationByKey, byCodeAndLevel } from '@adobe/aio-commerce-lib-config';
import { getImsAuthProvider, resolveImsAuthParams } from '@adobe/aio-commerce-lib-auth';
import { init as initDb } from '@adobe/aio-lib-db';
import schema from '../../../commerce-configuration-1/.generated/configuration-schema.json' with { type: 'json' };
import { sendWelcomeNotification } from './webhook-capture-client.js';
import { deriveAttemptId, validateCustomerId, toErrorCategory, isDuplicateKey } from './welcome-history-keys.js';
import { parseKeyring, lookupKeys } from './history-keyring.js';

const DEFAULT_BASE_URL = 'https://aisenseapi.com/services/v1/webhook_capture';
const HASH = /^[0-9a-f]{64}$/;
const statuses = new Set(['received', 'delivered', 'failed']);

function safeAttempt(record) {
  return Object.fromEntries(['attempt_id', 'status', 'capture_id', 'error_category', 'event_time', 'completed_at']
    .filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
}

async function connectDb(params) {
  const provider = getImsAuthProvider(resolveImsAuthParams(params));
  const token = await provider.getAccessToken();
  const db = await initDb({ token, region: 'aus' });
  return db.connect();
}

export function createHandler({ initializeConfig = initialize, readConfig = getConfigurationByKey, scope = byCodeAndLevel, connect = connectDb, send = sendWelcomeNotification, logger = console, now = () => new Date() } = {}) {
  return async function main(params) {
    const value = params?.data?.value;
    const email = value?.email;
    const created_at = value?.created_at;
    const updated_at = value?.updated_at;
    if (typeof created_at !== 'string' || !created_at.trim() || !Number.isFinite(Date.parse(created_at)) ||
        typeof updated_at !== 'string' || !updated_at.trim() || !Number.isFinite(Date.parse(updated_at))) {
      return { statusCode: 200, body: { skipped: true } };
    }
    if (created_at !== updated_at) return { statusCode: 200, body: { skipped: true } };
    let id;
    try {
      id = validateCustomerId(value?.id);
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new TypeError('Invalid customer event');
    } catch { return { statusCode: 400, body: { error: 'invalid_customer_event' } }; }
    const eventTime = new Date(created_at);
    const attempt_id = deriveAttemptId(id, created_at);
    let baseUrl;
    let customer_key;
    try {
      if (typeof params?.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY !== 'string' || !params.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY) throw new Error('Missing encryption key');
      await initializeConfig({ schema });
      const selector = scope('global', 'global');
      const { config: legacy } = await readConfig('customer_key_pepper', selector, { encryptionKey: params.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY, cacheTimeout: 0 });
      const { config: versions } = await readConfig('customer_key_versions', selector, { encryptionKey: params.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY, cacheTimeout: 0 });
      customer_key = lookupKeys(id, parseKeyring(legacy?.value, versions?.value)).at(-1);
      const { config: url } = await readConfig('welcome_service_base_url', selector, { encryptionKey: params.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY });
      baseUrl = url?.value || DEFAULT_BASE_URL;
      if (typeof baseUrl !== 'string' || new URL(baseUrl).protocol !== 'https:') throw new Error('Invalid service URL');
    } catch (error) {
      logger.error({ phase: 'config', errorType: error instanceof Error ? error.name : 'Unknown', attempt_id });
      return { statusCode: 500, body: { error: 'configuration_error' } };
    }
    let client;
    try {
      client = await connect(params);
      const attempts = client.collection('welcome_delivery_attempts');
      if (!HASH.test(attempt_id) || !HASH.test(customer_key) || !statuses.has('received')) throw new TypeError('Invalid attempt');
      try {
        await attempts.insertOne({ attempt_id, customer_key, status: 'received', event_time: eventTime });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        const existing = await attempts.findOne({ attempt_id });
        return { statusCode: 200, body: { duplicate: true, attempt: safeAttempt(existing) } };
      }
      try {
        const capture_id = await send({ baseUrl, email, created_at }, { logger });
        if (typeof capture_id !== 'string' || !capture_id || capture_id.length > 256) throw new TypeError('Invalid capture response');
        const update = { status: 'delivered', capture_id, completed_at: now() };
        if (!statuses.has(update.status) || !(update.completed_at instanceof Date) || !Number.isFinite(update.completed_at.valueOf())) throw new TypeError('Invalid completion');
        await attempts.updateOne({ attempt_id, status: 'received' }, { $set: update });
        return { statusCode: 200, body: { capture_id, attempt_id } };
      } catch (error) {
        const error_category = toErrorCategory(error);
        const update = { status: 'failed', error_category, completed_at: now() };
        if (!statuses.has(update.status) || !['network_error', 'timeout', 'upstream_4xx', 'upstream_5xx', 'invalid_response', 'unknown'].includes(update.error_category) || !(update.completed_at instanceof Date) || !Number.isFinite(update.completed_at.valueOf())) throw new TypeError('Invalid completion');
        await attempts.updateOne({ attempt_id, status: 'received' }, { $set: update });
        logger.error({ phase: 'send', errorType: error instanceof Error ? error.name : 'Unknown', attempt_id });
        return { statusCode: 502, body: { error: 'welcome_notification_failed', attempt_id } };
      }
    } catch (error) {
      logger.error({ phase: 'database', errorType: error instanceof Error ? error.name : 'Unknown', attempt_id });
      return { statusCode: error?.name === 'DbError' ? 502 : 500, body: { error: 'history_unavailable' } };
    } finally {
      if (client) {
        try { await client.close(); } catch (error) { logger.error({ phase: 'close', errorType: error instanceof Error ? error.name : 'Unknown', attempt_id }); }
      }
    }
  };
}

export const main = createHandler();
