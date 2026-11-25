import { initialize, getConfigurationByKey, byCodeAndLevel } from '@adobe/aio-commerce-lib-config';
import schema from '../../../commerce-configuration-1/.generated/configuration-schema.json' with { type: 'json' };
import { sendWelcomeNotification } from './webhook-capture-client.js';

const BASE_URL_KEY = 'welcome_service_base_url';
const DEFAULT_BASE_URL = 'https://aisenseapi.com/services/v1/webhook_capture';

/** Dependency injection keeps the event and HTTP behavior independently testable. */
export function createHandler({ initializeConfig = initialize, readConfig = getConfigurationByKey, scope = byCodeAndLevel, send = sendWelcomeNotification, logger = console } = {}) {
  return async function main(params) {
    const value = params?.data?.value;
    const email = value?.email;
    const created_at = value?.created_at;
    const updated_at = value?.updated_at;
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof created_at !== 'string' || !created_at.trim() ||
        typeof updated_at !== 'string' || !updated_at.trim()) {
      return { statusCode: 400, body: { error: 'invalid_customer_event' } };
    }
    if (created_at !== updated_at) {
      return { statusCode: 200, body: { skipped: true } };
    }
    const email_domain = email.split('@').at(-1).toLowerCase();
    let baseUrl;
    try {
      await initializeConfig({ schema });
      const { config } = await readConfig(BASE_URL_KEY, scope('global', 'global'));
      baseUrl = config?.value || DEFAULT_BASE_URL;
      if (typeof baseUrl !== 'string' || new URL(baseUrl).protocol !== 'https:') {
        throw new Error('Invalid configured base URL');
      }
    } catch (error) {
      logger.error({ operation: 'read_welcome_service_config', email_domain, errorType: error?.name ?? 'Error' });
      return { statusCode: 500, body: { error: 'configuration_error' } };
    }
    try {
      const capture_id = await send({ baseUrl, email, created_at }, { logger });
      return { statusCode: 200, body: { capture_id } };
    } catch (error) {
      logger.error({ operation: 'send_welcome_notification', email_domain, errorType: error?.name ?? 'Error' });
      return { statusCode: 502, body: { error: 'welcome_notification_failed' } };
    }
  };
}

export const main = createHandler();
