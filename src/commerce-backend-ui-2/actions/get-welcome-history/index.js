import { initialize, getConfigurationByKey, byCodeAndLevel } from '@adobe/aio-commerce-lib-config';
import { getImsAuthProvider, resolveImsAuthParams } from '@adobe/aio-commerce-lib-auth';
import { init as initDb } from '@adobe/aio-lib-db';
import schema from '../../../commerce-configuration-1/.generated/configuration-schema.json' with { type: 'json' };
import { validateCustomerId, deriveCustomerKey } from '../../../commerce-extensibility-1/actions/handle-customer-created/welcome-history-keys.js';

const fields = ['attempt_id', 'status', 'capture_id', 'error_category', 'event_time', 'completed_at'];
const projection = { _id: 0, attempt_id: 1, status: 1, capture_id: 1, error_category: 1, event_time: 1, completed_at: 1 };

async function connectDb(params) {
  const provider = getImsAuthProvider(resolveImsAuthParams(params));
  const token = await provider.getAccessToken();
  const db = await initDb({ token, region: 'aus' });
  return db.connect();
}

export function createHistoryHandler({ initializeConfig = initialize, readConfig = getConfigurationByKey, scope = byCodeAndLevel, connect = connectDb, logger = console } = {}) {
  return async function main(params) {
    let customerId;
    try {
      customerId = validateCustomerId(params?.customer_id);
    } catch {
      return { statusCode: 400, body: { message: 'invalid_customer_id' } };
    }
    if (typeof params?.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY !== 'string' || !params.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY) {
      logger.error({ phase: 'config', errorType: 'MissingEncryptionKey' });
      return { statusCode: 500, body: { error: 'configuration_error' } };
    }
    let customer_key;
    try {
      await initializeConfig({ schema });
      const { config } = await readConfig('customer_key_pepper', scope('global', 'global'), { encryptionKey: params.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY });
      customer_key = deriveCustomerKey(customerId, config?.value);
    } catch (error) {
      logger.error({ phase: 'config', errorType: error instanceof Error ? error.name : 'Unknown' });
      return { statusCode: 500, body: { error: 'configuration_error' } };
    }
    let client;
    try {
      client = await connect(params);
      const cursor = client.collection('welcome_delivery_attempts').find({ customer_key }).sort({ event_time: -1 }).project(projection).limit(100);
      const results = await cursor.toArray();
      const attempts = results.map((item) => Object.fromEntries(fields.filter((name) => item[name] !== undefined).map((name) => [name, item[name]])));
      return { statusCode: 200, body: { attempts } };
    } catch (error) {
      logger.error({ phase: 'query', errorType: error instanceof Error ? error.name : 'Unknown' });
      return { statusCode: error?.name === 'DbError' ? 502 : 500, body: { message: 'history_unavailable' } };
    } finally {
      if (client) {
        try { await client.close(); } catch (error) { logger.error({ phase: 'close', errorType: error instanceof Error ? error.name : 'Unknown' }); }
      }
    }
  };
}

export const main = createHistoryHandler();
