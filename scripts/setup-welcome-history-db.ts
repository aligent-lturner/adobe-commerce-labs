import { randomBytes } from 'node:crypto';
import { defineCustomInstallationStep } from '@adobe/aio-commerce-lib-app/management';
import { getImsAuthProvider, resolveImsAuthParams } from '@adobe/aio-commerce-lib-auth';
import { init as initDb } from '@adobe/aio-lib-db';
import { initialize, getConfigurationByKey, setConfiguration, byCodeAndLevel } from '@adobe/aio-commerce-lib-config';

const collectionName = 'welcome_delivery_attempts';
const scope = byCodeAndLevel('global', 'global');

export default defineCustomInstallationStep({
  install: async (config, context) => {
    const params = context.params;
    const key = params.AIO_COMMERCE_CONFIG_ENCRYPTION_KEY;
    if (typeof key !== 'string' || !key || !config.businessConfig) {
      context.logger.error({ phase: 'config', errorType: 'MissingConfiguration' });
      throw new Error('Configuration unavailable');
    }
    let client;
    try {
      const auth = getImsAuthProvider(resolveImsAuthParams(params));
      const token = await auth.getAccessToken();
      const db = await initDb({ token, region: 'aus' });
      client = await db.connect();
      const names = await client.listCollections({}, { nameOnly: true });
      if (!names.some((entry) => entry.name === collectionName)) await client.createCollection(collectionName);
      const attempts = client.collection(collectionName);
      await attempts.createIndex({ attempt_id: 1 }, { name: 'uniq_attempt_id', unique: true });
      await attempts.createIndex({ customer_key: 1, event_time: -1 }, { name: 'customer_key_event_time_desc' });
      await initialize({ schema: config.businessConfig.schema });
      const { config: existing } = await getConfigurationByKey('customer_key_pepper', scope, { encryptionKey: key });
      if (!existing?.value) {
        await setConfiguration({ config: [{ name: 'customer_key_pepper', value: randomBytes(32).toString('hex') }] }, scope, { encryptionKey: key });
      }
      return { status: 'success' };
    } catch (error) {
      context.logger.error({ phase: 'setup_welcome_history', errorType: error instanceof Error ? error.name : 'Unknown' });
      throw error;
    } finally {
      if (client) await client.close();
    }
  },
  // Approved storage policy retains history across uninstall.
  uninstall: async () => {},
});
