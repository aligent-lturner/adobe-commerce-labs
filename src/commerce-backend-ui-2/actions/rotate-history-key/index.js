import { randomBytes, randomUUID } from 'node:crypto';
import { initialize, getConfigurationByKey, setConfiguration, byCodeAndLevel } from '@adobe/aio-commerce-lib-config';
import { getCommerceClient } from '@adobe/aio-commerce-lib-app';
import { getForwardedImsAuthProvider, getImsAuthProvider, resolveImsAuthParams } from '@adobe/aio-commerce-lib-auth';
import { getAdminUiPermissionClient, getCustomAclResourceId } from '@adobe/aio-commerce-lib-admin-ui/api';
import { init as initDb } from '@adobe/aio-lib-db';
import schema from '../../../commerce-configuration-1/.generated/configuration-schema.json' with { type: 'json' };
import { parseKeyring, nextKeyring, ROTATION_LOCK_ID, ROTATION_LOCK_CUSTOMER_KEY } from '../../../commerce-extensibility-1/actions/handle-customer-created/history-keyring.js';
import { isDuplicateKey } from '../../../commerce-extensibility-1/actions/handle-customer-created/welcome-history-keys.js';

async function authorize(params) {
  const auth = getForwardedImsAuthProvider({ from: 'headers', headers: params.__ow_headers ?? {} });
  const httpClient = await getCommerceClient(auth);
  const permissions = getAdminUiPermissionClient({ httpClient, appId: 'customer-welcome-notifier' });
  return permissions.check(getCustomAclResourceId('customer-welcome-notifier', 'rotate_history_key'));
}

async function connectDb(params) {
  const auth = getImsAuthProvider(resolveImsAuthParams(params));
  const token = await auth.getAccessToken();
  const db = await initDb({ token, region: 'aus' });
  return db.connect();
}

export function createRotationHandler({ checkPermission = authorize, connect = connectDb, initializeConfig = initialize, readConfig = getConfigurationByKey, writeConfig = setConfiguration, scope = byCodeAndLevel, randomPepper = () => randomBytes(32).toString('hex'), ownerId = randomUUID, logger = console } = {}) {
  return async function main(params) {
    if (params?.__ow_method !== 'post') return { statusCode: 405, body: { message: 'method_not_allowed' } };
    if (params.__ow_body !== undefined && params.__ow_body !== '' || params.__ow_query || params.__ow_path) return { statusCode: 400, body: { message: 'invalid_request' } };
    let permitted;
    try { permitted = await checkPermission(params); }
    catch (error) {
      logger.error({ phase: 'permission', errorType: error instanceof Error ? error.name : 'Unknown' });
      return { statusCode: 502, body: { message: 'authorization_unavailable' } };
    }
    if (permitted !== true) return { statusCode: 403, body: { message: 'forbidden' } };
    if (typeof params.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY !== 'string' || !params.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY) {
      logger.error({ phase: 'config', errorType: 'MissingEncryptionKey' });
      return { statusCode: 500, body: { error: 'configuration_error' } };
    }
    let client;
    let locked = false;
    const owner = ownerId();
    try {
      client = await connect(params);
      const collection = client.collection('welcome_delivery_attempts');
      try {
        await collection.insertOne({ attempt_id: ROTATION_LOCK_ID, customer_key: ROTATION_LOCK_CUSTOMER_KEY, status: 'received', event_time: new Date(0), expires_at: new Date(Date.now() + 600000), owner });
        locked = true;
      } catch (error) {
        if (isDuplicateKey(error)) return { statusCode: 409, body: { message: 'rotation_in_progress' } };
        throw error;
      }
      await initializeConfig({ schema });
      const selector = scope('global', 'global');
      const { config: legacy } = await readConfig('customer_key_pepper', selector, { encryptionKey: params.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY, cacheTimeout: 0 });
      const { config: current } = await readConfig('customer_key_versions', selector, { encryptionKey: params.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY, cacheTimeout: 0 });
      const versions = parseKeyring(legacy?.value, current?.value);
      const updated = nextKeyring(versions, randomPepper());
      await writeConfig({ config: [{ name: 'customer_key_versions', value: updated }] }, selector, { encryptionKey: params.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY });
      const { config: confirmed } = await readConfig('customer_key_versions', selector, { encryptionKey: params.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY, cacheTimeout: 0 });
      if (confirmed?.value !== updated) throw new Error('Configuration verification failed');
      return { statusCode: 200, body: { rotated: true, version: versions.length + 1 } };
    } catch (error) {
      logger.error({ phase: 'rotation', errorType: error instanceof Error ? error.name : 'Unknown' });
      return { statusCode: error?.name === 'DbError' ? 502 : 500, body: { message: 'rotation_unavailable' } };
    } finally {
      if (client) {
        if (locked) {
          try { await client.collection('welcome_delivery_attempts').deleteOne({ attempt_id: ROTATION_LOCK_ID, owner }); }
          catch (error) { logger.error({ phase: 'release', errorType: error instanceof Error ? error.name : 'Unknown' }); }
        }
        try { await client.close(); }
        catch (error) { logger.error({ phase: 'close', errorType: error instanceof Error ? error.name : 'Unknown' }); }
      }
    }
  };
}

export const main = createRotationHandler();
